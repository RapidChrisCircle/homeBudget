import { CHART_HEIGHT, CHART_MARGIN, CHART_WIDTH, seriesColor } from './chartConstants.js'
import { computeDomain, linearScale, niceTicks } from './chartScale.js'

const PLOT_WIDTH = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right
const PLOT_HEIGHT = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom

// Multi-series line chart over a shared categorical x-axis (a list of period
// labels, e.g. "2026-01"). Used for spending-by-category-over-time and
// account balance history.
//
// A null/undefined value in a series' `values` array is a genuine gap - "no
// data for this period" - and breaks the line rather than being drawn as
// zero. Balance history relies on this: months before an account's first
// transaction are null, and a flat balance through a quiet month is filled
// forward by the backend before it ever reaches this component.
//
// DRILL-DOWN is opt-in and entirely the caller's meaning: passing
// onSelectPoint makes each plotted point clickable, and onSelectSeries
// makes each legend entry a button. Omit both (every chart that had no
// drill-down before) and the markup is exactly what it always was - no
// stray buttons, no pointer cursor, nothing focusable.
//
// A series can opt OUT with `selectable: false` on its own object. That
// exists for a genuinely non-drillable series - /trends' summed "Other"
// line stands for several categories at once and has nothing to drill
// into - and matters because an affordance that looks clickable and does
// nothing is worse than no affordance.
export default function LineChart({
  periods,
  series,
  includeZero = false,
  formatValue = (v) => v,
  title,
  onSelectPoint = null,
  onSelectSeries = null,
}) {

  const allValues = series.flatMap((s) => s.values)
  const domain = computeDomain(allValues, { includeZero })

  if (!domain || periods.length === 0) {
    return <p>Not enough data yet.</p>
  }

  const xScale = linearScale({ domain: { min: 0, max: Math.max(periods.length - 1, 1) }, range: [0, PLOT_WIDTH] })
  const yScale = linearScale({ domain, range: [PLOT_HEIGHT, 0] })
  const ticks = niceTicks(domain.min, domain.max, 5)
  const showZeroLine = domain.min < 0 && domain.max > 0

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

          {showZeroLine && (
            <line x1={0} x2={PLOT_WIDTH} y1={yScale(0)} y2={yScale(0)} stroke="var(--border-strong)" strokeWidth="1.5" />
          )}

          {series.map((s, seriesIndex) => {
            const color = seriesColor(seriesIndex)
            const pointsClickable = Boolean(onSelectPoint) && s.selectable !== false
            let path = ''
            let drawing = false

            s.values.forEach((value, index) => {
              if (value === null || value === undefined) {
                drawing = false
                return
              }
              const x = xScale(index)
              const y = yScale(value)
              path += drawing ? ` L ${x} ${y}` : `M ${x} ${y}`
              drawing = true
            })

            return (
              <g key={s.label}>
                <path d={path} fill="none" stroke={color} strokeWidth="2" />
                {s.values.map((value, index) => {
                  if (value === null || value === undefined) {
                    return null
                  }

                  const description = `${s.label} — ${periods[index]}: ${formatValue(value)}`

                  if (!pointsClickable) {
                    return (
                      <circle key={index} cx={xScale(index)} cy={yScale(value)} r="3" fill={color}>
                        <title>{description}</title>
                      </circle>
                    )
                  }

                  return (
                    // A clickable point is a real, keyboard-reachable
                    // button (Enter/Space, not click alone) rather than an
                    // onClick on a decorative shape - an SVG element takes
                    // role/tabIndex the same way any other element does,
                    // and there is no HTML button that can live inside the
                    // plot area at the point's own coordinates.
                    <circle
                      key={index}
                      cx={xScale(index)}
                      cy={yScale(value)}
                      // Larger than the static point: 3px is a fine dot to
                      // look at and a poor target to hit.
                      r="6"
                      fill={color}
                      role="button"
                      tabIndex={0}
                      aria-label={description}
                      style={{ cursor: 'pointer' }}
                      onClick={() => onSelectPoint({ series: s, seriesIndex, periodIndex: index, period: periods[index], value })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onSelectPoint({ series: s, seriesIndex, periodIndex: index, period: periods[index], value })
                        }
                      }}
                    >
                      <title>{description}</title>
                    </circle>
                  )
                })}
              </g>
            )
          })}

          {periods.map((period, index) => (
            <text key={period} x={xScale(index)} y={PLOT_HEIGHT + 20} textAnchor="middle" fontSize="10" fill="var(--text-muted)">
              {period}
            </text>
          ))}
        </g>
      </svg>

      {series.length > 1 && (
        <ul>
          {series.map((s, index) => (
            <li key={s.label}>
              <span style={{ color: seriesColor(index) }}>■</span>{' '}
              {onSelectSeries && s.selectable !== false ? (
                <button type="button" onClick={() => onSelectSeries({ series: s, seriesIndex: index })}>
                  {s.label}
                </button>
              ) : s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
