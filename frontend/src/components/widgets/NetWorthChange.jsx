import StatTile from './StatTile.jsx'

// The change in net worth over a window, as a single figure - reuses the
// `balances` series GET /api/trends already returns (services/net_worth.
// net_worth_history), so this is zero new backend surface, just a
// different read of data the Dashboard's own Net Worth chart already
// fetches.
//
// A null entry in `balances` is a genuine gap (no classified account has
// history that far back yet - see services/net_worth_history's own
// docstring), so the change is computed between the first and last KNOWN
// balances in the window, not literally the first/last array entries.
export default function NetWorthChange({ balances, windowLabel, onClick }) {
  const known = balances.filter((b) => b.balance !== null && b.balance !== undefined)

  if (known.length < 2) {
    return <StatTile label="Net Worth Change" value={null} period={windowLabel} />
  }

  const change = Number(known[known.length - 1].balance) - Number(known[0].balance)

  return (
    <StatTile
      label="Net Worth Change"
      value={change}
      period={windowLabel}
      // Up is good here, unlike Income/Expense's kind-based meaning - the
      // same 'income'/'expense' tone vocabulary just reused for "which
      // direction is good", since both ultimately mean success-green vs
      // danger-red.
      tone={change >= 0 ? 'income' : 'expense'}
      onClick={onClick}
      clickLabel={onClick ? `View transactions for ${windowLabel}` : null}
    />
  )
}
