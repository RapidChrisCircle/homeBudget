import { useState } from 'react'
import CategorySelect from './CategorySelect.jsx'
import ErrorState from './ErrorState.jsx'
import { api } from '../services/api'

function today() {
  return new Date().toISOString().slice(0, 10)
}

const EMPTY_FORM = {
  accountId: '',
  transactionDate: today(),
  narration: '',
  direction: 'debit',
  amount: '',
  categoryId: '',
  note: '',
}

// Records a transaction by hand - cash spending, a reimbursement, or
// anything else that hasn't (yet, or ever will) come from a bank export.
// POST /transactions is the endpoint; see its own docstring in
// api/transactions.py for why a manual entry must be dated on or after the
// chosen account's current latest transaction (its balance is COMPUTED
// forward from that account's own latest balance, not bank-reported, so it
// can only ever extend the ledger, never be inserted into its middle) -
// that constraint is surfaced here as whatever detail the API rejects with,
// not pre-validated client-side, since it depends on data (the account's
// latest transaction date) this form doesn't otherwise need to fetch.
//
// `direction` (Money out / Money in) plus a single positive `amount` field,
// not a signed amount - a household typing "$45 for groceries" should
// never have to remember to type -45. The sign convention is applied
// server-side (TransactionCreate's own docstring), matching this form's UI
// exactly.
export default function AddTransactionForm({ accounts, categories, onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleFieldChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    setError('')
    setSaving(true)

    try {
      const response = await api.post('/transactions', {
        account_id: Number(form.accountId),
        transaction_date: form.transactionDate,
        narration: form.narration,
        debit: form.direction === 'debit' ? form.amount : null,
        credit: form.direction === 'credit' ? form.amount : null,
        category_id: form.categoryId ? Number(form.categoryId) : null,
        note: form.note || null,
      })
      // Account and date are kept as-is (the common case is entering
      // several cash transactions from the same day/account in a row) -
      // only the per-transaction fields reset.
      setForm((prev) => ({ ...EMPTY_FORM, accountId: prev.accountId, transactionDate: prev.transactionDate }))
      await onCreated(response.data)
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Add failed'
      setError(String(message))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <ErrorState label="Add failed:" message={error} />}

      <div>
        <label>
          New transaction account
          <select value={form.accountId} onChange={handleFieldChange('accountId')} required>
            <option value="">Select an account</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
      </div>

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
            placeholder="e.g. Corner store snacks"
            required
          />
        </label>
      </div>

      <div className="transaction-direction-field">
        <span className="transaction-direction-legend">Direction</span>
        <label>
          <input
            type="radio"
            name="add-transaction-direction"
            value="debit"
            checked={form.direction === 'debit'}
            onChange={handleFieldChange('direction')}
          />
          {' '}Money out
        </label>
        <label>
          <input
            type="radio"
            name="add-transaction-direction"
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
          New transaction category
          <CategorySelect
            categories={categories}
            value={form.categoryId}
            onChange={handleFieldChange('categoryId')}
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

      <button type="submit" className="button-primary" disabled={saving}>
        {saving ? 'Adding...' : 'Add transaction'}
      </button>
    </form>
  )
}
