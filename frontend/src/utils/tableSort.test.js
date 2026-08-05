import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { compareForSort, sortRowsBy, useTableSort } from './tableSort.js'

describe('compareForSort', () => {
  it('compares numbers numerically, not lexically', () => {
    // Lexical comparison would put "10" before "9" - numeric must not.
    expect(compareForSort('9', '10', 'numeric', 'asc')).toBeLessThan(0)
    expect(compareForSort(9, 10, 'numeric', 'asc')).toBeLessThan(0)
  })

  it('compares dates chronologically', () => {
    expect(compareForSort('2026-01-01', '2026-07-01', 'date', 'asc')).toBeLessThan(0)
    expect(compareForSort('2026-07-01', '2026-01-01', 'date', 'asc')).toBeGreaterThan(0)
  })

  it('compares strings case-insensitively', () => {
    expect(compareForSort('banana', 'Apple', 'string', 'asc')).toBeGreaterThan(0)
    expect(compareForSort('apple', 'Apple', 'string', 'asc')).toBe(0)
  })

  it('sorts null/empty values last in ascending direction', () => {
    expect(compareForSort(null, 5, 'numeric', 'asc')).toBeGreaterThan(0)
    expect(compareForSort(5, null, 'numeric', 'asc')).toBeLessThan(0)
    expect(compareForSort('', 'Groceries', 'string', 'asc')).toBeGreaterThan(0)
  })

  it('sorts null/empty values last in descending direction too - not first', () => {
    expect(compareForSort(null, 5, 'numeric', 'desc')).toBeGreaterThan(0)
    expect(compareForSort(5, null, 'numeric', 'desc')).toBeLessThan(0)
  })

  it('treats two empty values as equal', () => {
    expect(compareForSort(null, undefined, 'numeric', 'asc')).toBe(0)
    expect(compareForSort('', null, 'string', 'desc')).toBe(0)
  })
})

describe('useTableSort', () => {
  const rows = [
    { id: 1, name: 'Groceries', amount: 50 },
    { id: 2, name: 'Dining', amount: 10 },
    { id: 3, name: null, amount: 30 },
  ]
  const columns = {
    name: { getValue: (r) => r.name, type: 'string' },
    amount: { getValue: (r) => r.amount, type: 'numeric' },
  }

  it('returns rows unsorted until a column is toggled', () => {
    const { result } = renderHook(() => useTableSort(rows, columns))

    expect(result.current.sortedRows).toBe(rows)
    expect(result.current.sortKey).toBeNull()
    expect(result.current.sortDirection).toBeNull()
  })

  it('seeds an initial active sort when given one, making an implicit fetched order visible', () => {
    const { result } = renderHook(() => useTableSort(rows, columns, { sortKey: 'amount', sortDirection: 'desc' }))

    expect(result.current.sortKey).toBe('amount')
    expect(result.current.sortDirection).toBe('desc')
    expect(result.current.sortedRows.map((r) => r.id)).toEqual([1, 3, 2])
  })

  it('cycles a column asc -> desc -> none', () => {
    const { result } = renderHook(() => useTableSort(rows, columns))

    act(() => result.current.toggleSort('amount'))
    expect(result.current.sortKey).toBe('amount')
    expect(result.current.sortDirection).toBe('asc')
    expect(result.current.sortedRows.map((r) => r.id)).toEqual([2, 3, 1])

    act(() => result.current.toggleSort('amount'))
    expect(result.current.sortDirection).toBe('desc')
    expect(result.current.sortedRows.map((r) => r.id)).toEqual([1, 3, 2])

    act(() => result.current.toggleSort('amount'))
    expect(result.current.sortKey).toBeNull()
    expect(result.current.sortDirection).toBeNull()
    expect(result.current.sortedRows).toBe(rows)
  })

  it('switching to a different column starts that column fresh at asc', () => {
    const { result } = renderHook(() => useTableSort(rows, columns))

    act(() => result.current.toggleSort('amount'))
    act(() => result.current.toggleSort('amount')) // now desc

    act(() => result.current.toggleSort('name'))
    expect(result.current.sortKey).toBe('name')
    expect(result.current.sortDirection).toBe('asc')
    // null name sorts last regardless of direction.
    expect(result.current.sortedRows.map((r) => r.id)).toEqual([2, 1, 3])
  })
})

describe('sortRowsBy', () => {
  const rows = [
    { id: 1, name: 'Groceries', amount: 50 },
    { id: 2, name: 'Dining', amount: 10 },
  ]
  const columns = { amount: { getValue: (r) => r.amount, type: 'numeric' } }

  it('sorts by the given key and direction', () => {
    expect(sortRowsBy(rows, 'amount', 'asc', columns).map((r) => r.id)).toEqual([2, 1])
    expect(sortRowsBy(rows, 'amount', 'desc', columns).map((r) => r.id)).toEqual([1, 2])
  })

  it('is a no-op (returns the same reference) when sortKey is null', () => {
    expect(sortRowsBy(rows, null, null, columns)).toBe(rows)
  })

  it('is a no-op when the key is not in columns', () => {
    expect(sortRowsBy(rows, 'not-a-column', 'asc', columns)).toBe(rows)
  })

  it('applied independently per section still shares one sortKey/direction - the useTableSort case for a grouped table', () => {
    const sectionA = [{ id: 1, amount: 5 }, { id: 2, amount: 1 }]
    const sectionB = [{ id: 3, amount: 9 }, { id: 4, amount: 2 }]

    expect(sortRowsBy(sectionA, 'amount', 'asc', columns).map((r) => r.id)).toEqual([2, 1])
    expect(sortRowsBy(sectionB, 'amount', 'asc', columns).map((r) => r.id)).toEqual([4, 3])
  })
})
