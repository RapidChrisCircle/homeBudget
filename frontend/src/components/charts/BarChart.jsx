import ChartTooltip, { useChartTooltip } from './ChartTooltip.jsx'
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
// DRILL-DOWN, when onSelectBar is passed, is per BAR - mirroring
// LineChart's own per-point onSelectPoint - not per period/column: a
// grouped bar chart's columns compare several series for one month (income
// vs spending vs net, budgeted vs actual), and those series usually mean
// different things ("Income" and "Spending" are opposite questions with
// opposite answers), so the bar clicked is part of what was asked, not
// just which month. A series can opt out with `selectable: false` (a
// derived figure with nothing behind it to drill into - "Net saved" is a
// difference, not a transaction kind; "Budgeted" is a projection, no
// transactions are ever "budgeted") - the same escape hatch LineChart's
// own series carry. Omit the prop and the chart renders exactly as it
// always did, with nothing focusable and no pointer cursor.
export default function BarChart({
  periods,
  series,
  formatValue = (v) => v,
  title,
  onSelectBar = null,
}) {

  const { containerRef, tooltip, showTooltip, hideTooltip } = useChartTooltip()

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
    <div className="chart-container" ref={containerRef}>
      <ChartTooltip tooltip={tooltip} />
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
                const description = `${s.label} — ${period}: ${formatValue(value)}`
                const barClickable = Boolean(onSelectBar) && s.selectable !== false

                if (!barClickable) {
                  return (
                    <rect
                      key={s.label}
                      x={barX}
                      y={barY}
                      width={Math.max(barWidth - 2, 1)}
                      height={barHeight}
                      fill={seriesColor(seriesIndex)}
                      onMouseEnter={(event) => showTooltip(event, description)}
                      onMouseLeave={hideTooltip}
                    >
                      <title>{description}</title>
                    </rect>
                  )
                }

                return (
                  // A real, keyboard-reachable button - see LineChart's own
                  // point circles for the identical reasoning, including
                  // onFocus/onBlur mirroring onMouseEnter/onMouseLeave so
                  // the shared tooltip also appears for keyboard navigation.
                  <rect
                    key={s.label}
                    x={barX}
                    y={barY}
                    width={Math.max(barWidth - 2, 1)}
                    height={barHeight}
                    fill={seriesColor(seriesIndex)}
                    role="button"
                    tabIndex={0}
                    aria-label={description}
                    style={{ cursor: 'pointer' }}
                    onClick={() => onSelectBar({ series: s, seriesIndex, periodIndex, period, value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onSelectBar({ series: s, seriesIndex, periodIndex, period, value })
                      }
                    }}
                    onMouseEnter={(event) => showTooltip(event, description)}
                    onMouseLeave={hideTooltip}
                    onFocus={(event) => showTooltip(event, description)}
                    onBlur={hideTooltip}
                  >
                    <title>{description}</title>
                  </rect>
                )
              })}
            </g>
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
