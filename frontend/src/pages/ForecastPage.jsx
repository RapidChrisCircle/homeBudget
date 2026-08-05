import { useEffect, useState } from 'react'
import Amount from '../components/Amount.jsx'
import Card from '../components/Card.jsx'
import LineChart from '../components/charts/LineChart.jsx'
import EmptyState from '../components/EmptyState.jsx'
import ErrorState from '../components/ErrorState.jsx'
import LoadingState from '../components/LoadingState.jsx'
import SortableHeader from '../components/SortableHeader.jsx'
import { api } from '../services/api'
import { formatAmount } from '../utils/format.js'
import { useTableSort } from '../utils/tableSort.js'

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

  // Called unconditionally, before the loading/error/empty early returns
  // below - React requires hooks to run in the same order every render.
  const upcomingSort = useTableSort(forecast?.upcoming ?? [], UPCOMING_SORT_COLUMNS)

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

  return (
    <section className="page">
      <h2>Forecast</h2>

      <p>
        Projected from transactions imported up to {asOf}: known recurring commitments plus an
        estimated everyday-spending run rate, at monthly resolution. This is a projection, not a
        guarantee - a month that closes comfortably can still dip lower partway through it.
      </p>

      <Card id="forecast-closing-balance" title="Projected Closing Balance">
        <LineChart
          periods={periodLabels}
          series={balanceSeries}
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
