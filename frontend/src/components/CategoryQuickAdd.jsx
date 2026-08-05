import { useState } from 'react'
import CategorySelect from './CategorySelect.jsx'
import ErrorState from './ErrorState.jsx'
import { api } from '../services/api'

const KIND_OPTIONS = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
]

// A category <select> plus a "+ New category" toggle that reveals an inline
// create form, so mid-categorization work never has to leave the page just
// because the category doesn't exist yet.
//
// Deliberately one of these per page section (the ledger toolbar, the
// transaction-groups card) rather than one per ledger ROW - a category
// created here becomes available in every row's own select immediately
// (categories is the caller's own state, updated via onCategoryCreated), so
// nothing is lost by not duplicating the control fifty times over.
//
// Selection is controlled by the caller (value/onChange) - this component
// owns only its own create-form state, not which category ends up chosen.
export default function CategoryQuickAdd({
  categories,
  value,
  onChange,
  onCategoryCreated,
  label,
  includeUncategorized = true,
  fallbackOption = null,
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState('expense')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const startAdding = () => {
    setAdding(true)
    setName('')
    setKind('expense')
    setError('')
  }

  const cancelAdding = () => {
    setAdding(false)
    setError('')
  }

  const handleCreate = async (event) => {
    event.preventDefault()

    if (!name.trim()) {
      return
    }

    setSaving(true)
    setError('')

    try {
      const response = await api.post('/categories', { name: name.trim(), kind, budget_amount: null })
      onCategoryCreated(response.data)
      setAdding(false)
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Create failed'
      setError(String(message))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="category-quick-add">
      <label>
        {label}
        <CategorySelect
          categories={categories}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          fallbackOption={fallbackOption}
        >
          {includeUncategorized
            ? <option value="">Uncategorized</option>
            : <option value="">Select a category</option>}
        </CategorySelect>
      </label>

      {!adding && (
        <button type="button" className="button-ghost" onClick={startAdding}>
          + New category
        </button>
      )}

      {adding && (
        <form onSubmit={handleCreate} className="category-quick-add-form">
          {error && <ErrorState label="Create failed:" message={error} />}
          <div>
            <label>
              New category name
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </label>
          </div>
          <div>
            <label>
              Kind
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {KIND_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
          </div>
          <button type="submit" className="button-primary" disabled={saving}>
            {saving ? 'Creating...' : 'Create'}
          </button>
          <button type="button" onClick={cancelAdding} disabled={saving}>
            Cancel
          </button>
        </form>
      )}
    </div>
  )
}
