import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Card from '../components/Card.jsx'
import ErrorState from '../components/ErrorState.jsx'
import LoadingState from '../components/LoadingState.jsx'
import { api } from '../services/api'
import { ACCOUNT_TYPE_OPTIONS, accountTypeLabel, isLiabilityType } from '../utils/accountTypes.js'
import { formatBalance } from '../utils/format.js'

const EMPTY_FORM = {
  name: '',
  institution: '',
  account_type: '',
  balance_sign: 'natural',
  bsb_number: '',
  account_number: '',
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  // A SUGGESTION only, fetched when editing an existing liability account -
  // never auto-applied to the form, see startEdit/handleUseInferredSign
  // below and services/net_worth.infer_balance_sign's own docstring.
  const [inference, setInference] = useState(null)
  const [inferenceLoading, setInferenceLoading] = useState(false)

  const refresh = async () => {
    const response = await api.get('/accounts')
    setAccounts(response.data)
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

  const startEdit = (account) => {
    setEditingId(account.id)
    setInference(null)
    setForm({
      name: account.name,
      institution: account.institution || '',
      account_type: account.account_type || '',
      balance_sign: account.balance_sign || 'natural',
      bsb_number: account.bsb_number || '',
      account_number: account.account_number,
    })

    if (isLiabilityType(account.account_type)) {
      fetchInference(account.id)
    }
  }

  const fetchInference = async (accountId) => {
    setInferenceLoading(true)
    try {
      const response = await api.get(`/accounts/${accountId}/infer-balance-sign`)
      setInference(response.data)
    } catch {
      // The inference is a nice-to-have hint, not core functionality - a
      // failed fetch here just means no hint shows, it must not block
      // editing the account.
      setInference(null)
    } finally {
      setInferenceLoading(false)
    }
  }

  // Re-fetches the inference whenever editing an account and its type is
  // changed TO a liability type (e.g. classifying a previously-unclassified
  // account) - not just when the edit form first opens.
  const handleAccountTypeChange = (event) => {
    const nextType = event.target.value
    setForm((prev) => ({ ...prev, account_type: nextType }))
    setInference(null)
    if (editingId && isLiabilityType(nextType)) {
      fetchInference(editingId)
    }
  }

  const handleUseInferredSign = () => {
    if (inference?.inferred_sign) {
      setForm((prev) => ({ ...prev, balance_sign: inference.inferred_sign }))
    }
  }

  const cancelEdit = () => {
    setEditingId(null)
    setInference(null)
    setForm(EMPTY_FORM)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    setActionError('')
    setSaving(true)

    const payload = {
      name: form.name,
      institution: form.institution || null,
      account_type: form.account_type || null,
      // Only meaningful for a liability - sent regardless (the backend
      // defaults it the same way), so an asset's field just stays "natural".
      balance_sign: form.balance_sign,
      bsb_number: form.bsb_number || null,
      account_number: form.account_number,
    }

    try {
      if (editingId) {
        await api.put(`/accounts/${editingId}`, payload)
      } else {
        await api.post('/accounts', payload)
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
    if (!window.confirm('Delete this account?')) {
      return
    }
    setActionError('')
    try {
      await api.delete(`/accounts/${id}`)
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
      <h2>Accounts</h2>

      {actionError && (
        <p>
          <strong>Action failed:</strong> {actionError}
        </p>
      )}

      <Card id="accounts-form" title={editingId ? 'Edit Account' : 'Add Account'}>
        <form onSubmit={handleSubmit}>
          <div>
            <label>
              Name
              <input type="text" value={form.name} onChange={handleFieldChange('name')} required />
            </label>
          </div>
          <div>
            <label>
              Institution
              <input type="text" value={form.institution} onChange={handleFieldChange('institution')} />
            </label>
          </div>
          <div>
            <label>
              Account Type
              <select value={form.account_type} onChange={handleAccountTypeChange}>
                <option value="">Unclassified</option>
                {ACCOUNT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Unclassified accounts are excluded from Net Worth on the Dashboard rather than
              guessed at.
            </p>
          </div>
          {isLiabilityType(form.account_type) && (
            <div>
              <label>
                Balance sign
                <select value={form.balance_sign} onChange={handleFieldChange('balance_sign')}>
                  <option value="natural">Natural &mdash; debt shows as a negative balance</option>
                  <option value="inverted">Inverted &mdash; debt shows as a positive amount owed</option>
                </select>
              </label>
              <p>
                This decides whether the balance this account reports SUBTRACTS from Net Worth
                correctly &mdash; different banks report a card or loan balance differently.
              </p>
              {inferenceLoading && <p>Checking this account&apos;s own history...</p>}
              {!inferenceLoading && inference?.inferred_sign && inference.sample_size > 0 && (
                <p>
                  Inferred from {inference.sample_size} past balance{inference.sample_size === 1 ? '' : 's'}:{' '}
                  <strong>{inference.inferred_sign}</strong>.{' '}
                  {inference.inferred_sign !== form.balance_sign && (
                    <button type="button" className="button-ghost" onClick={handleUseInferredSign}>
                      Use this
                    </button>
                  )}
                </p>
              )}
            </div>
          )}
          <div>
            <label>
              BSB Number
              <input type="text" value={form.bsb_number} onChange={handleFieldChange('bsb_number')} />
            </label>
          </div>
          <div>
            <label>
              Account Number
              <input
                type="text"
                value={form.account_number}
                onChange={handleFieldChange('account_number')}
                required
              />
            </label>
          </div>
          <button type="submit" className="button-primary" disabled={saving}>
            {editingId ? 'Save Changes' : 'Add Account'}
          </button>
          {editingId && (
            <button type="button" onClick={cancelEdit} disabled={saving}>
              Cancel
            </button>
          )}
        </form>
      </Card>

      <Card id="accounts-list" title="All Accounts">
        {loading && <LoadingState message="Loading accounts..." />}
        {!loading && error && <ErrorState label="Failed to load accounts:" message={error} />}

        {!loading && !error && (
          <table>
            <caption className="visually-hidden">All accounts</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Institution</th>
                <th scope="col">Type</th>
                <th scope="col">BSB</th>
                <th scope="col">Account Number</th>
                <th scope="col">Balance</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td>
                    <Link to={`/accounts/${account.id}`}>{account.name}</Link>
                  </td>
                  <td>{account.institution}</td>
                  <td>{accountTypeLabel(account.account_type)}</td>
                  <td>{account.bsb_number}</td>
                  <td>{account.account_number}</td>
                  <td>{formatBalance(account)}</td>
                  <td>
                    <button type="button" onClick={() => startEdit(account)}>
                      Edit
                    </button>
                    <button type="button" className="button-danger" onClick={() => handleDelete(account.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </section>
  )
}
