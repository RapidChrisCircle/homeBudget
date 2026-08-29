import { describe, expect, it } from 'vitest'
import { buildCalendarWeeks, monthsBack, periodsDateRange } from './calendar.js'

describe('buildCalendarWeeks', () => {
  it('pads the first week so the 1st lands on its real weekday', () => {
    // 2026-07-01 is a Wednesday (day 3), Sunday-first.
    const weeks = buildCalendarWeeks(2026, 7)

    expect(weeks[0]).toEqual([null, null, null, { day: 1, date: '2026-07-01' }, { day: 2, date: '2026-07-02' }, { day: 3, date: '2026-07-03' }, { day: 4, date: '2026-07-04' }])
  })

  it('every week has exactly 7 cells', () => {
    const weeks = buildCalendarWeeks(2026, 7)

    for (const week of weeks) {
      expect(week).toHaveLength(7)
    }
  })

  it('pads the trailing week so the grid always ends on a full week', () => {
    // 2026-07-31 is a Friday - the last week needs one trailing blank (Saturday).
    const weeks = buildCalendarWeeks(2026, 7)
    const lastWeek = weeks[weeks.length - 1]

    expect(lastWeek[5]).toEqual({ day: 31, date: '2026-07-31' })
    expect(lastWeek[6]).toBeNull()
  })

  it('handles a month starting on Sunday with no leading padding', () => {
    // 2026-11-01 is a Sunday.
    const weeks = buildCalendarWeeks(2026, 11)

    expect(weeks[0][0]).toEqual({ day: 1, date: '2026-11-01' })
    expect(weeks[0].slice(1).every((cell) => cell !== null)).toBe(true)
  })

  it('gets February right in a leap year', () => {
    const weeks = buildCalendarWeeks(2028, 2)
    const allDays = weeks.flat().filter(Boolean).map((c) => c.day)

    expect(Math.max(...allDays)).toBe(29)
  })

  it('gets February right in a non-leap year', () => {
    const weeks = buildCalendarWeeks(2026, 2)
    const allDays = weeks.flat().filter(Boolean).map((c) => c.day)

    expect(Math.max(...allDays)).toBe(28)
  })

  it('zero-pads single-digit days and months in the date string', () => {
    const weeks = buildCalendarWeeks(2026, 3)
    const first = weeks.flat().find((c) => c?.day === 5)

    expect(first.date).toBe('2026-03-05')
  })
})

describe('monthsBack', () => {
  it('lists a single month as just itself', () => {
    expect(monthsBack(2026, 7, 1)).toEqual([{ year: 2026, month: 7 }])
  })

  it('walks back N months, oldest first', () => {
    expect(monthsBack(2026, 7, 3)).toEqual([
      { year: 2026, month: 5 },
      { year: 2026, month: 6 },
      { year: 2026, month: 7 },
    ])
  })

  it('rolls back across a year boundary', () => {
    expect(monthsBack(2026, 2, 3)).toEqual([
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
    ])
  })
})

describe('periodsDateRange', () => {
  it('spans from the 1st of the earliest month to the last day of the latest', () => {
    const periods = monthsBack(2026, 2, 3)

    expect(periodsDateRange(periods)).toEqual({ from: '2025-12-01', to: '2026-02-28' })
  })

  it('gets the last day right for a single month with 31 days', () => {
    expect(periodsDateRange([{ year: 2026, month: 7 }])).toEqual({ from: '2026-07-01', to: '2026-07-31' })
  })
})
