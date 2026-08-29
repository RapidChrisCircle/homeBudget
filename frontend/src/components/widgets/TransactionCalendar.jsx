import { buildCalendarWeeks } from '../../utils/calendar.js'
import { formatAmount } from '../../utils/format.js'

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// One month's activity as a calendar grid - a heatmap-shaped widget, but a
// DIVERGING one, not sequential: each day has two poled quantities (money
// in vs money out), so the color job is direction, the same success/danger
// pair every <Amount> and Badge already uses for a positive/negative
// figure app-wide (dataviz skill: "Above/below a baseline" is a diverging
// job). A day's bar is colored by its NET direction and sized by |net|
// relative to the busiest day in the month, so "how big" and "which way"
// both read from one mark without a second legend.
//
// `days` is GET /api/reports/daily's response, already scoped to this
// month by the caller (widgetRegistry.jsx) - sparse, one row per day WITH
// activity, so a day with none renders its number with no bar at all
// rather than a zero-height one indistinguishable from a rounding error.
export default function TransactionCalendar({ year, month, monthLabel, days, onSelectDay }) {
  const weeks = buildCalendarWeeks(year, month)
  const byDate = new Map(days.map((d) => [d.date, d]))

  const totalIn = days.reduce((sum, d) => sum + Number(d.total_in), 0)
  const totalOut = days.reduce((sum, d) => sum + Number(d.total_out), 0)
  const maxMagnitude = Math.max(
    1,
    ...days.map((d) => Math.abs(Number(d.total_in) - Number(d.total_out)))
  )

  return (
    <div className="tx-calendar">
      <div className="tx-calendar-header">
        <span className="tx-calendar-month">{monthLabel}</span>
        <span className="tx-calendar-totals">
          <span className="amount-positive">↑ {formatAmount(totalIn)}</span>{' '}
          <span className="amount-negative">↓ {formatAmount(totalOut)}</span>
        </span>
      </div>
      <table className="tx-calendar-grid">
        <caption className="visually-hidden">{monthLabel} transaction calendar</caption>
        <thead>
          <tr>
            {WEEKDAY_LABELS.map((label, index) => (
              // Sunday appears twice (index 0 and 6) - keyed by position,
              // not label text, since the label alone isn't unique.
              <th scope="col" key={index}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, weekIndex) => (
            <tr key={weekIndex}>
              {week.map((cell, cellIndex) => {
                if (!cell) {
                  return <td key={cellIndex} className="tx-calendar-cell-empty" />
                }

                const activity = byDate.get(cell.date)
                const hasActivity = Boolean(activity)
                const net = hasActivity ? Number(activity.total_in) - Number(activity.total_out) : 0
                const barHeight = hasActivity ? Math.max(4, Math.round((Math.abs(net) / maxMagnitude) * 24)) : 0
                const barTone = net >= 0 ? 'tx-calendar-bar-in' : 'tx-calendar-bar-out'
                const description = hasActivity
                  ? `${cell.date}: ${activity.count} transaction(s), `
                    + `in ${formatAmount(activity.total_in)}, out ${formatAmount(activity.total_out)}`
                  : `${cell.date}: no activity`

                if (hasActivity && onSelectDay) {
                  return (
                    <td key={cellIndex}>
                      <button
                        type="button"
                        className="tx-calendar-day tx-calendar-day-clickable"
                        onClick={() => onSelectDay(cell.date)}
                        aria-label={description}
                      >
                        <span className="tx-calendar-day-number">{cell.day}</span>
                        <span className={`tx-calendar-bar ${barTone}`} style={{ height: `${barHeight}px` }} />
                      </button>
                    </td>
                  )
                }

                return (
                  <td key={cellIndex}>
                    <div className="tx-calendar-day" aria-label={hasActivity ? description : undefined}>
                      <span className="tx-calendar-day-number">{cell.day}</span>
                      {hasActivity && (
                        <span className={`tx-calendar-bar ${barTone}`} style={{ height: `${barHeight}px` }} />
                      )}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
