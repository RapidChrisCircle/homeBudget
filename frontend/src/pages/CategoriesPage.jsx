import { useEffect, useState } from 'react'
import { api } from '../services/api'

const EMPTY_FORM = {
  name: '',
  kind: 'expense',
  budget_amount: '',
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

  const refresh = async () => {
    const response = await api.get('/categories')
    setCategories(response.data)
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
      await refresh()
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
      await refresh()
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
                Monthly budget
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.budget_amount}
                  onChange={handleFieldChange('budget_amount')}
                />
              </label>
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
                <th>Monthly Budget</th>
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
    </section>
  )
}
