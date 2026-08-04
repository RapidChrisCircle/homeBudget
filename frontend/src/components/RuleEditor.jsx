import { useEffect, useRef, useState } from 'react'
import CategoryQuickAdd from './CategoryQuickAdd.jsx'
import ErrorState from './ErrorState.jsx'
import { api } from '../services/api'

// The ledger's "make and apply a rule without leaving the page" fast path -
// opened from a row's Details expander or a merchant group, prefilled from
// the transaction that triggered it. This is deliberately NOT a replacement
// for the full editor on /rules (no reordering, no editing an existing
// rule) - just the common case of "I'm looking at a transaction, turn it
// into a rule" made a single dialog instead of a round trip that only
// carried the narration.
//
// Prefill uses transaction.merchant_label (from schemas.TransactionResponse,
// backed by the same services/narration.merchant_label recurring detection
// and ledger grouping already share) rather than the raw narration - the
// padded, reference-number-laden original rarely matches anything else.
// Amount bounds stay blank: one transaction's amount is a poor guess at a
// range, so nothing here invents one.
export default function RuleEditor({ transaction, categories, transactionTypes, onCategoryCreated, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    narration_pattern: transaction.merchant_label || transaction.narration,
    transaction_type: transaction.transaction_type || '',
    min_amount: '',
    max_amount: '',
    category_id: transaction.category_id ? String(transaction.category_id) : '',
  }))
  const [preview, setPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef(null)

  useEffect(() => {
    dialogRef.current?.focus()

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const buildPayload = () => ({
    narration_pattern: form.narration_pattern,
    transaction_type: form.transaction_type || null,
    min_amount: form.min_amount || null,
    max_amount: form.max_amount || null,
    category_id: form.category_id ? Number(form.category_id) : null,
  })

  const runPreview = async () => {
    if (!form.narration_pattern.trim()) {
      setPreview(null)
      return
    }
    setPreviewing(true)
    try {
      const response = await api.post('/category-rules/preview', buildPayload())
      setPreview(response.data)
    } catch {
      // A broken preview shouldn't block editing - Save surfaces any real
      // validation problem (e.g. no category chosen yet) on its own.
      setPreview(null)
    } finally {
      setPreviewing(false)
    }
  }

  // Refetches whenever a discrete field changes (a select, not free text) -
  // and once up front for the prefilled pattern. narration_pattern itself
  // refetches on blur instead: this codebase deliberately has no per-
  // keystroke debounce machinery (see LedgerFilters), and a modal that
  // fires a request on every character typed would be the first of it.
  useEffect(() => {
    runPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.transaction_type, form.min_amount, form.max_amount, form.category_id])

  const handleFieldChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }))
  }

  const handleSave = async (event) => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      await api.post('/category-rules', buildPayload())
      await api.post('/category-rules/apply')
      onSaved()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Save failed'
      setError(String(message))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rule-editor-title"
        tabIndex={-1}
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="rule-editor-title">Make rule from &quot;{transaction.narration}&quot;</h3>

        {error && <ErrorState label="Save failed:" message={error} />}

        <form onSubmit={handleSave}>
          <div>
            <label>
              Narration contains
              <input
                type="text"
                value={form.narration_pattern}
                onChange={handleFieldChange('narration_pattern')}
                onBlur={runPreview}
                required
              />
            </label>
          </div>
          <div>
            <label>
              Transaction type
              <select value={form.transaction_type} onChange={handleFieldChange('transaction_type')}>
                <option value="">Any type</option>
                {Array.from(new Set([...transactionTypes, form.transaction_type].filter(Boolean))).map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
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

          <CategoryQuickAdd
            categories={categories}
            value={form.category_id}
            onChange={(value) => setForm((prev) => ({ ...prev, category_id: value }))}
            onCategoryCreated={(category) => {
              onCategoryCreated(category)
              setForm((prev) => ({ ...prev, category_id: String(category.id) }))
            }}
            label="Category"
            includeUncategorized={false}
          />

          <p aria-live="polite">
            {previewing && 'Checking matches...'}
            {!previewing && preview && (
              `Matches ${preview.match_count} transaction(s); ${preview.would_categorize_count} would be categorized now.`
            )}
          </p>

          <div className="modal-actions">
            <button type="submit" className="button-primary" disabled={saving || !form.category_id}>
              {saving ? 'Saving...' : 'Save and apply'}
            </button>
            <button type="button" onClick={onClose} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
