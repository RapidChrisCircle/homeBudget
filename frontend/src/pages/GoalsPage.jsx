import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Amount from '../components/Amount.jsx'
import Badge from '../components/Badge.jsx'
import Card from '../components/Card.jsx'
import ErrorState from '../components/ErrorState.jsx'
import LoadingState from '../components/LoadingState.jsx'
import { api } from '../services/api'

const EMPTY_FORM = {
  name: '',
  target_amount: '',
  target_date: '',
  mode: 'account_balance',
  account_id: '',
  allocated_amount: '',
}

const MODE_LABELS = {
  account_balance: 'Account balance',
  envelope: 'Envelope',
}

// Blank optional fields go as null, and the field the OTHER mode owns is
// dropped entirely - the backend coerces it anyway (see api/goals.py's
// _validate_goal_payload), but sending a stale value from the form's own
// state (left over from switching modes) would be confusing to read back.
function buildPayload(form) {
  return {
    name: form.name,
    target_amount: form.target_amount,
    target_date: form.target_date || null,
    mode: form.mode,
    account_id: form.account_id ? Number(form.account_id) : null,
    allocated_amount: form.mode === 'envelope' ? (form.allocated_amount || '0') : null,
  }
}

export default function GoalsPage() {
  const [goals, setGoals] = useState([])
  const [accountEnvelopeSummaries, setAccountEnvelopeSummaries] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)

  const refresh = async () => {
    const [goalsRes, accountsRes] = await Promise.all([
      api.get('/goals?include_archived=true'),
      api.get('/accounts'),
    ])
    setGoals(goalsRes.data.goals)
    setAccountEnvelopeSummaries(goalsRes.data.account_envelope_summaries)
    setAccounts(accountsRes.data)
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

  const startEdit = (goal) => {
    setEditingId(goal.id)
    setForm({
      name: goal.name,
      target_amount: goal.target_amount,
      target_date: goal.target_date || '',
      mode: goal.mode,
      account_id: goal.account_id ?? '',
      allocated_amount: goal.allocated_amount ?? '',
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
        await api.put(`/goals/${editingId}`, buildPayload(form))
      } else {
        await api.post('/goals', buildPayload(form))
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

  const handleArchive = async (id) => {
    setActionError('')
    try {
      await api.post(`/goals/${id}/archive`)
      await refresh()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Archive failed'
      setActionError(String(message))
    }
  }

  const handleRestore = async (id) => {
    setActionError('')
    try {
      await api.post(`/goals/${id}/restore`)
      await refresh()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Restore failed'
      setActionError(String(message))
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this goal? This cannot be undone.')) {
      return
    }
    setActionError('')
    try {
      await api.delete(`/goals/${id}`)
      if (editingId === id) {
        cancelEdit()
      }
      await refresh()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Delete failed'
      setActionError(String(message))
    }
  }

  const activeGoals = goals.filter((goal) => !goal.archived)
  const archivedGoals = goals.filter((goal) => goal.archived)
  const overAllocated = accountEnvelopeSummaries.filter((summary) => summary.over_allocated)

  return (
    <section className="card">
      <h2>Goals</h2>

      {actionError && <ErrorState label="Action failed:" message={actionError} />}

      {overAllocated.length > 0 && (
        <Card id="goals-over-allocated" title="Over-allocated accounts">
          <p>
            These accounts have envelope goals adding up to more than the account actually holds
            &mdash; the money is committed on paper but isn&apos;t all really there yet.
          </p>
          <ul>
            {overAllocated.map((summary) => (
              <li key={summary.account_id}>
                <Link to={`/accounts/${summary.account_id}`}>{summary.account_name}</Link>: envelopes total{' '}
                <Amount value={summary.allocated_total} neutral />, account holds{' '}
                <Amount value={summary.account_balance} neutral /> &mdash; over by{' '}
                <Amount value={summary.over_allocated_by} neutral className="amount-negative" />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card id="goals-form" title={editingId ? 'Edit Goal' : 'Add Goal'}>
        <form onSubmit={handleSubmit}>
          <div>
            <label>
              Name
              <input type="text" value={form.name} onChange={handleFieldChange('name')} required />
            </label>
          </div>
          <div>
            <label>
              Target amount
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={form.target_amount}
                onChange={handleFieldChange('target_amount')}
                required
              />
            </label>
          </div>
          <div>
            <label>
              Target date
              <input type="date" value={form.target_date} onChange={handleFieldChange('target_date')} />
            </label>
            <p>Optional &mdash; leave blank if you&apos;re not working to a deadline.</p>
          </div>
          <div>
            <label>
              Tracking method
              <select value={form.mode} onChange={handleFieldChange('mode')}>
                <option value="account_balance">Account balance</option>
                <option value="envelope">Envelope</option>
              </select>
            </label>
            <p>
              {form.mode === 'account_balance'
                ? "Progress is that account's real balance - honest by construction, since it comes straight from the bank."
                : 'Progress is an amount you set aside yourself, for several goals sharing one account.'}
            </p>
          </div>
          {form.mode === 'envelope' && (
            <div>
              <label>
                Allocated so far
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.allocated_amount}
                  onChange={handleFieldChange('allocated_amount')}
                  required
                />
              </label>
            </div>
          )}
          <div>
            <label>
              {form.mode === 'account_balance' ? 'Account' : 'Account (optional, which one holds this money)'}
              <select
                value={form.account_id}
                onChange={handleFieldChange('account_id')}
                required={form.mode === 'account_balance'}
              >
                <option value="">
                  {form.mode === 'account_balance' ? 'Select an account' : 'Not linked to an account'}
                </option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button type="submit" className="button-primary" disabled={saving}>
            {editingId ? 'Save Changes' : 'Add Goal'}
          </button>
          {editingId && (
            <button type="button" onClick={cancelEdit} disabled={saving}>
              Cancel
            </button>
          )}
        </form>
      </Card>

      <Card id="goals-list" title="Goals">
        {loading && <LoadingState message="Loading goals..." />}
        {!loading && error && <ErrorState label="Failed to load goals:" message={error} />}

        {!loading && !error && activeGoals.length === 0 && <p>No goals yet.</p>}

        {!loading && !error && activeGoals.length > 0 && (
          <table>
            <caption className="visually-hidden">Savings goals</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Method</th>
                <th scope="col">Progress</th>
                <th scope="col">Remaining</th>
                <th scope="col">Monthly needed</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {activeGoals.map((goal) => {
                const met = Number(goal.remaining) <= 0
                return (
                  <tr key={goal.id}>
                    <td>
                      {goal.name}
                      {goal.account_name && <div className="text-muted">{goal.account_name}</div>}
                    </td>
                    <td>
                      <Badge tone="neutral">{MODE_LABELS[goal.mode]}</Badge>
                    </td>
                    <td>
                      <Amount value={goal.current_amount} neutral /> of{' '}
                      <Amount value={goal.target_amount} neutral /> ({Number(goal.percent).toFixed(0)}%)
                      {met && <Badge tone="success" title="Target reached"> met</Badge>}
                    </td>
                    <td>
                      <Amount value={goal.remaining} neutral />
                    </td>
                    <td>
                      {goal.monthly_required !== null ? (
                        <Amount value={goal.monthly_required} neutral />
                      ) : (
                        <span className="text-muted">&mdash;</span>
                      )}
                    </td>
                    <td>
                      <button type="button" onClick={() => startEdit(goal)}>
                        Edit
                      </button>
                      <button type="button" onClick={() => handleArchive(goal.id)}>
                        Archive
                      </button>
                      <button type="button" className="button-danger" onClick={() => handleDelete(goal.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card id="goals-archived" title="Archived">
        {archivedGoals.length === 0 ? (
          <p>Nothing archived.</p>
        ) : (
          <table>
            <caption className="visually-hidden">Archived goals</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {archivedGoals.map((goal) => (
                <tr key={goal.id}>
                  <td>{goal.name}</td>
                  <td>
                    <button type="button" onClick={() => handleRestore(goal.id)}>
                      Restore
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
