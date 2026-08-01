import { useEffect, useState } from 'react'
import LineChart from '../components/charts/LineChart.jsx'
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
        <p>Loading forecast...</p>
      </section>
    )
  }

  if (error) {
    return (
      <section className="card">
        <h2>Forecast</h2>
        <p>
          <strong>Failed to load forecast:</strong> {error}
        </p>
      </section>
    )
  }

  if (!forecast.as_of || forecast.accounts.length === 0) {
    return (
      <section className="card">
        <h2>Forecast</h2>
        <p>Not enough history yet - import a few months of statements and check back.</p>
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

      <div className="card">
        <h3>Projected Closing Balance</h3>
        <LineChart
          periods={periodLabels}
          series={balanceSeries}
          formatValue={formatAmount}
          title="Projected closing balance"
        />
      </div>

      {accounts.map((account) => (
        <div className="card" key={account.account_id}>
          <h3>{account.account_name || `Account ${account.account_id}`}</h3>
          <p>Estimated daily run rate (excluding recurring commitments): {formatAmount(account.daily_run_rate)}</p>
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>Opening</th>
                <th>Recurring In</th>
                <th>Recurring Out</th>
                <th>Estimated Other</th>
                <th>Closing</th>
              </tr>
            </thead>
            <tbody>
              {account.months.map((month) => (
                <tr key={month.label}>
                  <td>
                    {month.label}
                    {month.is_partial && ' (partial)'}
                  </td>
                  <td>{formatAmount(month.opening)}</td>
                  <td>{formatAmount(month.recurring_in)}</td>
                  <td>{formatAmount(month.recurring_out)}</td>
                  <td>{formatAmount(month.estimated_other)}</td>
                  <td>{formatAmount(month.closing)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div className="card">
        <h3>Upcoming Commitments</h3>
        {upcoming.length === 0 && <p>No known recurring commitments in this window.</p>}
        {upcoming.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Due</th>
                <th>Merchant</th>
                <th>Amount</th>
                <th>Direction</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((item, index) => (
                <tr key={`${item.due_date}-${item.account_id}-${item.merchant}-${index}`}>
                  <td>{item.due_date}</td>
                  <td>{item.merchant}</td>
                  <td>{formatAmount(item.amount)}</td>
                  <td>{item.direction === 'inflow' ? 'In' : 'Out'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
