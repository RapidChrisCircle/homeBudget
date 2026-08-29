import BarChart from '../charts/BarChart.jsx'
import EmptyState from '../EmptyState.jsx'
import { formatAmount } from '../../utils/format.js'
import { monthBounds } from '../../utils/trendsSeries.js'

// The Dashboard's Cash Flow chart, unchanged - re-hosted as a widget.
// `trends`/`monthlyTrend` are the same GET /trends response the page has
// always fetched. Drill-down navigates to the ledger, filtered to that
// bar's kind and month - mirrors /trends' own income-vs-spending chart
// exactly, since this IS that chart at a shorter window.
export default function CashFlowWidget({ trends, monthlyTrend, navigate }) {
  // Deliberately NOT "does BarChart have any data points" - a fully
  // categorized-but-zero window would still pass that check and draw a
  // flat, misleadingly-real-looking chart at zero. Real activity in at
  // least one charted month is the only honest signal, the same check
  // TrendsPage/DashboardPage's own pre-widget version already used.
  const hasActivity = monthlyTrend.some((m) => Number(m.total_income) !== 0 || Number(m.total_spending) !== 0)

  if (!hasActivity) {
    return <EmptyState message="No categorized income or spending in this window yet." />
  }

  const openKindMonth = ({ series, period }) => {
    const { from, to } = monthBounds(period)
    navigate(`/transactions?kind=${series.drill.kind}&date_from=${from}&date_to=${to}`)
  }

  return (
    <>
      <p>Click a bar to see the transactions behind it.</p>
      <BarChart
        periods={trends.periods.map((p) => p.label)}
        series={[
          { label: 'Income', values: monthlyTrend.map((m) => Number(m.total_income)), drill: { kind: 'income' } },
          // Negated: total_spending is a positive "amount spent" figure
          // (see reporting.py's presentation-signing docstring) - drawn
          // as a NEGATIVE value here so it falls below the zero line,
          // opposite Income, and the month's net reads as the visible
          // imbalance between the two bars. The drill target still uses
          // the real (positive) kind, not this display sign.
          { label: 'Spending', values: monthlyTrend.map((m) => -Number(m.total_spending)), drill: { kind: 'expense' } },
        ]}
        formatValue={formatAmount}
        title="Cash flow: income and spending"
        onSelectBar={openKindMonth}
      />
    </>
  )
}
