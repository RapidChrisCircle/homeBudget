import { useEffect, useState } from 'react'
import { api } from '../services/api'

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

      <div className="card">
        <h3>{editingId ? 'Edit Account' : 'Add Account'}</h3>
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
          <button type="submit" disabled={saving}>
            {editingId ? 'Save Changes' : 'Add Account'}
          </button>
          {editingId && (
            <button type="button" onClick={cancelEdit} disabled={saving}>
              Cancel
            </button>
          )}
        </form>
      </div>

      <div className="card">
        <h3>All Accounts</h3>

        {loading && <p>Loading accounts...</p>}
        {!loading && error && (
          <p>
            <strong>Failed to load accounts:</strong> {error}
          </p>
        )}

        {!loading && !error && (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Institution</th>
                <th>Type</th>
                <th>BSB</th>
                <th>Account Number</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td>{account.name}</td>
                  <td>{account.institution}</td>
                  <td>{account.account_type}</td>
                  <td>{account.bsb_number}</td>
                  <td>{account.account_number}</td>
                  <td>
                    <button type="button" onClick={() => startEdit(account)}>
                      Edit
                    </button>
                    <button type="button" onClick={() => handleDelete(account.id)}>
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
