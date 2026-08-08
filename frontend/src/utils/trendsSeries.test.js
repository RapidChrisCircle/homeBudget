import { describe, expect, it } from 'vitest'
import { buildLevel, buildSeries, drilledGroupName, monthBounds } from './trendsSeries.js'

const periods = [
  { year: 2026, month: 6, label: '2026-06' },
  { year: 2026, month: 7, label: '2026-07' },
]

const categories = [
  {
    category_id: 1,
    category_name: 'Groceries',
    parent_id: 10,
    parent_name: 'Food',
    kind: 'expense',
    amounts: { '2026-06': '100.00', '2026-07': '120.00' },
    total: '220.00',
  },
  {
    category_id: 2,
    category_name: 'Takeaway',
    parent_id: 10,
    parent_name: 'Food',
    kind: 'expense',
    amounts: { '2026-06': '40.00', '2026-07': '30.00' },
    total: '70.00',
  },
  {
    category_id: 3,
    category_name: 'Rent',
    parent_id: null,
    parent_name: null,
    kind: 'expense',
    amounts: { '2026-06': '500.00', '2026-07': '500.00' },
    total: '1000.00',
  },
  {
    category_id: 4,
    category_name: 'Salary',
    parent_id: null,
    parent_name: null,
    kind: 'income',
    amounts: { '2026-06': '5000.00', '2026-07': '5000.00' },
    total: '10000.00',
  },
]

describe('buildLevel', () => {
  it('rolls a group\'s children up into one row at the top level', () => {
    const rows = buildLevel(periods, categories, '')

    expect(rows.map((r) => r.label).sort()).toEqual(['Food', 'Rent'])

    const food = rows.find((r) => r.label === 'Food')
    expect(food.amounts['2026-06']).toBe(140)
    expect(food.amounts['2026-07']).toBe(150)
    expect(food.total).toBe(290)
  })

  it('marks a group row as drilling into the group and a leaf as drilling to the ledger', () => {
    const rows = buildLevel(periods, categories, '')

    expect(rows.find((r) => r.label === 'Food').drill).toEqual({ kind: 'group', id: 10 })
    expect(rows.find((r) => r.label === 'Rent').drill).toEqual({ kind: 'category', id: 3 })
  })

  it('shows only that group\'s children once drilled in', () => {
    const rows = buildLevel(periods, categories, '10')

    expect(rows.map((r) => r.label)).toEqual(['Groceries', 'Takeaway'])
    expect(rows[0].drill).toEqual({ kind: 'category', id: 1 })
  })

  it('excludes income categories - this is the spending chart', () => {
    const labels = buildLevel(periods, categories, '').map((r) => r.label)

    expect(labels).not.toContain('Salary')
  })
})

describe('buildSeries', () => {
  const manyRows = Array.from({ length: 8 }, (_row, index) => ({
    label: `Category ${index}`,
    amounts: { '2026-06': 10 * (8 - index), '2026-07': 10 * (8 - index) },
    total: 20 * (8 - index),
    drill: { kind: 'category', id: index },
  }))

  it('keeps the six biggest and sums the rest into Other', () => {
    const series = buildSeries(periods, manyRows)

    expect(series).toHaveLength(7)
    expect(series[6].label).toBe('Other')
    expect(series[6].values).toEqual([30, 30])
  })

  it('marks Other as not selectable - a sum has nothing to drill into', () => {
    const series = buildSeries(periods, manyRows)

    expect(series[6].selectable).toBe(false)
    expect(series[0].selectable).toBeUndefined()
  })

  it('adds no Other line when everything fits', () => {
    const series = buildSeries(periods, buildLevel(periods, categories, ''))

    expect(series.map((s) => s.label)).not.toContain('Other')
  })
})

describe('drilledGroupName', () => {
  it('names the group being drilled into', () => {
    expect(drilledGroupName(categories, '10')).toBe('Food')
  })

  it('is null for a group with nothing in this window, so the page falls back', () => {
    expect(drilledGroupName(categories, '999')).toBeNull()
    expect(drilledGroupName(categories, '')).toBeNull()
  })
})

describe('monthBounds', () => {
  it('spans the whole month, inclusive on both ends like the ledger filter', () => {
    expect(monthBounds('2026-07')).toEqual({ from: '2026-07-01', to: '2026-07-31' })
    expect(monthBounds('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(monthBounds('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  })
})
