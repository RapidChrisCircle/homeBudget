import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import BarChart from '../components/charts/BarChart.jsx'
import LineChart from '../components/charts/LineChart.jsx'
import { api } from '../services/api'
import { formatAmount } from '../utils/format.js'

const MONTH_OPTIONS = [6, 12, 24]
const DEFAULT_MONTHS = 6
// The category-over-time chart shows this many individual lines; the rest
// are summed into a single "Other" line rather than cluttering the chart -
// the Reports grid remains the complete, un-summarized view.
const TOP_CATEGORY_LIMIT = 6

// The top N expense categories by total magnitude, one line series each,
// with everything else summed into a single "Other" series.
function buildCategorySeries(periods, categories) {
  const expenseCategories = categories.filter((c) => c.kind === 'expense')
  const sorted = [...expenseCategories].sort(
    (a, b) => Math.abs(Number(b.total)) - Math.abs(Number(a.total))
  )
  const top = sorted.slice(0, TOP_CATEGORY_LIMIT)
  const rest = sorted.slice(TOP_CATEGORY_LIMIT)

  const series = top.map((category) => ({
    label: category.category_name,
    values: periods.map((p) => Number(category.amounts[p.label])),
  }))

  if (rest.length > 0) {
    series.push({
      label: 'Other',
      values: periods.map((p) =>
        rest.reduce((sum, category) => sum + Number(category.amounts[p.label]), 0)
      ),
    })
  }

  return series
}

export default function TrendsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const months = Number(searchParams.get('months')) || DEFAULT_MONTHS

  const [trends, setTrends] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    setLoading(true)
    setError('')

    api.get(`/trends?months=${months}`)
      .then((response) => {
        if (!cancelled) {
          setTrends(response.data)
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
  }, [months])

  const handleMonthsChange = (event) => {
    const next = new URLSearchParams(searchParams)
    next.set('months', event.target.value)
    setSearchParams(next)
  }

  if (loading) {
    return (
      <section className="card">
        <h2>Trends</h2>
        <p>Loading trends...</p>
      </section>
    )
  }

  if (error) {
    return (
      <section className="card">
        <h2>Trends</h2>
        <p>
          <strong>Failed to load trends:</strong> {error}
        </p>
      </section>
    )
  }

  const { periods, categories, monthly, budget } = trends
  const periodLabels = periods.map((p) => p.label)

  // Deliberately NOT `categories.length > 0`: category_grid() outer-joins so
  // a budgeted-but-idle category appears even on a completely empty ledger
  // (see reporting.category_grid's docstring) - keying off it here would
  // show three flat-zero charts captioned as trends on a fresh install with
  // nothing imported yet. Real monthly activity is the only honest signal.
  const hasHistory = monthly.some((m) => Number(m.total_income) !== 0 || Number(m.total_spending) !== 0)

  const monthLabel = (
    <label>
      Months
      <select value={months} onChange={handleMonthsChange}>
        {MONTH_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )

  if (!hasHistory) {
    return (
      <section className="card">
        <h2>Trends</h2>
        {monthLabel}
        <p>Not enough history yet - import a few months of statements and check back.</p>
      </section>
    )
  }

  const categorySeries = buildCategorySeries(periods, categories)
  const incomeSpendingSeries = [
    { label: 'Income', values: monthly.map((m) => Number(m.total_income)) },
    { label: 'Spending', values: monthly.map((m) => Number(m.total_spending)) },
    { label: 'Net saved', values: monthly.map((m) => Number(m.net_saved)) },
  ]
  const budgetSeries = [
    { label: 'Budgeted', values: budget.map((b) => Number(b.budgeted)) },
    { label: 'Actual', values: budget.map((b) => Number(b.actual)) },
  ]
  const hasBudget = budget.some((b) => Number(b.budgeted) !== 0)

  return (
    <section className="card">
      <h2>Trends</h2>
      {monthLabel}

      <div className="card">
        <h3>Spending by Category Over Time</h3>
        {categorySeries.length === 0 ? (
          <p>No categorized spending in this window yet.</p>
        ) : (
          <LineChart
            periods={periodLabels}
            series={categorySeries}
            formatValue={formatAmount}
            title="Spending by category over time"
          />
        )}
      </div>

      <div className="card">
        <h3>Income vs Spending vs Net</h3>
        <BarChart
          periods={periodLabels}
          series={incomeSpendingSeries}
          formatValue={formatAmount}
          title="Income vs spending vs net"
        />
      </div>

      <div className="card">
        <h3>Budget vs Actual</h3>
        {hasBudget ? (
          <BarChart
            periods={periodLabels}
            series={budgetSeries}
            formatValue={formatAmount}
            title="Budget vs actual"
          />
        ) : (
          <p>No categories have a budget set yet.</p>
        )}
      </div>
    </section>
  )
}
