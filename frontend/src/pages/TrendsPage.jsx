import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import BarChart from '../components/charts/BarChart.jsx'
import LineChart from '../components/charts/LineChart.jsx'
import Card from '../components/Card.jsx'
import EmptyState from '../components/EmptyState.jsx'
import ErrorState from '../components/ErrorState.jsx'
import LoadingState from '../components/LoadingState.jsx'
import { api } from '../services/api'
import { formatAmount } from '../utils/format.js'
import { buildLevel, buildSeries, drilledGroupName, monthBounds } from '../utils/trendsSeries.js'

const MONTH_OPTIONS = [6, 12, 24]
const DEFAULT_MONTHS = 6

export default function TrendsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const months = Number(searchParams.get('months')) || DEFAULT_MONTHS
  // Which group the category chart is drilled into, in the URL beside
  // `months` for the same reason every other view state in this app is: a
  // drilled-in chart is reloadable and shareable, not a state that
  // evaporates on refresh.
  const groupId = searchParams.get('group') || ''

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
    // The window changing can retire the drilled-into group entirely (a
    // group with no activity in the new window isn't in the data at all),
    // so drilling resets rather than leaving an empty chart.
    next.delete('group')
    setSearchParams(next)
  }

  const drillIntoGroup = (id) => {
    const next = new URLSearchParams(searchParams)
    next.set('group', String(id))
    setSearchParams(next)
  }

  const clearDrill = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('group')
    setSearchParams(next)
  }

  if (loading) {
    return (
      <section className="page">
        <h2>Trends</h2>
        <LoadingState message="Loading trends..." />
      </section>
    )
  }

  if (error) {
    return (
      <section className="page">
        <h2>Trends</h2>
        <ErrorState label="Failed to load trends:" message={error} />
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
      <section className="page">
        <h2>Trends</h2>
        {monthLabel}
        <EmptyState message="Not enough history yet - import a few months of statements and check back." />
      </section>
    )
  }

  // A group the current window has no data for (or one deleted since the
  // URL was shared) drills into nothing - fall back to the top level
  // rather than rendering an empty chart with a breadcrumb.
  const groupName = drilledGroupName(categories, groupId)
  const activeGroupId = groupName ? groupId : ''

  const categorySeries = buildSeries(periods, buildLevel(periods, categories, activeGroupId))
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

  // A month drills into that month's own report - the full per-category
  // budget-vs-actual table these two charts are the summary of.
  const openMonth = ({ period }) => {
    const [year, month] = period.split('-')
    navigate(`/reports?year=${year}&month=${Number(month)}`)
  }

  // A category drills into the transactions behind that one point: the
  // ledger, filtered to that category and that month. Nothing about the
  // chart can show WHICH transactions made a month expensive, which is
  // invariably the next question.
  const openCategoryMonth = ({ series, period }) => {
    if (series.drill?.kind === 'group') {
      drillIntoGroup(series.drill.id)
      return
    }

    const { from, to } = monthBounds(period)
    navigate(`/transactions?category_id=${series.drill.id}&date_from=${from}&date_to=${to}`)
  }

  const selectCategorySeries = ({ series }) => {
    if (series.drill?.kind === 'group') {
      drillIntoGroup(series.drill.id)
    }
  }

  // Folded into the drill-down hit area's own tooltip and accessible name -
  // see BarChart's note on why the caller owns this text.
  const summaryLabel = (values) => (period, periodIndex) => (
    `${period} — ${values.map((v) => `${v.label} ${formatAmount(v.series[periodIndex])}`).join(', ')}`
    + ' (open this month\'s report)'
  )

  return (
    <section className="page">
      <h2>Trends</h2>
      {monthLabel}

      <Card
        id="trends-category-over-time"
        title={
          groupName
            ? `Spending in ${groupName} Over Time`
            : 'Spending by Category Over Time'
        }
      >
        {groupName ? (
          <p>
            Showing the sub-categories of <strong>{groupName}</strong>. Click a point to see
            that month&apos;s transactions.{' '}
            <button type="button" onClick={clearDrill}>Back to all categories</button>
          </p>
        ) : (
          <p>
            Sub-categories are rolled up into their group. Click a group (a point, or its name in
            the legend) to see what it is made of; click a point on an ungrouped category to see
            that month&apos;s transactions.
          </p>
        )}

        {categorySeries.length === 0 ? (
          <EmptyState message="No categorized spending in this window yet." />
        ) : (
          <LineChart
            periods={periodLabels}
            series={categorySeries}
            formatValue={formatAmount}
            title="Spending by category over time"
            onSelectPoint={openCategoryMonth}
            onSelectSeries={selectCategorySeries}
          />
        )}
      </Card>

      <Card id="trends-income-vs-spending" title="Income vs Spending vs Net">
        <p>Click a month to open its full report.</p>
        <BarChart
          periods={periodLabels}
          series={incomeSpendingSeries}
          formatValue={formatAmount}
          title="Income vs spending vs net"
          onSelectPeriod={openMonth}
          periodSelectLabel={summaryLabel(
            incomeSpendingSeries.map((s) => ({ label: s.label, series: s.values }))
          )}
        />
      </Card>

      <Card id="trends-budget-vs-actual" title="Budget vs Actual">
        {hasBudget ? (
          <>
            <p>Click a month to open its full budget-vs-actual table.</p>
            <BarChart
              periods={periodLabels}
              series={budgetSeries}
              formatValue={formatAmount}
              title="Budget vs actual"
              onSelectPeriod={openMonth}
              periodSelectLabel={summaryLabel(
                budgetSeries.map((s) => ({ label: s.label, series: s.values }))
              )}
            />
          </>
        ) : (
          <EmptyState message="No categories have a budget set yet." />
        )}
      </Card>
    </section>
  )
}
