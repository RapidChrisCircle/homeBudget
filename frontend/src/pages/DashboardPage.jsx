import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Card from '../components/Card.jsx'
import EmptyState from '../components/EmptyState.jsx'
import ErrorState from '../components/ErrorState.jsx'
import LoadingState from '../components/LoadingState.jsx'
import { api } from '../services/api'
import { WIDGET_TYPE_KEYS, WIDGET_TYPES, WIDGET_WIDTHS, widgetTypeLabel } from '../widgetRegistry.jsx'

// A simple in/out picture, not the full multi-month analysis /trends
// already gives a whole page to - 6 months is enough to see a trend at a
// glance without turning the dashboard into a second Trends page. Also the
// window every stat_tile/net_worth_change widget's own GET /reports/kpis
// fetch uses (see the comment above fetchDashboardData below).
const CHART_MONTHS = 6
const RECENT_LIMIT = 5

const EMPTY_NEW_WIDGET = { widget_type: 'stat_tile', width: '', config: {} }

// The dashboard is a grid of widgets (see widgetRegistry.jsx), rather than
// a fixed list of Cards - the layout itself is server-side state
// (GET/POST/PUT/DELETE /api/dashboard/widgets, backend/app/api/dashboard.py),
// so a user's own choice of which widgets to show, in what order and how
// wide, survives a reload the same way every other piece of this app's
// state does.
//
// DATA OWNERSHIP: this page still fetches everything itself, in the SAME
// shape it always has (no dashboard-specific endpoint - every widget reads
// data the rest of the app already serves), and hands each widget instance
// exactly the slice widgetRegistry.jsx's own getProps says it needs. This
// is what keeps network traffic flat regardless of how many widgets are on
// the page - four stat_tile widgets share ONE GET /reports/kpis call, not
// four. The two widgets with a genuinely per-instance window
// (transaction_calendar, comparison_sparkline) are the deliberate
// exception - they fetch their own data, since their own `months`/
// `comparisonBasis` config can differ per instance in a way none of the
// shared fetches below can serve.
export default function DashboardPage() {
  const navigate = useNavigate()

  const [widgets, setWidgets] = useState([])
  const [accounts, setAccounts] = useState([])
  const [report, setReport] = useState(null)
  const [trends, setTrends] = useState(null)
  const [kpis, setKpis] = useState(null)
  const [netWorth, setNetWorth] = useState(null)
  const [goals, setGoals] = useState([])
  const [overAllocatedAccounts, setOverAllocatedAccounts] = useState([])
  const [recent, setRecent] = useState([])
  const [transactionTotal, setTransactionTotal] = useState(0)
  const [recurringSeries, setRecurringSeries] = useState([])
  const [recurringSummary, setRecurringSummary] = useState(null)
  const [recurringAsOf, setRecurringAsOf] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [editing, setEditing] = useState(false)
  const [layoutError, setLayoutError] = useState('')
  const [addingWidget, setAddingWidget] = useState(false)
  const [newWidget, setNewWidget] = useState(EMPTY_NEW_WIDGET)

  const fetchDashboardData = () => Promise.all([
    api.get('/dashboard/widgets'),
    api.get('/accounts'),
    api.get('/reports/monthly?months=1'),
    api.get(`/trends?months=${CHART_MONTHS}`),
    // Same months window as the two charts above - one shared KPI window
    // for every stat_tile/net_worth_change widget on the page, see this
    // component's own module docstring on why that's a deliberate
    // simplification rather than a fetch per widget instance.
    api.get(`/reports/kpis?months=${CHART_MONTHS}`),
    api.get('/net-worth'),
    api.get('/goals'),
    api.get(`/transactions?page_size=${RECENT_LIMIT}`),
    api.get('/recurring'),
  ])

  useEffect(() => {
    let cancelled = false

    setLoading(true)
    setError('')

    fetchDashboardData()
      .then(([widgetsRes, accountsRes, reportRes, trendsRes, kpisRes, netWorthRes, goalsRes, transactionsRes, recurringRes]) => {
        if (!cancelled) {
          setWidgets(widgetsRes.data)
          setAccounts(accountsRes.data)
          setReport(reportRes.data)
          setTrends(trendsRes.data)
          setKpis(kpisRes.data)
          setNetWorth(netWorthRes.data)
          setGoals(goalsRes.data.goals)
          setOverAllocatedAccounts(goalsRes.data.account_envelope_summaries.filter((s) => s.over_allocated))
          setRecent(transactionsRes.data.items)
          setTransactionTotal(transactionsRes.data.total)
          setRecurringSeries(recurringRes.data.series)
          setRecurringSummary(recurringRes.data.summary)
          setRecurringAsOf(recurringRes.data.as_of)
        }
      })
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

  const refreshWidgets = async () => {
    const response = await api.get('/dashboard/widgets')
    setWidgets(response.data)
  }

  const moveWidget = async (widgetId, direction) => {
    setLayoutError('')
    try {
      const response = await api.post(`/dashboard/widgets/${widgetId}/move`, { direction })
      setWidgets(response.data)
    } catch (err) {
      setLayoutError(String(err?.response?.data?.detail || err?.message || 'Move failed'))
    }
  }

  const updateWidgetWidth = async (widget, width) => {
    setLayoutError('')
    try {
      await api.put(`/dashboard/widgets/${widget.id}`, { width, config: widget.config })
      await refreshWidgets()
    } catch (err) {
      setLayoutError(String(err?.response?.data?.detail || err?.message || 'Update failed'))
    }
  }

  const removeWidget = async (widgetId) => {
    if (!window.confirm('Remove this widget from the dashboard?')) {
      return
    }
    setLayoutError('')
    try {
      await api.delete(`/dashboard/widgets/${widgetId}`)
      await refreshWidgets()
    } catch (err) {
      setLayoutError(String(err?.response?.data?.detail || err?.message || 'Remove failed'))
    }
  }

  const handleAddWidget = async (event) => {
    event.preventDefault()
    setLayoutError('')

    const entry = WIDGET_TYPES[newWidget.widget_type]

    try {
      await api.post('/dashboard/widgets', {
        widget_type: newWidget.widget_type,
        width: newWidget.width || entry.defaultWidth,
        config: Object.keys(newWidget.config).length > 0 ? newWidget.config : null,
      })
      setNewWidget(EMPTY_NEW_WIDGET)
      setAddingWidget(false)
      await refreshWidgets()
    } catch (err) {
      setLayoutError(String(err?.response?.data?.detail || err?.message || 'Add failed'))
    }
  }

  const setNewWidgetConfigField = (key, value) => {
    setNewWidget((prev) => ({ ...prev, config: { ...prev.config, [key]: value } }))
  }

  if (loading) {
    return (
      <section className="page">
        <h2>Dashboard</h2>
        <LoadingState message="Loading dashboard..." />
      </section>
    )
  }

  if (error) {
    return (
      <section className="page">
        <h2>Dashboard</h2>
        <ErrorState label="Failed to load dashboard:" message={error} />
      </section>
    )
  }

  if (transactionTotal === 0) {
    return (
      <section className="page">
        <h2>Dashboard</h2>
        <EmptyState message="No transactions imported yet.">
          <Link to="/transactions">Import a bank statement to get started</Link>
        </EmptyState>
      </section>
    )
  }

  // Passed as-is to every widgetRegistry.jsx getProps() call - see this
  // component's own module docstring on why this is the one place all of
  // that data is assembled, not fetched per widget.
  const widgetData = {
    accounts, report, trends, kpis, netWorth, goals, overAllocatedAccounts,
    recent, recurringSeries, recurringSummary, recurringAsOf, navigate,
  }

  const newWidgetEntry = WIDGET_TYPES[newWidget.widget_type]

  return (
    <section className="page">
      <div className="dashboard-header">
        <h2>Dashboard</h2>
        <div className="dashboard-header-actions">
          <button type="button" onClick={() => setAddingWidget((prev) => !prev)}>
            {addingWidget ? 'Cancel' : 'Add new widget'}
          </button>
          <button type="button" className={editing ? 'button-primary' : ''} onClick={() => setEditing((prev) => !prev)}>
            {editing ? 'Done editing' : 'Edit dashboard'}
          </button>
        </div>
      </div>

      {layoutError && <ErrorState label="Action failed:" message={layoutError} />}

      {addingWidget && (
        <Card id="dashboard-add-widget" title="Add a Widget">
          <form onSubmit={handleAddWidget}>
            <div>
              <label>
                Widget type
                <select
                  value={newWidget.widget_type}
                  onChange={(event) => setNewWidget({ widget_type: event.target.value, width: '', config: {} })}
                >
                  {WIDGET_TYPE_KEYS.map((widgetType) => (
                    <option key={widgetType} value={widgetType}>{widgetTypeLabel(widgetType)}</option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <label>
                Width
                <select value={newWidget.width} onChange={(event) => setNewWidget((prev) => ({ ...prev, width: event.target.value }))}>
                  <option value="">Default ({newWidgetEntry.defaultWidth})</option>
                  {WIDGET_WIDTHS.map((width) => (
                    <option key={width} value={width}>{width}</option>
                  ))}
                </select>
              </label>
            </div>
            {newWidgetEntry.configFields.map((field) => (
              <div key={field.key}>
                <label>
                  {field.label}
                  {field.type === 'select' ? (
                    <select
                      value={newWidget.config[field.key] ?? ''}
                      onChange={(event) => setNewWidgetConfigField(field.key, event.target.value)}
                    >
                      <option value="">Select {field.label.toLowerCase()}</option>
                      {field.options.map((option) => (
                        <option key={option} value={option}>
                          {field.optionLabel ? field.optionLabel(option) : option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="number"
                      min={field.min}
                      max={field.max}
                      value={newWidget.config[field.key] ?? ''}
                      onChange={(event) => setNewWidgetConfigField(field.key, Number(event.target.value))}
                    />
                  )}
                </label>
              </div>
            ))}
            <button type="submit" className="button-primary">Add Widget</button>
          </form>
        </Card>
      )}

      <div className="widget-grid">
        {widgets.map((widget, index) => {
          const entry = WIDGET_TYPES[widget.widget_type]

          // A widget_type this frontend build doesn't (or no longer) know
          // how to render - a stale row from a downgrade, or a config
          // saved by a later version. Skip it rather than crash the whole
          // dashboard over one unrenderable widget.
          if (!entry) {
            return null
          }

          const { Component } = entry
          const props = entry.getProps(widget.config || {}, widgetData)
          const title = entry.getTitle(widget.config || {}, widgetData)

          const controls = editing && (
            <div className="widget-controls">
              <button type="button" onClick={() => moveWidget(widget.id, 'up')} disabled={index === 0} aria-label={`Move ${title} up`}>↑</button>
              <button type="button" onClick={() => moveWidget(widget.id, 'down')} disabled={index === widgets.length - 1} aria-label={`Move ${title} down`}>↓</button>
              <label>
                Width
                <select value={widget.width} onChange={(event) => updateWidgetWidth(widget, event.target.value)} aria-label={`Width for ${title}`}>
                  {WIDGET_WIDTHS.map((width) => (
                    <option key={width} value={width}>{width}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="button-danger" onClick={() => removeWidget(widget.id)} aria-label={`Remove ${title}`}>
                Remove
              </button>
            </div>
          )

          if (entry.bare) {
            return (
              <div key={widget.id} className={`widget-${widget.width}`}>
                {controls}
                <Component {...props} />
              </div>
            )
          }

          return (
            <div key={widget.id} className={`widget-${widget.width}`}>
              <Card id={`dashboard-widget-${widget.id}`} title={title}>
                {controls}
                <Component {...props} />
              </Card>
            </div>
          )
        })}
      </div>
    </section>
  )
}
