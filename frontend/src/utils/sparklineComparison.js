// Pure data-shaping for widgets/ComparisonSparkline.jsx - turning
// GET /api/reports/daily's per-day rows (and, for the budget basis, a
// monthly total) into the two cumulative-spend curves the chart plots.
// Kept out of the component and the widget's own data-fetching, the same
// separation utils/trendsSeries.js already uses, so the day-of-month
// arithmetic is unit-testable without a network call or a render.

// Running total_out, one point per day-of-month (1..daysInMonth). A day
// beyond `knownThroughDay` is null - a genuine gap (it hasn't happened
// yet), not zero, the same "missing is not zero" rule every chart in this
// app already follows (see LineChart's own module docstring). Defaults
// knownThroughDay to the whole month, for a fully-elapsed past month; the
// current month passes in today's day-of-month explicitly.
export function cumulativeSpendByDay(daysInMonth, dailyRows, knownThroughDay = daysInMonth) {
  const byDay = new Map(dailyRows.map((row) => [Number(row.date.slice(-2)), Number(row.total_out)]))

  const values = []
  let running = 0

  for (let day = 1; day <= daysInMonth; day++) {
    if (day > knownThroughDay) {
      values.push(null)
      continue
    }
    running += byDay.get(day) || 0
    values.push(running)
  }

  return values
}

// Element-wise average of several cumulativeSpendByDay() arrays, re-indexed
// by day-of-month so day 15 of each source month lines up regardless of
// which month it came from. A null at some index (a shorter month, e.g.
// February's day 30/31 inside a 31-day comparison) is skipped rather than
// treated as zero, so a short month doesn't drag the tail of the average
// toward zero.
export function averageCumulative(series) {
  if (series.length === 0) {
    return []
  }

  const length = Math.max(...series.map((s) => s.length))
  const result = []

  for (let i = 0; i < length; i++) {
    const values = series.map((s) => s[i]).filter((v) => v !== null && v !== undefined)
    result.push(values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null)
  }

  return result
}

// A flat monthly budget spread evenly across the month - day i's figure is
// "what you'd have spent by now if you spent this budget at a constant
// daily rate", the reference line a budget-paced comparison needs.
export function budgetPace(daysInMonth, monthlyBudget) {
  const perDay = Number(monthlyBudget) / daysInMonth
  const values = []

  for (let day = 1; day <= daysInMonth; day++) {
    values.push(perDay * day)
  }

  return values
}
