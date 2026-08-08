import { CHART_HEIGHT, CHART_MARGIN, CHART_WIDTH, seriesColor } from './chartConstants.js'
import { computeDomain, linearScale, niceTicks } from './chartScale.js'

const PLOT_WIDTH = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right
const PLOT_HEIGHT = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom
const GROUP_PADDING_FRACTION = 0.15

// Grouped, multi-series bar chart over a shared categorical x-axis. Used for
// income-vs-spending-vs-net and budget-vs-actual.
//
// Always includes zero in its domain (bars drawn from a baseline elsewhere
// than zero would misrepresent magnitude), and each bar is drawn from zero
// to its value in either direction, so a negative month (a net refund, a
// loss) draws sensibly below the zero line rather than needing special
// casing by the caller.
//
// DRILL-DOWN, when onSelectPeriod is passed, is per PERIOD rather than per
// bar: what a grouped bar chart's columns mean here is one month compared
// several ways (income vs spending vs net, budgeted vs actual), so "March"
// is the thing there is more detail about, not "March's income bar"
// specifically. It is one full-height transparent hit area per column, so
// the target is the whole month rather than a 20px-wide bar. That hit area
// necessarily sits ON TOP of its column's bars and so takes over their
// hover tooltips - which is why periodSelectLabel is a function of the
// period rather than fixed text: a caller that turns drill-down on is
// expected to fold the month's own figures into it, so nothing that was
// discoverable by hovering stops being discoverable. Omit the prop and the
// chart renders exactly as it always did.
export default function BarChart({
  periods,
  series,
  formatValue = (v) => v,
  title,
  onSelectPeriod = null,
  // (period, periodIndex) - the index is what lets a caller fold that
  // column's own figures into the label without re-deriving which column
  // it is looking at.
  periodSelectLabel = (period) => `View ${period}`,
}) {

  const allValues = series.flatMap((s) => s.values)
  const domain = computeDomain(allValues, { includeZero: true })

  if (!domain || periods.length === 0) {
    return <p>Not enough data yet.</p>
  }

  const yScale = linearScale({ domain, range: [PLOT_HEIGHT, 0] })
  const zeroY = yScale(0)
  const ticks = niceTicks(domain.min, domain.max, 5)

  const groupWidth = PLOT_WIDTH / periods.length
  const groupPadding = groupWidth * GROUP_PADDING_FRACTION
  const barsAreaWidth = groupWidth - groupPadding * 2
  const barWidth = barsAreaWidth / series.length

  return (
    <div>
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-label={title}>
        <g transform={`translate(${CHART_MARGIN.left}, ${CHART_MARGIN.top})`}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={0} x2={PLOT_WIDTH} y1={yScale(tick)} y2={yScale(tick)} stroke="var(--border)" />
              <text x={-8} y={yScale(tick)} textAnchor="end" dominantBaseline="middle" fontSize="10" fill="var(--text-muted)">
                {formatValue(tick)}
              </text>
            </g>
          ))}

          <line x1={0} x2={PLOT_WIDTH} y1={zeroY} y2={zeroY} stroke="var(--border-strong)" strokeWidth="1.5" />

          {periods.map((period, periodIndex) => (
            <g key={period}>
              {series.map((s, seriesIndex) => {
                const value = s.values[periodIndex]
                if (value === null || value === undefined) {
                  return null
                }
                const valueY = yScale(value)
                const barX = periodIndex * groupWidth + groupPadding + seriesIndex * barWidth
                const barY = Math.min(valueY, zeroY)
                const barHeight = Math.abs(valueY - zeroY)
                return (
                  <rect
                    key={s.label}
                    x={barX}
                    y={barY}
                    width={Math.max(barWidth - 2, 1)}
                    height={barHeight}
                    fill={seriesColor(seriesIndex)}
                  >
                    <title>{`${s.label} — ${period}: ${formatValue(value)}`}</title>
                  </rect>
                )
              })}
            </g>
          ))}

          {onSelectPeriod && periods.map((period, periodIndex) => (
            <rect
              key={`hit-${period}`}
              x={periodIndex * groupWidth}
              y={0}
              width={groupWidth}
              height={PLOT_HEIGHT}
              fill="transparent"
              role="button"
              tabIndex={0}
              aria-label={periodSelectLabel(period, periodIndex)}
              style={{ cursor: 'pointer' }}
              onClick={() => onSelectPeriod({ period, periodIndex })}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelectPeriod({ period, periodIndex })
                }
              }}
            >
              <title>{periodSelectLabel(period, periodIndex)}</title>
            </rect>
          ))}

          {periods.map((period, index) => (
            <text
              key={period}
              x={index * groupWidth + groupWidth / 2}
              y={PLOT_HEIGHT + 20}
              textAnchor="middle"
              fontSize="10"
              fill="var(--text-muted)"
            >
              {period}
            </text>
          ))}
        </g>
      </svg>

      {series.length > 1 && (
        <ul>
          {series.map((s, index) => (
            <li key={s.label}>
              <span style={{ color: seriesColor(index) }}>■</span> {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
