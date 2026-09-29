import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetAlertsCountForTests,
  getAlertsCount,
  setAlertsCount,
  subscribeToAlertsCount,
} from './alertsCount.ts'

beforeEach(() => {
  _resetAlertsCountForTests()
})

describe('getAlertsCount / setAlertsCount', () => {
  it('starts as null - not yet known, not zero', () => {
    expect(getAlertsCount()).toBeNull()
  })

  it('reflects the value set', () => {
    setAlertsCount(5)

    expect(getAlertsCount()).toBe(5)
  })

  it('can be set back to zero explicitly, distinct from unknown', () => {
    setAlertsCount(0)

    expect(getAlertsCount()).toBe(0)
  })
})

describe('subscribeToAlertsCount', () => {
  it('notifies subscribers when the count changes', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToAlertsCount(listener)

    setAlertsCount(3)
    expect(listener).toHaveBeenCalledTimes(1)

    setAlertsCount(0)
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    setAlertsCount(7)
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
