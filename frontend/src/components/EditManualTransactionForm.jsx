import { useEffect, useRef, useState } from 'react'
import CategorySelect from './CategorySelect.jsx'
import ErrorState from './ErrorState.jsx'
import { api } from '../services/api'

// Edits a manually entered transaction's own fields - opened from its
// Details row (transaction.is_manual only; every other row keeps today's
// category/note/splits-only editing). PUT /transactions/{id} recomputes the
// balance server-side the same way creation does - see that endpoint's own
// docstring for why the new date must still be on or after the account's
// OTHER latest transaction.
//
// Same modal shell as RuleEditor/SplitEditor (.modal-overlay/.modal card),
// prefilled with the transaction's current signed amount split back into
// this form's own direction+positive-amount pair, matching
// AddTransactionForm's UI exactly rather than asking for a signed value.
export default function EditManualTransactionForm({ transaction, categories, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    transactionDate: transaction.transaction_date,
    narration: transaction.narration,
    direction: transaction.debit !== null ? 'debit' : 'credit',
    amount: Math.abs(Number(transaction.debit ?? transaction.credit)).toFixed(2),
    categoryId: transaction.category_id ? String(transaction.category_id) : '',
    note: transaction.note || '',
  }))
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

  const handleFieldChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }))
  }

  const handleSave = async (event) => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      await api.put(`/transactions/${transaction.id}`, {
        transaction_date: form.transactionDate,
        narration: form.narration,
        debit: form.direction === 'debit' ? form.amount : null,
        credit: form.direction === 'credit' ? form.amount : null,
        category_id: form.categoryId ? Number(form.categoryId) : null,
        note: form.note || null,
      })
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
        aria-labelledby="edit-manual-transaction-title"
        tabIndex={-1}
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="edit-manual-transaction-title">Edit transaction</h3>

        {error && <ErrorState label="Save failed:" message={error} />}

        <form onSubmit={handleSave}>
          <div>
            <label>
              Date
              <input
                type="date"
                value={form.transactionDate}
                onChange={handleFieldChange('transactionDate')}
                required
              />
            </label>
          </div>

          <div>
            <label>
              Narration
              <input
                type="text"
                value={form.narration}
                onChange={handleFieldChange('narration')}
                required
              />
            </label>
          </div>

          <div className="transaction-direction-field">
            <span className="transaction-direction-legend">Direction</span>
            <label>
              <input
                type="radio"
                name="edit-transaction-direction"
                value="debit"
                checked={form.direction === 'debit'}
                onChange={handleFieldChange('direction')}
              />
              {' '}Money out
            </label>
            <label>
              <input
                type="radio"
                name="edit-transaction-direction"
                value="credit"
                checked={form.direction === 'credit'}
                onChange={handleFieldChange('direction')}
              />
              {' '}Money in
            </label>
          </div>

          <div>
            <label>
              Amount
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={form.amount}
                onChange={handleFieldChange('amount')}
                required
              />
            </label>
          </div>

          <div>
            <label>
              Edit transaction category
              <CategorySelect
                categories={categories}
                value={form.categoryId}
                onChange={handleFieldChange('categoryId')}
                fallbackOption={
                  transaction.category_id
                    ? { id: transaction.category_id, name: transaction.category_name }
                    : null
                }
              >
                <option value="">Uncategorized</option>
              </CategorySelect>
            </label>
          </div>

          <div>
            <label>
              Note (optional)
              <input type="text" value={form.note} onChange={handleFieldChange('note')} />
            </label>
          </div>

          <div className="modal-actions">
            <button type="submit" className="button-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
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
