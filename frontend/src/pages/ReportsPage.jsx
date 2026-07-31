import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../services/api'
import { formatAmount, uncategorizedLedgerLink } from '../utils/format.js'

export default function ReportsPage() {
  const [report, setReport] = useState(null)
  const [periods, setPeriods] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    let cancelled = false

    setLoading(true)
    setError('')

    Promise.all([api.get('/reports/monthly'), api.get('/reports/periods')])
      .then(([reportRes, periodsRes]) => {
        if (!cancelled) {
          setReport(reportRes.data)
          setPeriods(periodsRes.data)
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

  const handlePeriodChange = async (event) => {
    const [year, month] = event.target.value.split('-')

    setActionError('')
    try {
      const response = await api.get(`/reports/monthly?year=${year}&month=${month}`)
      setReport(response.data)
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Failed to load report'
      setActionError(String(message))
    }
  }

  if (loading) {
    return (
      <section className="card">
        <h2>Reports</h2>
        <p>Loading report...</p>
      </section>
    )
  }

  if (error) {
    return (
      <section className="card">
        <h2>Reports</h2>
        <p>
          <strong>Failed to load report:</strong> {error}
        </p>
      </section>
    )
  }

  if (periods.length === 0) {
    return (
      <section className="card">
        <h2>Reports</h2>
        <p>No transactions imported yet.</p>
      </section>
    )
  }

  const { summary, budgets, grid, uncategorized } = report

  return (
    <section className="card">
      <h2>Reports</h2>

      {actionError && (
        <p>
          <strong>Action failed:</strong> {actionError}
        </p>
      )}

      <p>
        Budgets apply to every month. Transfer categories are excluded from these totals &mdash; if
        a transfer's narration appears on both sides (e.g. a "CCTrueUp" style entry), make sure your
        transfer rule matches the narration rather than the transaction type, or only one leg will
        be excluded.
      </p>

      <div className="card">
        <h3>Month</h3>
        <label>
          Select month
          <select value={`${report.year}-${report.month}`} onChange={handlePeriodChange}>
            {periods.map((period) => (
              <option key={period.label} value={`${period.year}-${period.month}`}>
                {period.label} ({period.transaction_count})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="card">
        <h3>Monthly Summary &mdash; {report.label}</h3>
        <table>
          <tbody>
            <tr>
              <td>Total income</td>
              <td>{formatAmount(summary.total_income)}</td>
            </tr>
            <tr>
              <td>Total spending</td>
              <td>{formatAmount(summary.total_spending)}</td>
            </tr>
            <tr>
              <td>Net saved</td>
              <td>{formatAmount(summary.net_saved)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Uncategorized Review</h3>
        <p>
          {uncategorized.uncategorized_count} of {uncategorized.transaction_count} transaction(s) this
          month are uncategorized (net {formatAmount(uncategorized.net_total)}). The summary above only
          covers categorized, non-transfer transactions.
        </p>
        <Link to={uncategorizedLedgerLink(report.start_date, report.end_date)}>
          Review uncategorized transactions
        </Link>
      </div>

      <div className="card">
        <h3>Budget vs Actual</h3>
        {budgets.length === 0 && <p>No activity in this month.</p>}
        {budgets.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Budget</th>
                <th>Actual</th>
                <th>Difference</th>
              </tr>
            </thead>
            <tbody>
              {budgets.map((line) => (
                <tr key={line.category_id}>
                  <td>{line.category_name}</td>
                  <td>{formatAmount(line.budget_amount)}</td>
                  <td>
                    {formatAmount(line.actual)}
                    {Number(line.actual) < 0 && (
                      <span title="Net refund — refunds exceeded spending this month"> (refund)</span>
                    )}
                  </td>
                  <td>
                    {formatAmount(line.difference)}
                    {line.difference !== null && Number(line.difference) < 0 && (
                      <span title="Over budget"> (over)</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Category Totals Over Time</h3>
        {grid.rows.length === 0 && <p>No activity in this period.</p>}
        {grid.rows.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Category</th>
                {grid.periods.map((period) => (
                  <th key={period.label}>{period.label}</th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row) => (
                <tr key={row.category_id}>
                  <td>{row.category_name}</td>
                  {grid.periods.map((period) => (
                    <td key={period.label}>{formatAmount(row.amounts[period.label])}</td>
                  ))}
                  <td>{formatAmount(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
