import { describe, expect, it } from 'vitest'
import { CATEGORY_COLOR_TOKENS, categoryColorVar } from './categoryColors.js'

describe('categoryColorVar', () => {
  it('resolves a known token to its CSS custom property', () => {
    expect(categoryColorVar('category-3')).toBe('var(--category-3)')
  })

  it('returns null for a falsy token - no colour chosen', () => {
    expect(categoryColorVar(null)).toBeNull()
    expect(categoryColorVar(undefined)).toBeNull()
    expect(categoryColorVar('')).toBeNull()
  })

  it('returns null for an unrecognised token rather than emitting a broken var()', () => {
    // A stale token from an older build with fewer swatches, or a
    // hand-edited API call - must degrade to no colour, not a var()
    // reference to a custom property that doesn't exist.
    expect(categoryColorVar('category-99')).toBeNull()
    expect(categoryColorVar('not-a-token')).toBeNull()
  })

  it('every listed token round-trips through categoryColorVar', () => {
    for (const { token } of CATEGORY_COLOR_TOKENS) {
      expect(categoryColorVar(token)).toBe(`var(--${token})`)
    }
  })
})
