import { describe, expect, it } from 'vitest'
import { averageCumulative, budgetPace, cumulativeSpendByDay } from './sparklineComparison.js'

describe('cumulativeSpendByDay', () => {
  it('runs a cumulative total across the days with activity', () => {
    const rows = [
      { date: '2026-07-01', total_out: '10.00' },
      { date: '2026-07-03', total_out: '5.00' },
      { date: '2026-07-05', total_out: '20.00' },
    ]

    const values = cumulativeSpendByDay(5, rows)

    expect(values).toEqual([10, 10, 15, 15, 35])
  })

  it('treats a day with no data as no additional spend, not a gap', () => {
    const rows = [{ date: '2026-07-01', total_out: '10.00' }]

    const values = cumulativeSpendByDay(3, rows)

    expect(values).toEqual([10, 10, 10])
  })

  it('leaves days beyond knownThroughDay as null gaps, not zero or repeated', () => {
    const rows = [{ date: '2026-07-01', total_out: '10.00' }]

    const values = cumulativeSpendByDay(5, rows, 2)

    expect(values).toEqual([10, 10, null, null, null])
  })

  it('defaults knownThroughDay to the whole month', () => {
    const values = cumulativeSpendByDay(3, [])

    expect(values).toEqual([0, 0, 0])
  })
})

describe('averageCumulative', () => {
  it('averages several equal-length series element-wise', () => {
    const result = averageCumulative([
      [10, 20, 30],
      [30, 40, 50],
    ])

    expect(result).toEqual([20, 30, 40])
  })

  it('skips a null at some index rather than treating it as zero', () => {
    // A shorter month's tail is null past its own last day - the average
    // for that day must not be dragged toward zero by a month that never
    // reached it.
    const result = averageCumulative([
      [10, 20, 30],
      [10, 20, null],
    ])

    expect(result).toEqual([10, 20, 30])
  })

  it('is null at an index where every source is null', () => {
    const result = averageCumulative([
      [10, null],
      [20, null],
    ])

    expect(result).toEqual([15, null])
  })

  it('returns an empty array for no series', () => {
    expect(averageCumulative([])).toEqual([])
  })
})

describe('budgetPace', () => {
  it('spreads the budget evenly across the month', () => {
    const values = budgetPace(4, 400)

    expect(values).toEqual([100, 200, 300, 400])
  })

  it('handles a non-round division without losing precision at the end', () => {
    const values = budgetPace(3, 100)

    expect(values[2]).toBeCloseTo(100)
  })
})
