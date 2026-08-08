import { describe, expect, it } from 'vitest'
import { categoryPathLabel, groupByParent } from './categories.js'

describe('categoryPathLabel', () => {
  it('names a child by its full path', () => {
    expect(categoryPathLabel({ name: 'Groceries', parent_name: 'Food' })).toBe('Food › Groceries')
  })

  it('leaves a top-level category as its own name', () => {
    expect(categoryPathLabel({ name: 'Rent', parent_name: null })).toBe('Rent')
  })

  it('reads the API responses that call the leaf name category_name', () => {
    expect(categoryPathLabel({ category_name: 'Groceries', parent_name: 'Food' })).toBe('Food › Groceries')
  })

  it('is safe on a missing record', () => {
    expect(categoryPathLabel(null)).toBe('')
    expect(categoryPathLabel(undefined)).toBe('')
  })

  it('distinguishes two same-named leaves under different groups', () => {
    const health = { category_name: 'Insurance', parent_name: 'Health' }
    const transport = { category_name: 'Insurance', parent_name: 'Transport' }

    expect(categoryPathLabel(health)).not.toBe(categoryPathLabel(transport))
  })
})

describe('groupByParent', () => {
  it('returns children under their parent and plain categories separately', () => {
    const { parentless, groups } = groupByParent([
      { id: 1, name: 'Food' },
      { id: 2, name: 'Groceries', parent_id: 1 },
      { id: 3, name: 'Rent' },
    ])

    expect(parentless.map((c) => c.name)).toEqual(['Rent'])
    expect(groups).toHaveLength(1)
    expect(groups[0].parent.name).toBe('Food')
    expect(groups[0].children.map((c) => c.name)).toEqual(['Groceries'])
  })
})
