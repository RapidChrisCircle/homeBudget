import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Card from '../components/Card.jsx'
import ErrorState from '../components/ErrorState.jsx'
import LoadingState from '../components/LoadingState.jsx'
import { api } from '../services/api'
import { formatBalance } from '../utils/format.js'

const EMPTY_FORM = {
  name: '',
  institution: '',
  account_type: '',
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
    setForm({
      name: account.name,
      institution: account.institution || '',
      account_type: account.account_type || '',
      bsb_number: account.bsb_number || '',
      account_number: account.account_number,
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

    const payload = {
      name: form.name,
      institution: form.institution || null,
      account_type: form.account_type || null,
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
              <input type="text" value={form.account_type} onChange={handleFieldChange('account_type')} />
            </label>
          </div>
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
                  <td>{account.account_type}</td>
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
