import { useEffect, useRef, useState } from 'react'
import Amount from './Amount.jsx'
import CategoryQuickAdd from './CategoryQuickAdd.jsx'
import ErrorState from './ErrorState.jsx'
import { api } from '../services/api'

// The transaction's own signed amount (debit negative, credit positive) -
// splits must sum to exactly this, mirroring the backend's own check
// (api/transactions.py's update_transaction_splits) so the remainder shown
// here can never disagree with what Save will actually accept.
function transactionAmount(transaction) {
  const debit = transaction.debit ? Number(transaction.debit) : 0
  const credit = transaction.credit ? Number(transaction.credit) : 0
  return debit + credit
}

function rowsFromTransaction(transaction) {
  if (transaction.splits.length > 0) {
    return transaction.splits.map((s) => ({
      key: `existing-${s.id}`,
      category_id: s.category_id ? String(s.category_id) : '',
      amount: s.amount,
      note: s.note ?? '',
    }))
  }

  // Starting a fresh split from an unsplit transaction - one row prefilled
  // with the whole amount and its current category, so splitting off a
  // second category is a one-field edit (shrink this row's amount, add a
  // row for the rest) rather than starting from nothing.
  return [{
    key: 'initial',
    category_id: transaction.category_id ? String(transaction.category_id) : '',
    amount: transactionAmount(transaction).toFixed(2),
    note: '',
  }]
}

// A category with children groups them and is never itself assignable (see
// api/categories.py's module docstring) - filtered out here up front so a
// split row's own dropdown can't offer a choice the backend will reject.
function assignableCategories(categories) {
  const parentIds = new Set(categories.filter((c) => c.parent_id).map((c) => c.parent_id))
  return categories.filter((c) => !parentIds.has(c.id))
}

export default function SplitEditor({ transaction, categories, onCategoryCreated, onClose, onSaved }) {
  const [rows, setRows] = useState(() => rowsFromTransaction(transaction))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef(null)
  const nextRowKeyRef = useRef(0)

  // Focuses the dialog on open and closes it on Esc - the minimum a modal
  // needs to not trap a keyboard user.
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

  const target = transactionAmount(transaction)
  const rowTotal = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
  // Rounded to cents before comparing - this only protects the LIVE
  // remainder display from ordinary floating-point addition noise (e.g.
  // 33.33 + 33.33 + 33.34 landing a few units of 1e-14 away from zero); it
  // is not a substitute for the backend's own exact Decimal check.
  const remainder = Math.round((target - rowTotal) * 100) / 100
  const balanced = remainder === 0

  const updateRow = (key, field, value) => {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, [field]: value } : row)))
  }

  const addRow = () => {
    nextRowKeyRef.current += 1
    setRows((prev) => [...prev, { key: `new-${nextRowKeyRef.current}`, category_id: '', amount: '', note: '' }])
  }

  const removeRow = (key) => {
    setRows((prev) => prev.filter((row) => row.key !== key))
  }

  const saveSplits = async (splits) => {
    setSaving(true)
    setError('')
    try {
      await api.put(`/transactions/${transaction.id}/splits`, { splits })
      onSaved()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Save failed'
      setError(String(message))
    } finally {
      setSaving(false)
    }
  }

  const handleSave = (event) => {
    event.preventDefault()
    if (!balanced) {
      return
    }
    saveSplits(rows.map((row) => ({
      category_id: row.category_id ? Number(row.category_id) : null,
      amount: row.amount,
      note: row.note || null,
    })))
  }

  const handleUnsplit = () => {
    saveSplits([])
  }

  const options = assignableCategories(categories)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="split-editor-title"
        tabIndex={-1}
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="split-editor-title">Split &quot;{transaction.narration}&quot;</h3>

        {error && <ErrorState label="Save failed:" message={error} />}

        <form onSubmit={handleSave}>
          {rows.map((row) => (
            <div className="split-row" key={row.key}>
              <CategoryQuickAdd
                categories={options}
                value={row.category_id}
                onChange={(value) => updateRow(row.key, 'category_id', value)}
                onCategoryCreated={(category) => {
                  onCategoryCreated(category)
                  updateRow(row.key, 'category_id', String(category.id))
                }}
                label="Category"
              />
              <label>
                Amount
                <input
                  type="number"
                  step="0.01"
                  value={row.amount}
                  onChange={(e) => updateRow(row.key, 'amount', e.target.value)}
                  required
                />
              </label>
              <label>
                Note
                <input
                  type="text"
                  value={row.note}
                  onChange={(e) => updateRow(row.key, 'note', e.target.value)}
                />
              </label>
              <button
                type="button"
                className="button-danger"
                onClick={() => removeRow(row.key)}
                disabled={rows.length <= 1}
                aria-label="Remove this split"
              >
                Remove
              </button>
            </div>
          ))}

          <button type="button" onClick={addRow}>
            + Add split
          </button>

          <p className={balanced ? 'split-remainder' : 'split-remainder split-remainder-error'}>
            Remainder:{' '}
            <Amount value={remainder} neutral={balanced} className={balanced ? '' : 'amount-negative'} />
            {' '}(transaction total <Amount value={target} neutral />)
          </p>

          <div className="modal-actions">
            <button type="submit" className="button-primary" disabled={!balanced || saving}>
              Save split
            </button>
            {transaction.is_split && (
              <button type="button" onClick={handleUnsplit} disabled={saving}>
                Un-split
              </button>
            )}
            <button type="button" onClick={onClose} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
