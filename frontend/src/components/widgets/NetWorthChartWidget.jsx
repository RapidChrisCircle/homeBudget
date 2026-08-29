import LineChart from '../charts/LineChart.jsx'
import EmptyState from '../EmptyState.jsx'
import { formatAmount } from '../../utils/format.js'
import { monthBounds } from '../../utils/trendsSeries.js'

// The Dashboard's Net Worth chart, unchanged - re-hosted as a widget.
// `balanceHistory` is GET /trends' own `balances` series, already fetched
// by DashboardPage. A point drills into that month's activity across
// every account - net worth is a balance SNAPSHOT, not a sum of that
// month's transactions, so there is no kind or category to scope to here.
export default function NetWorthChartWidget({ balanceHistory, navigate }) {
  // A household can have real balance history through a month with no
  // categorized activity at all, and the reverse - gated on its OWN data,
  // independent of CashFlowWidget's check. At least one period with a
  // known net worth (see services/net_worth.net_worth_history - null
  // means no classified account has history that far back yet, a real
  // gap, not $0).
  const hasHistory = balanceHistory.some((b) => b.balance !== null)

  if (!hasHistory) {
    return <EmptyState message="No account balance history in this window yet." />
  }

  const openMonth = ({ period }) => {
    const { from, to } = monthBounds(period)
    navigate(`/transactions?date_from=${from}&date_to=${to}`)
  }

  return (
    <>
      <p>Click a point to see that month&apos;s transactions.</p>
      <LineChart
        periods={balanceHistory.map((b) => b.label)}
        series={[{
          label: 'Net worth',
          values: balanceHistory.map((b) => (b.balance === null ? null : Number(b.balance))),
        }]}
        formatValue={formatAmount}
        title="Net worth over time"
        onSelectPoint={openMonth}
      />
    </>
  )
}
