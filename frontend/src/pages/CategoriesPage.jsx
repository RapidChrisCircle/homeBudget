import { useEffect, useState } from 'react'
import Amount from '../components/Amount.jsx'
import Badge from '../components/Badge.jsx'
import Card from '../components/Card.jsx'
import ErrorState from '../components/ErrorState.jsx'
import LoadingState from '../components/LoadingState.jsx'
import { api } from '../services/api'

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

  const refresh = async () => {
    const response = await api.get('/categories')
    setCategories(response.data)
  }

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

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this category? Transactions using it will become uncategorized.')) {
      return
    }
    setActionError('')
    try {
      await api.delete(`/categories/${id}`)
      if (editingId === id) {
        cancelEdit()
      }
      // A deleted category must not leave a phantom row in the budgets
      // table whose Save/Revert buttons would 404.
      await Promise.all([refresh(), refreshBudgets()])
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Delete failed'
      setActionError(String(message))
    }
  }

  // A parent must itself be top-level (one level only - see
  // api/categories.py), and a category can't be its own parent.
  const parentOptions = categories.filter((category) => !category.parent_id && category.id !== editingId)
  const editingHasChildren = editingId != null && categories.some((category) => category.parent_id === editingId)
  const sections = buildCategorySections(categories)

  return (
    <section className="card">
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

      <Card id="categories-form" title={editingId ? 'Edit Category' : 'Add Category'}>
        <form onSubmit={handleSubmit}>
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
          <button type="submit" className="button-primary" disabled={saving}>
            {editingId ? 'Save Changes' : 'Add Category'}
          </button>
          {editingId && (
            <button type="button" onClick={cancelEdit} disabled={saving}>
              Cancel
            </button>
          )}
        </form>
      </Card>

      <Card id="categories-list" title="All Categories">
        {loading && <LoadingState message="Loading categories..." />}
        {!loading && error && <ErrorState label="Failed to load categories:" message={error} />}

        {!loading && !error && sections.map((section) => {
          const table = (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Kind</th>
                  <th>Standing Budget</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map(({ category, isGroup, groupTotal }) => (
                  <tr key={category.id}>
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
                      <button type="button" onClick={() => startEdit(category)}>
                        Edit
                      </button>
                      <button type="button" className="button-danger" onClick={() => handleDelete(category.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
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
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Standing</th>
                    <th>This Month</th>
                    <th>Actual</th>
                    <th>Difference</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {budgetData.categories.map((row) => (
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
