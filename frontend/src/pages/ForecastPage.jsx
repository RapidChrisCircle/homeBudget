import { useEffect, useState } from 'react'
import Amount from '../components/Amount.jsx'
import Card from '../components/Card.jsx'
import CategorySelect from '../components/CategorySelect.jsx'
import LineChart from '../components/charts/LineChart.jsx'
import EmptyState from '../components/EmptyState.jsx'
import ErrorState from '../components/ErrorState.jsx'
import LoadingState from '../components/LoadingState.jsx'
import SortableHeader from '../components/SortableHeader.jsx'
import { api } from '../services/api'
import { formatAmount } from '../utils/format.js'
import { useTableSort } from '../utils/tableSort.js'

// A stopped-series checkbox is keyed on (account_id, narration_key) - the
// same natural key services/forecast.py's stopped_series_keys matches
// against - via JSON, not string concatenation, so a narration_key
// containing an arbitrary character can never collide with a delimiter.
function stoppedSeriesKey(accountId, narrationKey) {
  return JSON.stringify([accountId, narrationKey])
}

const DEFAULT_MONTHS = 3

// Upcoming Commitments is a flat list, genuinely sortable. The per-account
// monthly tables below are deliberately NOT sortable - Month is a
// chronological projection (like Rules' priority order), and reordering it
// by, say, Closing balance would destroy the "watch the trend unfold" the
// table exists to show, the same reasoning that keeps Rules unsorted.
const UPCOMING_SORT_COLUMNS = {
  due: { getValue: (i) => i.due_date, type: 'date' },
  merchant: { getValue: (i) => i.merchant, type: 'string' },
  amount: { getValue: (i) => i.amount, type: 'numeric' },
  direction: { getValue: (i) => i.direction, type: 'string' },
}

export default function ForecastPage() {
  const [forecast, setForecast] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Scenarios (T3.1) - a non-destructive "what if" overlay computed by the
  // backend (services/forecast.py), never a second, client-side projection.
  // Categories are fetched once, lazily, only for the adjustment picker -
  // this page doesn't need them for anything else.
  const [categories, setCategories] = useState([])
  const [stoppedKeys, setStoppedKeys] = useState(() => new Set())
  const [adjustmentRows, setAdjustmentRows] = useState([])
  const [scenario, setScenario] = useState(null)
  const [scenarioLoading, setScenarioLoading] = useState(false)
  const [scenarioError, setScenarioError] = useState('')

  useEffect(() => {
    let cancelled = false

    setLoading(true)
    setError('')

    api.get(`/forecast?months=${DEFAULT_MONTHS}`)
      .then((response) => {
        if (!cancelled) {
          setForecast(response.data)
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

  useEffect(() => {
    let cancelled = false

    api.get('/categories')
      .then((response) => {
        if (!cancelled) {
          setCategories(response.data)
        }
      })
      .catch(() => {
        // The scenario picker just offers no categories to adjust - the
        // rest of the page (a live projection) doesn't depend on this.
      })

    return () => {
      cancelled = true
    }
  }, [])

  // Called unconditionally, before the loading/error/empty early returns
  // below - React requires hooks to run in the same order every render.
  const upcomingSort = useTableSort(forecast?.upcoming ?? [], UPCOMING_SORT_COLUMNS)

  const toggleStoppedSeries = (accountId, narrationKeyValue) => {
    const key = stoppedSeriesKey(accountId, narrationKeyValue)
    setStoppedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const addAdjustmentRow = () => {
    setAdjustmentRows((prev) => [...prev, { key: `adjustment-${prev.length}-${Date.now()}`, category_id: '', percent: '' }])
  }

  const updateAdjustmentRow = (key, field, value) => {
    setAdjustmentRows((prev) => prev.map((row) => (row.key === key ? { ...row, [field]: value } : row)))
  }

  const removeAdjustmentRow = (key) => {
    setAdjustmentRows((prev) => prev.filter((row) => row.key !== key))
  }

  const activeAdjustments = adjustmentRows.filter((row) => row.category_id && row.percent !== '')
  const hasScenarioInputs = stoppedKeys.size > 0 || activeAdjustments.length > 0

  const runScenario = async () => {
    setScenarioError('')
    setScenarioLoading(true)
    try {
      const stopped_series = [...stoppedKeys].map((key) => {
        const [account_id, narration_key] = JSON.parse(key)
        return { account_id, narration_key }
      })
      const category_adjustments = activeAdjustments.map((row) => ({
        category_id: Number(row.category_id),
        percent: row.percent,
      }))
      const response = await api.post('/forecast/scenario', {
        months: DEFAULT_MONTHS,
        stopped_series,
        category_adjustments,
      })
      setScenario(response.data)
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Scenario failed'
      setScenarioError(String(message))
    } finally {
      setScenarioLoading(false)
    }
  }

  const clearScenario = () => {
    setScenario(null)
    setStoppedKeys(new Set())
    setAdjustmentRows([])
    setScenarioError('')
  }

  if (loading) {
    return (
      <section className="page">
        <h2>Forecast</h2>
        <LoadingState message="Loading forecast..." />
      </section>
    )
  }

  if (error) {
    return (
      <section className="page">
        <h2>Forecast</h2>
        <ErrorState label="Failed to load forecast:" message={error} />
      </section>
    )
  }

  if (!forecast.as_of || forecast.accounts.length === 0) {
    return (
      <section className="page">
        <h2>Forecast</h2>
        <EmptyState message="Not enough history yet - import a few months of statements and check back." />
      </section>
    )
  }

  const { as_of: asOf, accounts, combined, upcoming } = forecast
  const periodLabels = accounts[0].months.map((m) => m.label)

  const balanceSeries = [
    ...accounts.map((account) => ({
      label: account.account_name || `Account ${account.account_id}`,
      values: account.months.map((m) => Number(m.closing)),
    })),
    // "Combined cash position", not "Net worth" - deliberate. The forecast
    // is a projection of cash on hand, built from raw closing balances
    // (services/forecast.py), not signed by account type/balance_sign the
    // way services/net_worth.py is - netting a projected credit card
    // balance against a projected everyday balance here would answer a
    // different question ("what will I be worth") than the one this page
    // exists to answer ("will I run short of cash"). The label says so
    // explicitly so the two figures - this one and the Dashboard's Net
    // Worth chart - are never mistaken for the same thing.
    { label: 'Combined cash position', values: combined.months.map((m) => Number(m.closing)) },
  ]

  // One row per unique recurring series across the whole upcoming list -
  // several occurrences of the same series would otherwise offer the
  // identical "stop this" checkbox more than once.
  const uniqueSeries = []
  const seenSeriesKeys = new Set()
  for (const item of upcoming) {
    const key = stoppedSeriesKey(item.account_id, item.narration_key)
    if (!seenSeriesKeys.has(key)) {
      seenSeriesKeys.add(key)
      uniqueSeries.push(item)
    }
  }

  const accountName = (accountId) =>
    accounts.find((a) => a.account_id === accountId)?.account_name || `Account ${accountId}`

  // While a scenario is active, the chart swaps to a direct two-line
  // comparison (baseline muted, scenario normal - the same "one series is
  // the point, rest is context" convention Spending Pace's own comparison
  // line already uses) rather than cluttering the default per-account view
  // with a second set of lines per account.
  const chartSeries = scenario
    ? [
        { label: 'Baseline combined', values: combined.months.map((m) => Number(m.closing)), muted: true },
        { label: 'Scenario combined', values: scenario.combined.months.map((m) => Number(m.closing)) },
      ]
    : balanceSeries

  const scenarioDelta = scenario
    ? Number(scenario.combined.months.at(-1).closing) - Number(combined.months.at(-1).closing)
    : null

  return (
    <section className="page">
      <h2>Forecast</h2>

      <p>
        Projected from transactions imported up to {asOf}: known recurring commitments plus an
        estimated everyday-spending run rate, at monthly resolution. This is a projection, not a
        guarantee - a month that closes comfortably can still dip lower partway through it.
      </p>

      <Card id="forecast-scenarios" title="Scenarios">
        <p>
          A non-destructive &ldquo;what if&rdquo; &mdash; nothing here changes any real
          transaction, category or recurring series. Stop a subscription, or adjust a category&rsquo;s
          everyday spending, and see how the projection would change.
        </p>

        {uniqueSeries.length > 0 && (
          <div className="forecast-scenario-group">
            <span className="forecast-scenario-legend">Stop a recurring commitment</span>
            {uniqueSeries.map((item) => {
              const key = stoppedSeriesKey(item.account_id, item.narration_key)
              return (
                <label key={key} className="forecast-scenario-checkbox">
                  <input
                    type="checkbox"
                    checked={stoppedKeys.has(key)}
                    onChange={() => toggleStoppedSeries(item.account_id, item.narration_key)}
                  />
                  {' '}{item.merchant} ({accountName(item.account_id)})
                </label>
              )
            })}
          </div>
        )}

        <div className="forecast-scenario-group">
          <span className="forecast-scenario-legend">Adjust a category&rsquo;s everyday spending</span>
          {adjustmentRows.map((row) => (
            <div key={row.key} className="forecast-scenario-adjustment">
              <CategorySelect
                aria-label="Category to adjust"
                categories={categories}
                value={row.category_id}
                onChange={(e) => updateAdjustmentRow(row.key, 'category_id', e.target.value)}
              >
                <option value="">Select a category</option>
              </CategorySelect>
              <input
                type="number"
                step="1"
                aria-label="Percent change"
                placeholder="e.g. -20"
                value={row.percent}
                onChange={(e) => updateAdjustmentRow(row.key, 'percent', e.target.value)}
              />
              <span>%</span>
              <button
                type="button"
                className="button-ghost"
                aria-label="Remove this adjustment"
                onClick={() => removeAdjustmentRow(row.key)}
              >
                Remove
              </button>
            </div>
          ))}
          <button type="button" onClick={addAdjustmentRow}>+ Add adjustment</button>
        </div>

        {scenarioError && <ErrorState label="Scenario failed:" message={scenarioError} />}

        <div className="forecast-scenario-actions">
          <button
            type="button"
            className="button-primary"
            onClick={runScenario}
            disabled={!hasScenarioInputs || scenarioLoading}
          >
            {scenarioLoading ? 'Running...' : 'Run scenario'}
          </button>
          {scenario && (
            <button type="button" onClick={clearScenario}>
              Clear scenario
            </button>
          )}
        </div>

        {scenario && (
          <p>
            Under this scenario, the combined cash position at the end of the projection would be{' '}
            <Amount value={scenario.combined.months.at(-1).closing} /> instead of{' '}
            <Amount value={combined.months.at(-1).closing} neutral /> &mdash; a difference of{' '}
            <Amount value={scenarioDelta} />.
          </p>
        )}
      </Card>

      {/* Deliberately NOT wired for drill-down, unlike every other chart in
          the app: every series here is a PROJECTION of months that mostly
          haven't happened yet (services/forecast.py) - there are no
          transactions behind a forecast point to open the ledger to, and
          offering a click that can only land on an empty or misleading
          result is worse than offering none. */}
      <Card id="forecast-closing-balance" title="Projected Closing Balance">
        <LineChart
          periods={periodLabels}
          series={chartSeries}
          formatValue={formatAmount}
          title="Projected closing balance"
        />
      </Card>

      {accounts.map((account) => (
        <Card
          key={account.account_id}
          id={`forecast-account-${account.account_id}`}
          title={account.account_name || `Account ${account.account_id}`}
        >
          <p>
            Estimated daily run rate (excluding recurring commitments): <Amount value={account.daily_run_rate} />
          </p>
          <table>
            <caption className="visually-hidden">Monthly forecast for {account.account_name || `Account ${account.account_id}`}</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col" className="numeric">Opening</th>
                <th scope="col" className="numeric">Recurring In</th>
                <th scope="col" className="numeric">Recurring Out</th>
                <th scope="col" className="numeric">Estimated Other</th>
                <th scope="col" className="numeric">Closing</th>
              </tr>
            </thead>
            <tbody>
              {account.months.map((month) => (
                <tr key={month.label}>
                  <td>
                    {month.label}
                    {month.is_partial && ' (partial)'}
                  </td>
                  <td><Amount value={month.opening} /></td>
                  <td><Amount value={month.recurring_in} /></td>
                  <td><Amount value={month.recurring_out} neutral /></td>
                  <td><Amount value={month.estimated_other} /></td>
                  <td><Amount value={month.closing} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      <Card id="forecast-upcoming" title="Upcoming Commitments">
        {upcoming.length === 0 && <EmptyState message="No known recurring commitments in this window." />}
        {upcoming.length > 0 && (
          <table>
            <caption className="visually-hidden">Upcoming recurring commitments</caption>
            <thead>
              <tr>
                <SortableHeader label="Due" sortKey="due" activeSortKey={upcomingSort.sortKey} activeDirection={upcomingSort.sortDirection} onSort={upcomingSort.toggleSort} />
                <SortableHeader label="Merchant" sortKey="merchant" activeSortKey={upcomingSort.sortKey} activeDirection={upcomingSort.sortDirection} onSort={upcomingSort.toggleSort} />
                <SortableHeader label="Amount" sortKey="amount" activeSortKey={upcomingSort.sortKey} activeDirection={upcomingSort.sortDirection} onSort={upcomingSort.toggleSort} numeric />
                <SortableHeader label="Direction" sortKey="direction" activeSortKey={upcomingSort.sortKey} activeDirection={upcomingSort.sortDirection} onSort={upcomingSort.toggleSort} />
              </tr>
            </thead>
            <tbody>
              {upcomingSort.sortedRows.map((item, index) => (
                <tr key={`${item.due_date}-${item.account_id}-${item.merchant}-${index}`}>
                  <td>{item.due_date}</td>
                  <td className="cell-wrap">{item.merchant}</td>
                  <td>
                    <Amount
                      value={item.amount}
                      neutral
                      className={item.direction === 'inflow' ? 'amount-positive' : 'amount-negative'}
                    />
                  </td>
                  <td>{item.direction === 'inflow' ? 'In' : 'Out'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </section>
  )
}
