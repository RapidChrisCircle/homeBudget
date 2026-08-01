import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Amount from '../components/Amount.jsx'
import Badge from '../components/Badge.jsx'
import ErrorState from '../components/ErrorState.jsx'
import LoadingState from '../components/LoadingState.jsx'
import { api } from '../services/api'
import { recurringLedgerLink } from '../utils/format.js'

const STATUS_LABELS = {
  active: 'Active',
  due_soon: 'Due soon',
  overdue: 'Overdue',
  ended: 'Ended',
}

const STATUS_TONES = {
  active: 'neutral',
  due_soon: 'info',
  overdue: 'warning',
  ended: 'danger',
}

function cadenceLabel(series) {
  return series.cadence.charAt(0).toUpperCase() + series.cadence.slice(1)
}

export default function RecurringPage() {
  const [series, setSeries] = useState([])
  const [summary, setSummary] = useState(null)
  const [asOf, setAsOf] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [showDismissed, setShowDismissed] = useState(false)

  const refresh = async () => {
    // include_dismissed=true so the "Dismissed" section can be shown without
    // a second round trip; the summary the API returns already excludes
    // dismissed series regardless.
    const response = await api.get('/recurring?include_dismissed=true')
    setSeries(response.data.series)
    setSummary(response.data.summary)
    setAsOf(response.data.as_of)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDismiss = async (item) => {
    setActionError('')
    try {
      await api.post('/recurring/dismissals', {
        account_id: item.account_id,
        narration_key: item.narration_key,
      })
      await refresh()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Dismiss failed'
      setActionError(String(message))
    }
  }

  const handleRestore = async (item) => {
    setActionError('')
    try {
      await api.delete(`/recurring/dismissals/${item.dismissal_id}`)
      await refresh()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Restore failed'
      setActionError(String(message))
    }
  }

  if (loading) {
    return (
      <section className="card">
        <h2>Recurring</h2>
        <LoadingState message="Loading recurring payments..." />
      </section>
    )
  }

  if (error) {
    return (
      <section className="card">
        <h2>Recurring</h2>
        <ErrorState label="Failed to load recurring payments:" message={error} />
      </section>
    )
  }

  const active = series.filter((item) => !item.dismissed)
  const dismissed = series.filter((item) => item.dismissed)

  return (
    <section className="card">
      <h2>Recurring</h2>

      {actionError && <ErrorState label="Action failed:" message={actionError} />}

      {asOf && <p>Based on transactions imported up to {asOf}.</p>}

      {active.length === 0 && (
        <p>No recurring payments detected yet. Import a few months of statements and check back.</p>
      )}

      {active.length > 0 && (
        <>
          <p>
            {summary.series_count} recurring payment(s), an estimated <Amount value={summary.total_annual_cost} neutral />{' '}
            a year combined.
          </p>

          <table>
            <thead>
              <tr>
                <th>Merchant</th>
                <th>Account</th>
                <th>Cadence</th>
                <th>Typical amount</th>
                <th>Last seen</th>
                <th>Next due</th>
                <th>Annual cost</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {active.map((item) => (
                <tr key={`${item.account_id}-${item.narration_key}`}>
                  <td>{item.merchant}</td>
                  <td>{item.account_name}</td>
                  <td>{cadenceLabel(item)}</td>
                  <td>
                    <Amount value={item.typical_amount} neutral />
                    {item.amount_varies && ' (varies)'}
                    {item.amount_changed && (
                      <Badge tone="warning" title="Changed from its usual amount at the last occurrence"> (changed)</Badge>
                    )}
                  </td>
                  <td>{item.last_date}</td>
                  <td>{item.next_due_date}</td>
                  <td><Amount value={item.annual_cost} neutral /></td>
                  <td>
                    <Badge tone={STATUS_TONES[item.status] || 'neutral'}>{STATUS_LABELS[item.status] || item.status}</Badge>
                  </td>
                  <td>
                    <Link to={recurringLedgerLink(item.account_id, item.merchant)}>View in ledger</Link>{' '}
                    <button type="button" className="button-ghost" onClick={() => handleDismiss(item)}>
                      Dismiss
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {dismissed.length > 0 && (
        <div className="card">
          <button type="button" onClick={() => setShowDismissed((prev) => !prev)}>
            {showDismissed ? 'Hide' : 'Show'} dismissed ({dismissed.length})
          </button>

          {showDismissed && (
            <table>
              <thead>
                <tr>
                  <th>Merchant</th>
                  <th>Account</th>
                  <th>Cadence</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {dismissed.map((item) => (
                  <tr key={`${item.account_id}-${item.narration_key}`}>
                    <td>{item.merchant}</td>
                    <td>{item.account_name}</td>
                    <td>{cadenceLabel(item)}</td>
                    <td>
                      <button type="button" onClick={() => handleRestore(item)}>
                        Restore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  )
}
