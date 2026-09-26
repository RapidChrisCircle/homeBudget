import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Amount from '../components/Amount.jsx'
import Badge from '../components/Badge.jsx'
import Card from '../components/Card.jsx'
import ErrorState from '../components/ErrorState.jsx'
import LoadingState from '../components/LoadingState.jsx'
import { api } from '../services/api'

// Assembly only - see backend/app/services/alerts.py's module docstring.
// Every kind here is detected somewhere else in the app already; this page
// exists so a household doesn't have to remember to go check five pages.
const KIND_LABELS = {
  over_budget: 'Over budget',
  missed_recurring: 'Missed / stopped',
  price_change: 'Price change',
  coverage_gap: 'Coverage gap',
  unmatched_transfer: 'Unmatched transfer',
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')

  const refresh = async () => {
    const response = await api.get('/alerts')
    setAlerts(response.data.alerts)
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

  // A recurring-sourced alert (a price change, a missed/stopped series)
  // dismisses through the SAME endpoint RecurringPage's own Dismiss button
  // already uses - see services/alerts.py's docstring for why this
  // deliberately isn't a second dismissal system. Everything else goes
  // through the new, generic alert-key dismissal.
  const handleDismiss = async (alert) => {
    setActionError('')
    try {
      if (alert.dismiss_kind === 'recurring') {
        await api.post('/recurring/dismissals', {
          account_id: alert.recurring_account_id,
          narration_key: alert.recurring_narration_key,
        })
      } else {
        await api.post('/alerts/dismissals', { alert_key: alert.key })
      }
      await refresh()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Dismiss failed'
      setActionError(String(message))
    }
  }

  return (
    <section className="page">
      <h2>Alerts</h2>

      {actionError && <ErrorState label="Action failed:" message={actionError} />}

      <Card id="alerts-feed" title="Needs Attention">
        {loading && <LoadingState message="Loading alerts..." />}
        {!loading && error && <ErrorState label="Failed to load alerts:" message={error} />}
        {!loading && !error && alerts.length === 0 && <p>Nothing needs attention right now.</p>}
        {!loading && !error && alerts.length > 0 && (
          <table>
            <caption className="visually-hidden">Alerts needing attention</caption>
            <thead>
              <tr>
                <th scope="col">Kind</th>
                <th scope="col">Alert</th>
                <th scope="col" className="numeric">Amount</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert) => (
                <tr key={alert.key}>
                  <td><Badge tone="neutral"> {KIND_LABELS[alert.kind] || alert.kind}</Badge></td>
                  <td>
                    <div>
                      {alert.link ? <Link to={alert.link}>{alert.title}</Link> : alert.title}
                    </div>
                    <div>{alert.detail}</div>
                  </td>
                  <td>{alert.amount !== null && <Amount value={alert.amount} neutral />}</td>
                  <td>
                    <button type="button" onClick={() => handleDismiss(alert)}>
                      Dismiss
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
