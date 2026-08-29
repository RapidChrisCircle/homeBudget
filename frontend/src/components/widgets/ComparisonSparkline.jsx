import LineChart from '../charts/LineChart.jsx'
import { formatAmount } from '../../utils/format.js'

// Cumulative spend this month against a comparison basis (last month, a
// budget paced evenly, or the average of the last 3 months) - the "emphasis"
// job (dataviz skill: "one series is the point, rest are context"), so the
// comparison line is `muted: true` (LineChart's own dashed, text-muted
// styling) rather than a second categorical hue competing with the real
// series.
//
// Presentational only: `thisMonthValues`/`comparisonValues` are already
// day-indexed cumulative totals (utils/sparklineComparison.js builds them,
// whichever basis a caller chose), so this component doesn't know or care
// which of the three bases produced `comparisonValues` - only `comparisonLabel`,
// for its own legend and delta caption.
export default function ComparisonSparkline({
  periods,
  thisMonthValues,
  comparisonValues,
  comparisonLabel,
  onSelectPoint = null,
}) {
  // The delta as of the LAST day both curves actually have a value for -
  // comparing today's cumulative spend against a comparison curve that
  // still has 20 more (null, not-yet-happened) days left would understate
  // the gap by counting days that haven't had a chance to add anything yet.
  let lastKnownIndex = -1
  for (let i = 0; i < thisMonthValues.length; i++) {
    if (thisMonthValues[i] !== null && comparisonValues[i] !== null && comparisonValues[i] !== undefined) {
      lastKnownIndex = i
    }
  }

  const delta = lastKnownIndex >= 0 ? thisMonthValues[lastKnownIndex] - comparisonValues[lastKnownIndex] : null
  // Spending MORE than the comparison is the bad direction here (the
  // opposite of a plain amount's own sign convention) - a positive delta
  // reads as over/danger, not as a plain positive number would elsewhere.
  const deltaTone = delta === null ? '' : delta > 0 ? 'stat-tile-expense' : 'stat-tile-income'

  return (
    <div className="comparison-sparkline">
      {delta !== null && (
        <p className="comparison-sparkline-delta">
          <span className={deltaTone}>
            {delta > 0 ? '+' : ''}{formatAmount(delta)}
          </span>{' '}
          <span className="text-muted">vs {comparisonLabel}</span>
        </p>
      )}
      <LineChart
        periods={periods}
        series={[
          { label: 'This month', values: thisMonthValues },
          { label: comparisonLabel, values: comparisonValues, muted: true, selectable: false },
        ]}
        formatValue={formatAmount}
        title={`This month vs ${comparisonLabel}`}
        onSelectPoint={onSelectPoint}
      />
    </div>
  )
}
