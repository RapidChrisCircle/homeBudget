import { describe, expect, it } from 'vitest'
import { formatDate, formatMonths, formatPercent, transactionAmount } from './format.js'

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

describe('formatPercent', () => {
  it('renders a ratio as a percentage to one decimal place', () => {
    expect(formatPercent(0.234)).toBe('23.4%')
    expect(formatPercent(0.8)).toBe('80.0%')
  })

  it('renders a negative ratio with its sign, for a spending-exceeds-income month', () => {
    expect(formatPercent(-0.5)).toBe('-50.0%')
  })

  it('renders exactly zero as 0.0%, not an empty string', () => {
    expect(formatPercent(0)).toBe('0.0%')
  })

  it('returns an empty string for a missing ratio', () => {
    expect(formatPercent(null)).toBe('')
    expect(formatPercent(undefined)).toBe('')
  })
})

describe('formatMonths', () => {
  it('renders a fractional count with the plural unit', () => {
    expect(formatMonths(4.2)).toBe('4.2 months')
  })

  it('uses the singular only for exactly one whole month', () => {
    expect(formatMonths(1)).toBe('1.0 month')
  })

  it('uses the plural for zero months', () => {
    expect(formatMonths(0)).toBe('0.0 months')
  })

  it('returns an empty string for a missing value', () => {
    expect(formatMonths(null)).toBe('')
    expect(formatMonths(undefined)).toBe('')
  })
})
