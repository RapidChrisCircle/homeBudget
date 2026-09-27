import { describe, expect, it } from 'vitest'
import { overBudgetLines } from './budgets.js'

describe('overBudgetLines', () => {
  it('keeps only lines with a negative difference', () => {
    const budgets = [
      { category_id: 1, difference: '-10.00' },
      { category_id: 2, difference: '10.00' },
      { category_id: 3, difference: '0.00' },
    ]

    expect(overBudgetLines(budgets).map((l) => l.category_id)).toEqual([1])
  })

  it('excludes a null difference rather than treating it as zero', () => {
    const budgets = [{ category_id: 1, difference: null }]

    expect(overBudgetLines(budgets)).toEqual([])
  })

  it('returns an empty array for a missing budgets list', () => {
    expect(overBudgetLines(undefined)).toEqual([])
    expect(overBudgetLines(null)).toEqual([])
  })
})
