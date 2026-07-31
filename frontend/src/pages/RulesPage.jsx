import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../services/api'

const EMPTY_FORM = {
  narration_pattern: '',
  transaction_type: '',
  min_amount: '',
  max_amount: '',
  category_id: '',
}

// Blank optional fields are sent as null, not '' - the backend treats an
// empty criterion as "not set" rather than "must equal empty string".
function buildPayload(form) {
  return {
    narration_pattern: form.narration_pattern,
    transaction_type: form.transaction_type || null,
    min_amount: form.min_amount || null,
    max_amount: form.max_amount || null,
    category_id: form.category_id ? Number(form.category_id) : null,
  }
}

export default function RulesPage() {
  const [rules, setRules] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [applyMessage, setApplyMessage] = useState('')
  const [applying, setApplying] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()

  const refresh = async () => {
    const [rulesRes, categoriesRes] = await Promise.all([
      api.get('/category-rules'),
      api.get('/categories'),
    ])
    setRules(rulesRes.data)
    setCategories(categoriesRes.data)
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

  // Seeded by the "Make rule" button on the ledger. Cleared immediately so a
  // refresh or Cancel doesn't resurrect the prefill.
  useEffect(() => {
    const narration = searchParams.get('narration')
    if (narration) {
      setForm((prev) => ({ ...prev, narration_pattern: narration }))
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const handleFieldChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }))
  }

  const startEdit = (rule) => {
    setEditingId(rule.id)
    setPreview(null)
    setForm({
      narration_pattern: rule.narration_pattern,
      transaction_type: rule.transaction_type || '',
      min_amount: rule.min_amount ?? '',
      max_amount: rule.max_amount ?? '',
      category_id: String(rule.category_id),
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setPreview(null)
    setForm(EMPTY_FORM)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    setActionError('')
    setSaving(true)

    try {
      if (editingId) {
        await api.put(`/category-rules/${editingId}`, buildPayload(form))
      } else {
        await api.post('/category-rules', buildPayload(form))
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

  const handlePreview = async () => {
    setActionError('')
    setPreviewing(true)
    try {
      const response = await api.post('/category-rules/preview', {
        ...buildPayload(form),
        exclude_rule_id: editingId || null,
      })
      setPreview(response.data)
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Preview failed'
      setActionError(String(message))
    } finally {
      setPreviewing(false)
    }
  }

  const handleApplyRules = async () => {
    setActionError('')
    setApplying(true)
    try {
      const response = await api.post('/category-rules/apply')
      setApplyMessage(`Categorized ${response.data.categorized_count} transaction(s).`)
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Apply rules failed'
      setActionError(String(message))
    } finally {
      setApplying(false)
    }
  }

  const handleMove = async (id, direction) => {
    setActionError('')
    try {
      const response = await api.post(`/category-rules/${id}/move`, { direction })
      setRules(response.data)
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Reorder failed'
      setActionError(String(message))
    }
  }

  const handleDelete = async (id) => {
    const confirmed = window.confirm(
      'Delete this rule? Transactions it categorized keep their category but will no longer be updated by rules.'
    )
    if (!confirmed) {
      return
    }
    setActionError('')
    try {
      await api.delete(`/category-rules/${id}`)
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
      <h2>Rules</h2>

      {actionError && (
        <p>
          <strong>Action failed:</strong> {actionError}
        </p>
      )}

      <div className="card">
        <h3>Apply Rules</h3>
        <p>
          Re-runs every rule over your existing transactions. Categories you set by hand are never
          changed.
        </p>
        <button type="button" onClick={handleApplyRules} disabled={applying}>
          Apply rules now
        </button>
        {applyMessage && <p>{applyMessage}</p>}
      </div>

      <div className="card">
        <h3>{editingId ? 'Edit Rule' : 'Add Rule'}</h3>

        <p>
          Rules are checked top to bottom and the first match wins. Amounts are compared as positive
          dollar values regardless of debit or credit &mdash; set Transaction type to restrict a rule
          to spending or income.
        </p>

        <form onSubmit={handleSubmit}>
          <div>
            <label>
              Narration contains
              <input
                type="text"
                value={form.narration_pattern}
                onChange={handleFieldChange('narration_pattern')}
                required
              />
            </label>
          </div>
          <div>
            <label>
              Transaction type
              <input
                type="text"
                value={form.transaction_type}
                onChange={handleFieldChange('transaction_type')}
              />
            </label>
          </div>
          <div>
            <label>
              Min amount
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.min_amount}
                onChange={handleFieldChange('min_amount')}
              />
            </label>
          </div>
          <div>
            <label>
              Max amount
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.max_amount}
                onChange={handleFieldChange('max_amount')}
              />
            </label>
          </div>
          <div>
            <label>
              Category
              <select value={form.category_id} onChange={handleFieldChange('category_id')} required>
                <option value="">Select a category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button type="submit" disabled={saving}>
            {editingId ? 'Save Changes' : 'Add Rule'}
          </button>
          <button type="button" onClick={handlePreview} disabled={previewing}>
            Check matches
          </button>
          {editingId && (
            <button type="button" onClick={cancelEdit} disabled={saving}>
              Cancel
            </button>
          )}
        </form>

        {preview && (
          <p>
            Would match {preview.match_count} transaction(s); {preview.would_categorize_count} would
            be categorized now.
          </p>
        )}
      </div>

      <div className="card">
        <h3>All Rules</h3>

        {loading && <p>Loading rules...</p>}
        {!loading && error && (
          <p>
            <strong>Failed to load rules:</strong> {error}
          </p>
        )}

        {!loading && !error && (
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Narration contains</th>
                <th>Type</th>
                <th>Min</th>
                <th>Max</th>
                <th>Category</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, index) => (
                <tr key={rule.id}>
                  <td>
                    <button
                      type="button"
                      aria-label={`Move ${rule.narration_pattern} up`}
                      onClick={() => handleMove(rule.id, 'up')}
                      disabled={index === 0}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${rule.narration_pattern} down`}
                      onClick={() => handleMove(rule.id, 'down')}
                      disabled={index === rules.length - 1}
                    >
                      ▼
                    </button>
                  </td>
                  <td>{rule.narration_pattern}</td>
                  <td>{rule.transaction_type}</td>
                  <td>{rule.min_amount}</td>
                  <td>{rule.max_amount}</td>
                  <td>{rule.category_name}</td>
                  <td>
                    <button type="button" onClick={() => startEdit(rule)}>
                      Edit
                    </button>
                    <button type="button" onClick={() => handleDelete(rule.id)}>
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
