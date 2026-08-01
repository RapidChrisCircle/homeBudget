import { useEffect, useState } from 'react'
import { api } from '../services/api'
import { formatAmount } from '../utils/format.js'

const EMPTY_FORM = {
  name: '',
  kind: 'expense',
  budget_amount: '',
}

// Shifts a <input type="month"> value ("YYYY-MM") by whole months.
function shiftMonthString(monthStr, delta) {
  const [year, month] = monthStr.split('-').map(Number)
  const zeroBased = year * 12 + (month - 1) + delta
  return `${Math.floor(zeroBased / 12)}-${String((zeroBased % 12) + 1).padStart(2, '0')}`
}

// Blank optional fields are sent as null, not '' - the backend treats an
// empty budget as "not set" rather than "must equal empty string".
function buildPayload(form) {
  return {
    name: form.name,
    kind: form.kind,
    budget_amount: form.budget_amount || null,
  }
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
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
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

  return (
    <section className="card">
      <h2>Categories</h2>

      {actionError && (
        <p>
          <strong>Action failed:</strong> {actionError}
        </p>
      )}

      <div className="card">
        <h3>{editingId ? 'Edit Category' : 'Add Category'}</h3>
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
          {form.kind === 'expense' && (
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
          <button type="submit" disabled={saving}>
            {editingId ? 'Save Changes' : 'Add Category'}
          </button>
          {editingId && (
            <button type="button" onClick={cancelEdit} disabled={saving}>
              Cancel
            </button>
          )}
        </form>
      </div>

      <div className="card">
        <h3>All Categories</h3>

        {loading && <p>Loading categories...</p>}
        {!loading && error && (
          <p>
            <strong>Failed to load categories:</strong> {error}
          </p>
        )}

        {!loading && !error && (
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
              {categories.map((category) => (
                <tr key={category.id}>
                  <td>{category.name}</td>
                  <td>{category.kind}</td>
                  <td>{category.budget_amount}</td>
                  <td>
                    <button type="button" onClick={() => startEdit(category)}>
                      Edit
                    </button>
                    <button type="button" onClick={() => handleDelete(category.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Monthly Budgets</h3>

        {budgetActionError && (
          <p>
            <strong>Action failed:</strong> {budgetActionError}
          </p>
        )}

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

        {budgetLoading && <p>Loading budgets...</p>}
        {!budgetLoading && budgetError && (
          <p>
            <strong>Failed to load budgets:</strong> {budgetError}
          </p>
        )}

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
                      <td>{formatAmount(row.standing_amount)}</td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          aria-label={`This month's budget for ${row.category_name}`}
                          value={budgetEdits[row.category_id] ?? ''}
                          onChange={handleBudgetEditChange(row.category_id)}
                        />
                        {row.is_overridden && <span title="Overridden for this month specifically"> (overridden)</span>}
                      </td>
                      <td>{formatAmount(row.actual)}</td>
                      <td>
                        {formatAmount(row.difference)}
                        {row.difference !== null && Number(row.difference) < 0 && (
                          <span title="Over budget"> (over)</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
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
                    <td>{formatAmount(budgetData.totals.budgeted)}</td>
                    <td>{formatAmount(budgetData.totals.actual)}</td>
                    <td>
                      {formatAmount(budgetData.totals.difference)}
                      {Number(budgetData.totals.difference) < 0 && <span title="Over budget"> (over)</span>}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </>
        )}
      </div>
    </section>
  )
}
