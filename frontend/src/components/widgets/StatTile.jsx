import { formatAmount } from '../../utils/format.js'

// One headline figure over a period - the "stat tile" form (dataviz skill:
// "a single current value" is a stat tile, not a one-bar chart). Four of
// these make up the dashboard's KPI row (Total Income, Total Expenses, Avg
// Per Month, Avg Per Transaction - see widgetRegistry.jsx), each reading
// GET /api/reports/kpis through its own config, but the component itself
// knows nothing about that endpoint - it only renders a value.
//
// `tone` colors the figure by MEANING, not by the number's own arithmetic
// sign (every value here is already a positive magnitude) - 'income' reads
// as success-green, 'expense' as danger-red, matching how every other
// income/expense figure in the app is colored by kind, not by sign.
// 'neutral' (the default) is for a figure that is not itself a direction -
// a plain count, an average that mixes both.
//
// Deliberately does NOT use <Amount> for the big figure: <Amount> forces
// tabular-nums, which is for columns of numbers that must align vertically
// (a table, an axis) - a large standalone figure reads better in the
// font's normal proportional numerals (dataviz skill's stat-tile spec).
//
// `formatValue` defaults to formatAmount (a dollar figure, the common
// case) but a caller whose metric isn't money at all - Savings Rate is a
// percentage, Runway is a count of months - passes its own formatter
// (utils/format.js's formatPercent/formatMonths) rather than this
// component guessing a metric's shape from its name.
export default function StatTile({
  label, value, period, tone = 'neutral', onClick = null, clickLabel = null, formatValue = formatAmount,
}) {
  const toneClass = tone === 'income' ? 'stat-tile-income' : tone === 'expense' ? 'stat-tile-expense' : ''

  const body = (
    <>
      <p className="stat-tile-label">{label}</p>
      {period && <p className="stat-tile-period">{period}</p>}
      <p className={['stat-tile-value', toneClass].filter(Boolean).join(' ')}>
        {value === null || value === undefined ? '—' : formatValue(value)}
      </p>
    </>
  )

  if (!onClick) {
    return <div className="stat-tile">{body}</div>
  }

  return (
    <button type="button" className="stat-tile stat-tile-clickable" onClick={onClick} aria-label={clickLabel}>
      {body}
    </button>
  )
}
