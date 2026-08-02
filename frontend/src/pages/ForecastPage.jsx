import { useEffect, useState } from 'react'
import Amount from '../components/Amount.jsx'
import Card from '../components/Card.jsx'
import LineChart from '../components/charts/LineChart.jsx'
import EmptyState from '../components/EmptyState.jsx'
import ErrorState from '../components/ErrorState.jsx'
import LoadingState from '../components/LoadingState.jsx'
import { api } from '../services/api'
import { formatAmount } from '../utils/format.js'

const DEFAULT_MONTHS = 3

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

  if (loading) {
    return (
      <section className="card">
        <h2>Forecast</h2>
        <LoadingState message="Loading forecast..." />
      </section>
    )
  }

  if (error) {
    return (
      <section className="card">
        <h2>Forecast</h2>
        <ErrorState label="Failed to load forecast:" message={error} />
      </section>
    )
  }

  if (!forecast.as_of || forecast.accounts.length === 0) {
    return (
      <section className="card">
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
    { label: 'Combined', values: combined.months.map((m) => Number(m.closing)) },
  ]

  return (
    <section className="card">
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
                <th scope="col">Opening</th>
                <th scope="col">Recurring In</th>
                <th scope="col">Recurring Out</th>
                <th scope="col">Estimated Other</th>
                <th scope="col">Closing</th>
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
                <th scope="col">Due</th>
                <th scope="col">Merchant</th>
                <th scope="col">Amount</th>
                <th scope="col">Direction</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((item, index) => (
                <tr key={`${item.due_date}-${item.account_id}-${item.merchant}-${index}`}>
                  <td>{item.due_date}</td>
                  <td>{item.merchant}</td>
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
