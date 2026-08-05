import { describe, expect, it } from 'vitest'
import { formatDate, transactionAmount } from './format.js'

describe('formatDate', () => {
  it('reorders YYYY-MM-DD to DD/MM/YY', () => {
    expect(formatDate('2026-07-31')).toBe('31/07/26')
  })

  it('does not shift the day - the bug a naive new Date() parse would introduce', () => {
    // '2026-01-01' parsed as new Date('2026-01-01') is UTC midnight, which
    // renders as 2025-12-31 in any timezone behind UTC. Pure string
    // slicing must never reproduce that.
    expect(formatDate('2026-01-01')).toBe('01/01/26')
    expect(formatDate('2026-12-31')).toBe('31/12/26')
  })

  it('returns an empty string for a missing date', () => {
    expect(formatDate(null)).toBe('')
    expect(formatDate(undefined)).toBe('')
    expect(formatDate('')).toBe('')
  })
})

describe('transactionAmount', () => {
  it('returns the debit when only debit is set', () => {
    expect(transactionAmount({ debit: '-25.00', credit: null })).toBe('-25.00')
  })

  it('returns the credit when only credit is set', () => {
    expect(transactionAmount({ debit: null, credit: '3250.00' })).toBe('3250.00')
  })

  it('returns null when both are null - the defensive case import itself never actually produces', () => {
    expect(transactionAmount({ debit: null, credit: null })).toBe(null)
  })
})
