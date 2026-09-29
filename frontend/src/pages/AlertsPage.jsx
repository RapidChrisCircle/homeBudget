import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Amount from '../components/Amount.jsx'
import Card from '../components/Card.jsx'
import ErrorState from '../components/ErrorState.jsx'
import LoadingState from '../components/LoadingState.jsx'
import PageHeader from '../components/PageHeader.jsx'
import { setAlertsCount } from '../services/alertsCount.ts'
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

// Finding 21 (T5.3) - one sentence per KIND, not per alert: what it means,
// and what resolves it. Repeating this per row would be unreadable at
// hundreds of alerts; saying it once per section is what grouping (below)
// actually buys, beyond just tidiness.
const KIND_EXPLANATIONS = {
  over_budget: 'Spending in this category has passed its budget for the month. Adjust the budget if it was set too low, or open the category to see what drove the total.',
  missed_recurring: 'A bill or subscription that used to arrive on a regular schedule hasn’t shown up when expected - it may have genuinely stopped, changed payment method, or simply not been imported yet.',
  price_change: 'A recurring bill or subscription’s amount changed from what it used to be - worth a quick check that the new amount is right, not a billing mistake.',
  coverage_gap: 'The account’s own running balance jumps in a way that suggests a statement is missing between what’s been imported - import the missing period to keep totals accurate.',
  unmatched_transfer: 'This transaction is categorized as a transfer, but no matching leg was found in another account - either the other side hasn’t been imported yet, or this one isn’t really a transfer.',
}

// Alerts arrive from collect_alerts() already close to kind-ordered (see
// its own docstring); this groups them properly and preserves that same
// first-seen order rather than re-sorting by anything else, so the feed's
// section order doesn't shuffle from one load to the next for no reason.
function groupAlertsByKind(alerts) {
  const order = []
  const byKind = new Map()

  for (const alert of alerts) {
    if (!byKind.has(alert.kind)) {
      byKind.set(alert.kind, [])
      order.push(alert.kind)
    }
    byKind.get(alert.kind).push(alert)
  }

  return order.map((kind) => ({ kind, alerts: byKind.get(kind) }))
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [dismissing, setDismissing] = useState(false)

  // The one place a fresh feed is read - every dismiss path (single,
  // per-group, or all) calls this afterward, and it's also what keeps the
  // shared nav badge (services/alertsCount.ts) from going stale the moment
  // any of them fires, not just on the next full page load.
  const refresh = async () => {
    const response = await api.get('/alerts')
    setAlerts(response.data.alerts)
    setAlertsCount(response.data.count)
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
  // through the generic alert-key dismissal.
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

  // One endpoint for both "Dismiss these N" (kind set) and "Dismiss all"
  // (kind omitted) - see services/alerts.dismiss_all_alerts's own docstring
  // for why this has to be server-side: a mixed feed has two dismissal
  // mechanisms, and only the backend knows which alert uses which. No
  // confirm here - a single kind's worth is the same order of magnitude of
  // consequence as dismissing one alert at a time, just faster.
  const handleDismissGroup = async (kind) => {
    setActionError('')
    setDismissing(true)
    try {
      await api.post('/alerts/dismissals/all', { kind })
      await refresh()
    } catch (err) {
      setActionError(String(err?.response?.data?.detail || err?.message || 'Dismiss failed'))
    } finally {
      setDismissing(false)
    }
  }

  // Confirmed, unlike a per-group dismiss - at hundreds of alerts this is
  // not a mis-click to shrug off, the same reasoning CategoriesPage's own
  // bulk delete already confirms.
  const handleDismissAll = async () => {
    if (!window.confirm(`Dismiss all ${alerts.length} alert${alerts.length === 1 ? '' : 's'}?`)) {
      return
    }
    setActionError('')
    setDismissing(true)
    try {
      await api.post('/alerts/dismissals/all', {})
      await refresh()
    } catch (err) {
      setActionError(String(err?.response?.data?.detail || err?.message || 'Dismiss failed'))
    } finally {
      setDismissing(false)
    }
  }

  const groups = groupAlertsByKind(alerts)

  return (
    <section className="page">
      <PageHeader title="Alerts">
        <button
          type="button"
          className="button-danger"
          onClick={handleDismissAll}
          disabled={alerts.length === 0 || dismissing}
        >
          Dismiss all
        </button>
      </PageHeader>

      {actionError && <ErrorState label="Action failed:" message={actionError} />}

      <Card id="alerts-feed" title="Needs Attention">
        {loading && <LoadingState message="Loading alerts..." />}
        {!loading && error && <ErrorState label="Failed to load alerts:" message={error} />}
        {!loading && !error && alerts.length === 0 && <p>Nothing needs attention right now.</p>}
        {!loading && !error && groups.map((group) => (
          <div key={group.kind} className="alerts-group">
            <h4>
              {KIND_LABELS[group.kind] || group.kind}
              {' '}({group.alerts.length})
            </h4>
            <p className="text-muted">{KIND_EXPLANATIONS[group.kind]}</p>
            <button
              type="button"
              onClick={() => handleDismissGroup(group.kind)}
              disabled={dismissing}
            >
              Dismiss these {group.alerts.length}
            </button>
            <table>
              <caption className="visually-hidden">{KIND_LABELS[group.kind] || group.kind} alerts</caption>
              <thead>
                <tr>
                  <th scope="col">Alert</th>
                  <th scope="col" className="numeric">Amount</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {group.alerts.map((alert) => (
                  <tr key={alert.key}>
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
          </div>
        ))}
      </Card>
    </section>
  )
}
