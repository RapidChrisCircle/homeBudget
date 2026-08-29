// Pure calendar-grid math for widgets/TransactionCalendar.jsx - kept out of
// the component so the "which weekday does the 1st fall on, how many
// leading/trailing blanks does the grid need" logic is unit-testable
// without rendering anything, the same separation utils/trendsSeries.js
// already uses for its own chart-shaping logic.

// One week per row, Sunday first (matching the reference dashboard's own
// "S M T W T F S" header) - each cell is either null (padding, before the
// 1st or after the last day) or {day, date: 'YYYY-MM-DD'}. Always a whole
// number of weeks (padded at both ends), so every row is 7 cells and a
// caller never has to special-case a short first/last row.
export function buildCalendarWeeks(year, month) {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1))
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const startWeekday = firstOfMonth.getUTCDay() // 0 = Sunday

  const cells = []

  for (let i = 0; i < startWeekday; i++) {
    cells.push(null)
  }

  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ day, date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` })
  }

  while (cells.length % 7 !== 0) {
    cells.push(null)
  }

  const weeks = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }

  return weeks
}

// The `count` (year, month) periods ending at (year, month) inclusive,
// oldest first - the identical "walk back N months" shape
// utils/trendsSeries.js's own contiguous-window logic follows (mirroring
// the backend's reporting.contiguous_periods), so a multi-month
// TransactionCalendar widget lists its months the same way every other
// multi-month view in this app does.
export function monthsBack(year, month, count) {
  const periods = []

  for (let offset = count - 1; offset >= 0; offset--) {
    const zeroBased = year * 12 + (month - 1) - offset
    periods.push({ year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 })
  }

  return periods
}

// The inclusive [from, to] date-string bounds spanning every day in
// `periods` (monthsBack's own output) - from the 1st of the earliest month
// to the last day of the latest one.
export function periodsDateRange(periods) {
  const first = periods[0]
  const last = periods[periods.length - 1]
  const lastDay = new Date(Date.UTC(last.year, last.month, 0)).getUTCDate()

  const pad = (n) => String(n).padStart(2, '0')

  return {
    from: `${first.year}-${pad(first.month)}-01`,
    to: `${last.year}-${pad(last.month)}-${pad(lastDay)}`,
  }
}
