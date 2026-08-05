import { Fragment, useEffect, useState } from 'react'
import Amount from '../components/Amount.jsx'
import Badge from '../components/Badge.jsx'
import Card from '../components/Card.jsx'
import ErrorState from '../components/ErrorState.jsx'
import InlineEditRow from '../components/InlineEditRow.jsx'
import LoadingState from '../components/LoadingState.jsx'
import SortableHeader from '../components/SortableHeader.jsx'
import { api } from '../services/api'
import { groupByParent } from '../utils/categories.js'
import { sortRowsBy, useTableSort } from '../utils/tableSort.js'

const CATEGORIES_TABLE_COLUMN_COUNT = 5

// One row per { category, isGroup, groupTotal } wrapper (buildCategorySections
// below), not a plain Category - so getValue reaches through `.category`.
const CATEGORY_SORT_COLUMNS = {
  name: { getValue: (row) => row.category.name, type: 'string' },
  kind: { getValue: (row) => row.category.kind, type: 'string' },
  budget: { getValue: (row) => (row.isGroup ? row.groupTotal : row.category.budget_amount), type: 'numeric' },
}

const UNUSED_SORT_COLUMNS = {
  name: { getValue: (u) => u.category_name, type: 'string' },
  budget: { getValue: (u) => u.budget_amount, type: 'numeric' },
}

const ARCHIVED_SORT_COLUMNS = {
  name: { getValue: (c) => c.name, type: 'string' },
}

const BUDGET_SORT_COLUMNS = {
  category: { getValue: (r) => r.category_name, type: 'string' },
  standing: { getValue: (r) => r.standing_amount, type: 'numeric' },
  this_month: { getValue: (r) => r.effective_amount, type: 'numeric' },
  actual: { getValue: (r) => r.actual, type: 'numeric' },
  difference: { getValue: (r) => r.difference, type: 'numeric' },
}

// A group's own row is a rollup (like the Monthly Budgets tfoot's totals
// row), not a peer of its children - sorting reorders the CHILDREN only,
// leaving the group row pinned first, the same "sorting reorders tbody
// only, never the summary" rule the tfoot totals row relies on below.
function sortSectionRows(rows, sortKey, sortDirection) {
  if (rows.length > 0 && rows[0].isGroup) {
    const [groupRow, ...childRows] = rows
    return [groupRow, ...sortRowsBy(childRows, sortKey, sortDirection, CATEGORY_SORT_COLUMNS)]
  }
  return sortRowsBy(rows, sortKey, sortDirection, CATEGORY_SORT_COLUMNS)
}

const EMPTY_FORM = {
  name: '',
  kind: 'expense',
  budget_amount: '',
  parent_id: '',
}

// Shifts a <input type="month"> value ("YYYY-MM") by whole months.
function shiftMonthString(monthStr, delta) {
  const [year, month] = monthStr.split('-').map(Number)
  const zeroBased = year * 12 + (month - 1) + delta
  return `${Math.floor(zeroBased / 12)}-${String((zeroBased % 12) + 1).padStart(2, '0')}`
}

// Blank optional fields are sent as null, not '' - the backend treats an
// empty budget (or parent) as "not set" rather than "must equal empty string".
function buildPayload(form) {
  return {
    name: form.name,
    kind: form.kind,
    budget_amount: form.budget_amount || null,
    parent_id: form.parent_id ? Number(form.parent_id) : null,
  }
}

// Sub-categories are grouping only (see backend's Category.parent_id
// docstring) - this arranges the flat /categories list into that shape for
// display, without changing what's actually stored. When nothing has a
// parent yet (the common case pre-preset), this returns exactly the one
// flat section the page has always rendered - same rows, same table, so
// nothing about adopting grouping changes what an ungrouped install sees.
function buildCategorySections(categories) {
  const childrenByParentId = new Map()

  for (const category of categories) {
    if (category.parent_id) {
      const siblings = childrenByParentId.get(category.parent_id) || []
      siblings.push(category)
      childrenByParentId.set(category.parent_id, siblings)
    }
  }

  const topLevel = categories.filter((category) => !category.parent_id)
  const groups = topLevel
    .map((parent) => ({ parent, children: childrenByParentId.get(parent.id) || [] }))
    .filter((group) => group.children.length > 0)

  if (groups.length === 0) {
    return [{ id: 'flat', heading: null, rows: categories.map((category) => ({ category, isGroup: false })) }]
  }

  const standalone = topLevel.filter((category) => (childrenByParentId.get(category.id) || []).length === 0)

  const sections = groups.map((group) => {
    const groupTotal = group.children.reduce(
      (sum, child) => sum + (child.budget_amount ? Number(child.budget_amount) : 0),
      0
    )
    return {
      id: `group-${group.parent.id}`,
      heading: group.parent.name,
      rows: [
        { category: group.parent, isGroup: true, groupTotal },
        ...group.children.map((category) => ({ category, isGroup: false })),
      ],
    }
  })

  if (standalone.length > 0) {
    sections.push({
      id: 'other',
      heading: 'Other',
      rows: standalone.map((category) => ({ category, isGroup: false })),
    })
  }

  return sections
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)

  // Independent async state for the budgets card below - it has its own
  // loading/error handling so a budgets failure never blocks category CRUD,
  // and vice versa.
  const [budgetMonth, setBudgetMonth] = useState('') // 'YYYY-MM'; '' until the default period is known
  const [budgetData, setBudgetData] = useState(null)
  const [budgetEdits, setBudgetEdits] = useState({}) // {category_id: input string}
  const [budgetLoading, setBudgetLoading] = useState(true)
  const [budgetError, setBudgetError] = useState('')
  const [budgetActionError, setBudgetActionError] = useState('')
  const [copying, setCopying] = useState(false)

  const [presetMessage, setPresetMessage] = useState('')
  const [presetError, setPresetError] = useState('')
  const [applyingPreset, setApplyingPreset] = useState(false)

  // Bulk delete - a flat set of ids regardless of which section/table a row
  // is rendered in, since selection is a page-level concept, not a
  // per-section one.
  const [selectedIds, setSelectedIds] = useState([])

  // Whole-ledger usage (transaction_count/rule_count per category), for the
  // Unused card - independent async state, same reasoning as the budgets
  // card above: a usage fetch failure shouldn't block category CRUD.
  const [usage, setUsage] = useState([])
  const [usageLoading, setUsageLoading] = useState(true)
  const [usageError, setUsageError] = useState('')

  // `categories` includes archived rows (include_archived=true) - this page
  // is the one place in the app that needs to see and manage them (the
  // Archived card below), unlike every other page's own `GET /categories`,
  // which deliberately gets the clean, archived-excluded default.
  const refresh = async () => {
    const response = await api.get('/categories?include_archived=true')
    setCategories(response.data)
  }

  const refreshUsage = async () => {
    const response = await api.get('/categories/usage')
    setUsage(response.data)
  }

  useEffect(() => {
    let cancelled = false

    setUsageLoading(true)
    setUsageError('')

    refreshUsage()
      .catch((err) => {
        if (!cancelled) {
          const message = err?.response?.data?.detail || err?.message || 'Unknown error'
          setUsageError(String(message))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setUsageLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const fetchBudgets = async (month) => {
    const query = month ? `?year=${month.split('-')[0]}&month=${Number(month.split('-')[1])}` : ''
    const response = await api.get(`/budgets${query}`)
    return response.data
  }

  const applyBudgetData = (data) => {
    setBudgetData(data)
    setBudgetEdits(
      Object.fromEntries(data.categories.map((c) => [c.category_id, c.effective_amount ?? '']))
    )
  }

  const refreshBudgets = async () => {
    try {
      applyBudgetData(await fetchBudgets(budgetMonth))
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Unknown error'
      setBudgetActionError(String(message))
    }
  }

  // On mount budgetMonth is '' (unknown), so this fetches with no
  // year/month and lets the server resolve the default period; the response
  // tells us which month that was, and we adopt it into budgetMonth so the
  // <input type="month"> has something to show. That adoption changes the
  // effect's own dependency, so it runs once more with an explicit
  // year/month - a single harmless extra request on first load, not a
  // recurring cost, so it isn't worth extra complexity to avoid.
  useEffect(() => {
    let cancelled = false

    setBudgetLoading(true)
    setBudgetError('')

    fetchBudgets(budgetMonth)
      .then((data) => {
        if (!cancelled) {
          applyBudgetData(data)
          const resolvedMonth = `${data.year}-${String(data.month).padStart(2, '0')}`
          if (resolvedMonth !== budgetMonth) {
            setBudgetMonth(resolvedMonth)
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const message = err?.response?.data?.detail || err?.message || 'Unknown error'
          setBudgetError(String(message))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBudgetLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budgetMonth])

  const handleBudgetEditChange = (categoryId) => (event) => {
    setBudgetEdits((prev) => ({ ...prev, [categoryId]: event.target.value }))
  }

  const isBudgetEditValid = (categoryId) => {
    const value = budgetEdits[categoryId]
    return value !== '' && value !== undefined && !Number.isNaN(Number(value)) && Number(value) >= 0
  }

  const handleSaveBudget = async (categoryId) => {
    if (!isBudgetEditValid(categoryId)) {
      return
    }
    setBudgetActionError('')
    try {
      const [year, month] = budgetMonth.split('-').map(Number)
      await api.put(`/budgets/${categoryId}`, { year, month, amount: budgetEdits[categoryId] })
      await refreshBudgets()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Save failed'
      setBudgetActionError(String(message))
    }
  }

  const handleRevertBudget = async (categoryId) => {
    setBudgetActionError('')
    try {
      const [year, month] = budgetMonth.split('-').map(Number)
      await api.delete(`/budgets/${categoryId}?year=${year}&month=${month}`)
      await refreshBudgets()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Revert failed'
      setBudgetActionError(String(message))
    }
  }

  const handleCopyFromPreviousMonth = async () => {
    if (!budgetMonth) {
      return
    }
    setBudgetActionError('')
    setCopying(true)
    try {
      const [toYear, toMonth] = budgetMonth.split('-').map(Number)
      const [fromYear, fromMonth] = shiftMonthString(budgetMonth, -1).split('-').map(Number)
      await api.post('/budgets/copy', {
        from_year: fromYear, from_month: fromMonth, to_year: toYear, to_month: toMonth,
      })
      await refreshBudgets()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Copy failed'
      setBudgetActionError(String(message))
    } finally {
      setCopying(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    setLoading(true)
    setError('')

    refresh()
      .catch((err) => {
        if (!cancelled) {
          const message = err?.response?.data?.detail || err?.message || 'Unknown error'
          setError(String(message))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const handleFieldChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }))
  }

  const startEdit = (category) => {
    setEditingId(category.id)
    setForm({
      name: category.name,
      kind: category.kind,
      budget_amount: category.budget_amount ?? '',
      parent_id: category.parent_id ?? '',
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  const handleApplyPreset = async () => {
    setPresetError('')
    setPresetMessage('')
    setApplyingPreset(true)
    try {
      const response = await api.post('/categories/preset')
      const { created, skipped } = response.data
      setPresetMessage(
        `Created ${created.length} categor${created.length === 1 ? 'y' : 'ies'}, `
        + `skipped ${skipped.length} already present.`
      )
      // Same reason handleSubmit/handleDelete refresh both: new categories
      // (and their budgets) must show up in the Monthly Budgets card too,
      // not just the list above it.
      await Promise.all([refresh(), refreshBudgets()])
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Preset failed'
      setPresetError(String(message))
    } finally {
      setApplyingPreset(false)
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    setActionError('')
    setSaving(true)

    try {
      if (editingId) {
        await api.put(`/categories/${editingId}`, buildPayload(form))
      } else {
        await api.post('/categories', buildPayload(form))
      }
      cancelEdit()
      // The budgets table below lists standing amounts and rows per
      // category - creating, renaming, or changing a standing budget must
      // not leave it showing a stale figure or a phantom row.
      await Promise.all([refresh(), refreshBudgets()])
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Save failed'
      setActionError(String(message))
    } finally {
      setSaving(false)
    }
  }

  // isGroup transactions are deleted WITH their children (?cascade=true) -
  // the default (no query param) would instead promote them to top-level,
  // which is correct for a plain/child category (it has no children to
  // promote either way) but would silently leave a whole sub-category group
  // behind for a category the user asked to remove entirely.
  const handleDelete = async (category, isGroup) => {
    const childCount = isGroup ? categories.filter((c) => c.parent_id === category.id).length : 0
    const message = isGroup
      ? `Delete "${category.name}" and its ${childCount} sub-categor${childCount === 1 ? 'y' : 'ies'}? `
        + 'Transactions using any of them will become uncategorized.'
      : 'Delete this category? Transactions using it will become uncategorized.'

    if (!window.confirm(message)) {
      return
    }
    setActionError('')
    try {
      await api.delete(`/categories/${category.id}${isGroup ? '?cascade=true' : ''}`)
      if (editingId === category.id) {
        cancelEdit()
      }
      // A deleted category must not leave a phantom row in the budgets
      // table whose Save/Revert buttons would 404.
      await Promise.all([refresh(), refreshBudgets(), refreshUsage()])
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Delete failed'
      setActionError(String(message))
    }
  }

  const toggleSelected = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((selectedId) => selectedId !== id) : [...prev, id]))
  }

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) {
      return
    }
    const message = (
      `Delete ${selectedIds.length} categor${selectedIds.length === 1 ? 'y' : 'ies'}? `
      + 'A selected category that groups others has those sub-categories promoted to top-level, '
      + 'not deleted - bulk delete never cascades. Transactions using any of them will become uncategorized.'
    )
    if (!window.confirm(message)) {
      return
    }
    setActionError('')
    try {
      await api.post('/categories/bulk-delete', { category_ids: selectedIds })
      setSelectedIds([])
      if (editingId != null && selectedIds.includes(editingId)) {
        cancelEdit()
      }
      await Promise.all([refresh(), refreshBudgets(), refreshUsage()])
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Bulk delete failed'
      setActionError(String(message))
    }
  }

  const handleArchive = async (categoryId) => {
    setActionError('')
    try {
      await api.post(`/categories/${categoryId}/archive`)
      await Promise.all([refresh(), refreshBudgets(), refreshUsage()])
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Archive failed'
      setActionError(String(message))
    }
  }

  const handleRestore = async (categoryId) => {
    setActionError('')
    try {
      await api.post(`/categories/${categoryId}/restore`)
      await Promise.all([refresh(), refreshBudgets(), refreshUsage()])
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Restore failed'
      setActionError(String(message))
    }
  }

  const handleArchiveAllUnused = async (unusedCategories) => {
    if (unusedCategories.length === 0) {
      return
    }
    setActionError('')
    try {
      await Promise.all(unusedCategories.map((u) => api.post(`/categories/${u.category_id}/archive`)))
      await Promise.all([refresh(), refreshBudgets(), refreshUsage()])
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Archive failed'
      setActionError(String(message))
    }
  }

  // A parent must itself be top-level (one level only - see
  // api/categories.py), and a category can't be its own parent.
  // `categories` includes archived rows (see refresh() above) - excluded
  // here since an archived category should not be pickable as a NEW
  // parent, and `editingHasChildren` intentionally does NOT exclude
  // archived (an archived child still counts as a child for the one-level
  // rule - archiving never changes the parent/child relationship itself).
  const parentOptions = categories.filter(
    (category) => !category.parent_id && category.id !== editingId && !category.archived
  )
  const editingHasChildren = editingId != null && categories.some((category) => category.parent_id === editingId)

  const activeCategories = categories.filter((category) => !category.archived)
  const archivedCategories = categories.filter((category) => category.archived)
  const sections = buildCategorySections(activeCategories)

  // A parent's own transaction_count is always 0 (never itself assignable -
  // see api/categories.py), so it is excluded here rather than evaluated
  // for "unused" the same way a leaf category is - a group with unused
  // children isn't itself meaningfully unused. Also excludes anything
  // already archived (nothing to offer archiving again) and anything a
  // rule still targets, even with zero transactions so far - a rule
  // exists specifically to categorize something, so that's active intent,
  // not clutter.
  const { groups: parentGroups } = groupByParent(activeCategories)
  const parentIds = new Set(parentGroups.map((group) => group.parent.id))
  const unusedCategories = usage.filter(
    (u) => !u.archived && !parentIds.has(u.category_id) && u.transaction_count === 0 && u.rule_count === 0
  )

  // rows=[] for the grouped categories table specifically - it sorts PER
  // SECTION via sortSectionRows/sortRowsBy below (this hook's own
  // sortedRows would need rows shaped like buildCategorySections' wrapper,
  // which the flat `categories` array isn't), so only sortKey/sortDirection/
  // toggleSort are used from it.
  const { sortKey: categorySortKey, sortDirection: categorySortDirection, toggleSort: toggleCategorySort } =
    useTableSort([], CATEGORY_SORT_COLUMNS)
  const { sortKey: unusedSortKey, sortDirection: unusedSortDirection, toggleSort: toggleUnusedSort } =
    useTableSort(unusedCategories, UNUSED_SORT_COLUMNS)
  const { sortKey: archivedSortKey, sortDirection: archivedSortDirection, toggleSort: toggleArchivedSort } =
    useTableSort(archivedCategories, ARCHIVED_SORT_COLUMNS)
  const { sortKey: budgetSortKey, sortDirection: budgetSortDirection, toggleSort: toggleBudgetSort } =
    useTableSort(budgetData?.categories ?? [], BUDGET_SORT_COLUMNS)

  const renderFormFields = () => (
    <>
      <div>
        <label>
          Name
          <input type="text" value={form.name} onChange={handleFieldChange('name')} required />
        </label>
      </div>
      <div>
        <label>
          Kind
          <select value={form.kind} onChange={handleFieldChange('kind')}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="transfer">Transfer</option>
          </select>
        </label>
        <p>
          Transfer categories are excluded from every report &mdash; use one for money moving
          between your own accounts.
        </p>
      </div>
      {editingHasChildren ? (
        <p>
          This category groups its own sub-categories, so it cannot be given a parent itself.
        </p>
      ) : (
        <div>
          <label>
            Parent category
            <select value={form.parent_id} onChange={handleFieldChange('parent_id')}>
              <option value="">No parent (top-level)</option>
              {parentOptions.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <p>
            Optional &mdash; groups this category for display. A parent cannot itself have a
            parent (one level only).
          </p>
        </div>
      )}
      {form.kind === 'expense' && !editingHasChildren && (
        <div>
          <label>
            Standing monthly budget
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.budget_amount}
              onChange={handleFieldChange('budget_amount')}
            />
          </label>
          <p>
            Applies to every month unless overridden for a specific month in Monthly Budgets
            below.
          </p>
        </div>
      )}
    </>
  )

  return (
    <section className="page">
      <h2>Categories</h2>

      {actionError && <ErrorState label="Action failed:" message={actionError} />}

      <Card id="categories-preset" title="Presets">
        <p>
          Creates a starting chart of accounts for a typical Queensland household &mdash; parent
          groups (Housing, Utilities, Food, ...) with sub-categories and indicative monthly
          budgets for a family of four. Safe to run more than once: anything you already have,
          by name, is left untouched, and nothing is ever overwritten or duplicated. Edit or
          delete anything afterward &mdash; these are a starting point, not a recommendation.
        </p>
        {presetError && <ErrorState label="Preset failed:" message={presetError} />}
        <button type="button" className="button-primary" onClick={handleApplyPreset} disabled={applyingPreset}>
          {applyingPreset ? 'Loading preset...' : 'Load Queensland household preset'}
        </button>
        {presetMessage && <p>{presetMessage}</p>}
      </Card>

      <Card id="categories-form" title="Add Category">
        {editingId ? (
          <p>Finish editing the category below to add another.</p>
        ) : (
          <form onSubmit={handleSubmit}>
            {renderFormFields()}
            <button type="submit" className="button-primary" disabled={saving}>
              Add Category
            </button>
          </form>
        )}
      </Card>

      <Card id="categories-list" title="All Categories">
        {loading && <LoadingState message="Loading categories..." />}
        {!loading && error && <ErrorState label="Failed to load categories:" message={error} />}

        {!loading && !error && (
          <button
            type="button"
            className="button-danger"
            onClick={handleBulkDelete}
            disabled={selectedIds.length === 0}
          >
            Delete selected ({selectedIds.length})
          </button>
        )}

        {!loading && !error && sections.map((section) => {
          const table = (
            <table>
              <caption className="visually-hidden">Categories{section.heading ? ` under ${section.heading}` : ''}</caption>
              <thead>
                <tr>
                  <th scope="col"></th>
                  <SortableHeader label="Name" sortKey="name" activeSortKey={categorySortKey} activeDirection={categorySortDirection} onSort={toggleCategorySort} />
                  <SortableHeader label="Kind" sortKey="kind" activeSortKey={categorySortKey} activeDirection={categorySortDirection} onSort={toggleCategorySort} />
                  <SortableHeader label="Standing Budget" sortKey="budget" activeSortKey={categorySortKey} activeDirection={categorySortDirection} onSort={toggleCategorySort} numeric />
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {sortSectionRows(section.rows, categorySortKey, categorySortDirection).map(({ category, isGroup, groupTotal }) => {
                  const editId = `category-edit-${category.id}`
                  const isEditing = editingId === category.id

                  return (
                    <Fragment key={category.id}>
                      <tr>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${category.name}`}
                            checked={selectedIds.includes(category.id)}
                            onChange={() => toggleSelected(category.id)}
                          />
                        </td>
                        <td>
                          {category.name}
                          {isGroup && (
                            <Badge tone="neutral" title="Groups its own sub-categories"> group</Badge>
                          )}
                        </td>
                        <td>{category.kind}</td>
                        <td>
                          <Amount value={isGroup ? groupTotal : category.budget_amount} neutral />
                        </td>
                        <td>
                          <button
                            type="button"
                            aria-expanded={isEditing}
                            aria-controls={editId}
                            onClick={() => startEdit(category)}
                          >
                            Edit
                          </button>
                          <button type="button" onClick={() => handleArchive(category.id)}>
                            Archive
                          </button>
                          <button
                            type="button"
                            className="button-danger"
                            onClick={() => handleDelete(category, isGroup)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                      {isEditing && (
                        <InlineEditRow
                          id={editId}
                          colSpan={CATEGORIES_TABLE_COLUMN_COUNT}
                          onSubmit={handleSubmit}
                          onCancel={cancelEdit}
                          saving={saving}
                        >
                          {renderFormFields()}
                        </InlineEditRow>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )

          // No groups exist anywhere yet - the exact flat table this page
          // has always rendered, with no extra wrapping card.
          if (!section.heading) {
            return <div key={section.id}>{table}</div>
          }

          return (
            <Card key={section.id} id={`categories-${section.id}`} title={section.heading} level={4}>
              {table}
            </Card>
          )
        })}
      </Card>

      <Card id="categories-unused" title="Unused">
        <p>
          Categories with no transactions and no rule pointing at them &mdash; candidates to
          archive and get out of the way of every category picker in the app. Archiving keeps the
          category and its (nonexistent) history; it can be restored any time.
        </p>

        {usageLoading && <LoadingState message="Loading usage..." />}
        {!usageLoading && usageError && <ErrorState label="Failed to load usage:" message={usageError} />}

        {!usageLoading && !usageError && (
          unusedCategories.length === 0 ? (
            <p>Nothing unused right now.</p>
          ) : (
            <>
              <button type="button" onClick={() => handleArchiveAllUnused(unusedCategories)}>
                Archive all unused ({unusedCategories.length})
              </button>
              <table>
                <caption className="visually-hidden">Unused categories</caption>
                <thead>
                  <tr>
                    <SortableHeader label="Name" sortKey="name" activeSortKey={unusedSortKey} activeDirection={unusedSortDirection} onSort={toggleUnusedSort} />
                    <SortableHeader label="Standing Budget" sortKey="budget" activeSortKey={unusedSortKey} activeDirection={unusedSortDirection} onSort={toggleUnusedSort} numeric />
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  {sortRowsBy(unusedCategories, unusedSortKey, unusedSortDirection, UNUSED_SORT_COLUMNS).map((u) => (
                    <tr key={u.category_id}>
                      <td>{u.category_name}</td>
                      <td><Amount value={u.budget_amount} neutral /></td>
                      <td>
                        <button type="button" onClick={() => handleArchive(u.category_id)}>
                          Archive
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )
        )}
      </Card>

      <Card id="categories-archived" title="Archived">
        {archivedCategories.length === 0 ? (
          <p>Nothing archived.</p>
        ) : (
          <table>
            <caption className="visually-hidden">Archived categories</caption>
            <thead>
              <tr>
                <SortableHeader label="Name" sortKey="name" activeSortKey={archivedSortKey} activeDirection={archivedSortDirection} onSort={toggleArchivedSort} />
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {sortRowsBy(archivedCategories, archivedSortKey, archivedSortDirection, ARCHIVED_SORT_COLUMNS).map((category) => (
                <tr key={category.id}>
                  <td>
                    {category.name}
                    {category.parent_name && <span className="text-muted"> ({category.parent_name})</span>}
                  </td>
                  <td>
                    <button type="button" onClick={() => handleRestore(category.id)}>
                      Restore
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card id="categories-monthly-budgets" title="Monthly Budgets">
        {budgetActionError && <ErrorState label="Action failed:" message={budgetActionError} />}

        <label>
          Month
          <input
            type="month"
            value={budgetMonth}
            onChange={(event) => setBudgetMonth(event.target.value)}
          />
        </label>
        <button type="button" onClick={handleCopyFromPreviousMonth} disabled={copying || !budgetMonth}>
          Copy from previous month
        </button>

        {budgetLoading && <LoadingState message="Loading budgets..." />}
        {!budgetLoading && budgetError && <ErrorState label="Failed to load budgets:" message={budgetError} />}

        {!budgetLoading && !budgetError && budgetData && (
          <>
            {budgetData.categories.length === 0 && <p>No expense categories yet.</p>}
            {budgetData.categories.length > 0 && (
              <table>
                <caption className="visually-hidden">Monthly budgets</caption>
                <thead>
                  <tr>
                    <SortableHeader label="Category" sortKey="category" activeSortKey={budgetSortKey} activeDirection={budgetSortDirection} onSort={toggleBudgetSort} />
                    <SortableHeader label="Standing" sortKey="standing" activeSortKey={budgetSortKey} activeDirection={budgetSortDirection} onSort={toggleBudgetSort} numeric />
                    <SortableHeader label="This Month" sortKey="this_month" activeSortKey={budgetSortKey} activeDirection={budgetSortDirection} onSort={toggleBudgetSort} numeric />
                    <SortableHeader label="Actual" sortKey="actual" activeSortKey={budgetSortKey} activeDirection={budgetSortDirection} onSort={toggleBudgetSort} numeric />
                    <SortableHeader label="Difference" sortKey="difference" activeSortKey={budgetSortKey} activeDirection={budgetSortDirection} onSort={toggleBudgetSort} numeric />
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  {/* Sorting reorders tbody only - the tfoot totals row
                      below always stays last, the same "summary row is
                      pinned" rule sortSectionRows applies to a category
                      group's own row above. */}
                  {sortRowsBy(budgetData.categories, budgetSortKey, budgetSortDirection, BUDGET_SORT_COLUMNS).map((row) => (
                    <tr key={row.category_id}>
                      <td>{row.category_name}</td>
                      <td><Amount value={row.standing_amount} neutral /></td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          aria-label={`This month's budget for ${row.category_name}`}
                          value={budgetEdits[row.category_id] ?? ''}
                          onChange={handleBudgetEditChange(row.category_id)}
                        />
                        {row.is_overridden && (
                          <Badge tone="info" title="Overridden for this month specifically"> (overridden)</Badge>
                        )}
                      </td>
                      <td><Amount value={row.actual} neutral /></td>
                      <td>
                        <Amount value={row.difference} />
                        {row.difference !== null && Number(row.difference) < 0 && (
                          <Badge tone="danger" title="Over budget"> (over)</Badge>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button-primary"
                          onClick={() => handleSaveBudget(row.category_id)}
                          disabled={!isBudgetEditValid(row.category_id)}
                        >
                          Save
                        </button>
                        {row.is_overridden && (
                          <button type="button" onClick={() => handleRevertBudget(row.category_id)}>
                            Revert to standing
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td></td>
                    <td><Amount value={budgetData.totals.budgeted} neutral /></td>
                    <td><Amount value={budgetData.totals.actual} neutral /></td>
                    <td>
                      <Amount value={budgetData.totals.difference} />
                      {Number(budgetData.totals.difference) < 0 && <Badge tone="danger" title="Over budget"> (over)</Badge>}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </>
        )}
      </Card>
    </section>
  )
}
