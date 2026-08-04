import { describe, expect, it } from 'vitest'
import { groupCategorySummary } from './transactionGroups.js'

function group(overrides = {}) {
  return {
    category_names: [],
    uncategorized_count: 0,
    split_count: 0,
    ...overrides,
  }
}

describe('groupCategorySummary', () => {
  it('reports every row as uncategorized when nothing is categorized or split', () => {
    expect(groupCategorySummary(group({ uncategorized_count: 5 }))).toBe('5 uncategorized')
  })

  it('names the single category when the whole group agrees, with none left over', () => {
    expect(groupCategorySummary(group({ category_names: ['Groceries'] }))).toBe('Groceries')
  })

  it('reports Mixed when more than one category is present', () => {
    expect(groupCategorySummary(group({ category_names: ['Dining', 'Groceries'] }))).toBe('Mixed')
  })

  it('reports Mixed with the uncategorized count appended when a category is mixed with uncategorized rows', () => {
    expect(groupCategorySummary(group({ category_names: ['Groceries'], uncategorized_count: 3 })))
      .toBe('Mixed · 3 uncategorized')
  })

  it('reports Mixed when a single category is mixed with a split row, even with none uncategorized', () => {
    expect(groupCategorySummary(group({ category_names: ['Groceries'], split_count: 1 }))).toBe('Mixed')
  })

  it('reports Mixed with no uncategorized suffix when multiple categories but nothing uncategorized', () => {
    expect(groupCategorySummary(group({ category_names: ['Dining', 'Groceries'], split_count: 1 }))).toBe('Mixed')
  })
})
