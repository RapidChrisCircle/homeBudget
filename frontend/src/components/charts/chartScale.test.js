import { describe, expect, it } from 'vitest'
import { computeDomain, linearScale, niceTicks } from './chartScale.js'

describe('computeDomain', () => {
  it('returns null for zero finite values - the caller\'s cue to show "not enough data"', () => {
    expect(computeDomain([])).toBeNull()
    expect(computeDomain([null, undefined])).toBeNull()
  })

  it('pads a flat non-zero series instead of returning a zero-height domain', () => {
    const domain = computeDomain([100, 100, 100])
    expect(domain.min).toBeLessThan(100)
    expect(domain.max).toBeGreaterThan(100)
  })

  it('pads a flat all-zero series around zero, not collapsing to a point', () => {
    const domain = computeDomain([0, 0])
    expect(domain.min).toBeLessThan(0)
    expect(domain.max).toBeGreaterThan(0)
  })

  it('spans zero when the values naturally cross it', () => {
    const domain = computeDomain([-50, 10, 30])
    expect(domain.min).toBeLessThan(-50)
    expect(domain.max).toBeGreaterThan(30)
  })

  it('does not force zero into view for an all-negative series by default', () => {
    const domain = computeDomain([-500, -300, -100])
    expect(domain.max).toBeLessThan(0)
  })

  it('forces zero into view for an all-negative series when includeZero is set', () => {
    const domain = computeDomain([-500, -300, -100], { includeZero: true })
    expect(domain.min).toBeLessThanOrEqual(-500)
    expect(domain.max).toBeGreaterThanOrEqual(0)
  })

  it('does not force the domain far above an all-positive series when includeZero is set', () => {
    // includeZero widens toward 0, it should not otherwise distort the domain.
    const domain = computeDomain([980, 1000, 1020], { includeZero: true })
    expect(domain.min).toBeLessThanOrEqual(0)
    expect(domain.max).toBeGreaterThanOrEqual(1020)
  })

  it('ignores null and undefined gaps mixed in with real values', () => {
    const domain = computeDomain([null, 10, undefined, 20, null])
    expect(domain.min).toBeLessThanOrEqual(10)
    expect(domain.max).toBeGreaterThanOrEqual(20)
  })
})

describe('linearScale', () => {
  it('maps the domain endpoints to the range endpoints', () => {
    const scale = linearScale({ domain: { min: 0, max: 100 }, range: [280, 0] })
    expect(scale(0)).toBe(280)
    expect(scale(100)).toBe(0)
    expect(scale(50)).toBe(140)
  })

  it('handles a negative domain', () => {
    const scale = linearScale({ domain: { min: -100, max: 0 }, range: [280, 0] })
    expect(scale(-100)).toBe(280)
    expect(scale(0)).toBe(0)
    expect(scale(-50)).toBe(140)
  })

  it('does not throw on a zero-width domain, and returns a finite value', () => {
    const scale = linearScale({ domain: { min: 5, max: 5 }, range: [280, 0] })
    expect(Number.isFinite(scale(5))).toBe(true)
  })
})

describe('niceTicks', () => {
  it('returns round numbers spanning the input range', () => {
    const ticks = niceTicks(0, 97, 5)
    expect(ticks[0]).toBeLessThanOrEqual(0)
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(97)
    // Every tick should be a "nice" multiple - no 19.999999-style float dust.
    ticks.forEach((t) => expect(t).toBe(Math.round(t * 1e6) / 1e6))
  })

  it('produces ticks that cross zero for a domain spanning it', () => {
    const ticks = niceTicks(-50, 30, 5)
    expect(ticks).toContain(0)
  })

  it('never returns an empty array, even for a flat domain', () => {
    expect(niceTicks(5, 5).length).toBeGreaterThan(0)
    expect(niceTicks(0, 0).length).toBeGreaterThan(0)
  })

  it('handles a small sub-10 range without collapsing to one tick', () => {
    const ticks = niceTicks(0, 3, 5)
    expect(ticks.length).toBeGreaterThan(1)
  })
})
