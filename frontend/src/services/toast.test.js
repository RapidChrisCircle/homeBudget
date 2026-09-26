import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetToastsForTests,
  dismissToast,
  getToasts,
  showToast,
  subscribeToToasts,
} from './toast.ts'

beforeEach(() => {
  _resetToastsForTests()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('showToast / getToasts', () => {
  it('adds a toast with the given message and default tone', () => {
    showToast('Budget saved.')

    const toasts = getToasts()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe('Budget saved.')
    expect(toasts[0].tone).toBe('success')
  })

  it('accepts an explicit tone', () => {
    showToast('Heads up.', { tone: 'info' })

    expect(getToasts()[0].tone).toBe('info')
  })

  it('assigns each toast a distinct id', () => {
    const first = showToast('One')
    const second = showToast('Two')

    expect(first).not.toBe(second)
    expect(getToasts().map((t) => t.id)).toEqual([first, second])
  })

  it('auto-dismisses after the default duration', () => {
    showToast('Gone soon')
    expect(getToasts()).toHaveLength(1)

    vi.advanceTimersByTime(4000)

    expect(getToasts()).toHaveLength(0)
  })

  it('respects a custom durationMs', () => {
    showToast('Custom', { durationMs: 1000 })

    vi.advanceTimersByTime(999)
    expect(getToasts()).toHaveLength(1)

    vi.advanceTimersByTime(1)
    expect(getToasts()).toHaveLength(0)
  })

  it('never auto-dismisses when durationMs is 0', () => {
    showToast('Sticks around', { durationMs: 0 })

    vi.advanceTimersByTime(100000)

    expect(getToasts()).toHaveLength(1)
  })
})

describe('dismissToast', () => {
  it('removes only the targeted toast', () => {
    const first = showToast('First', { durationMs: 0 })
    const second = showToast('Second', { durationMs: 0 })

    dismissToast(first)

    expect(getToasts().map((t) => t.id)).toEqual([second])
  })

  it('is a harmless no-op for an unknown id', () => {
    showToast('Still here', { durationMs: 0 })

    expect(() => dismissToast(999)).not.toThrow()
    expect(getToasts()).toHaveLength(1)
  })
})

describe('subscribeToToasts', () => {
  it('notifies subscribers when a toast is shown or dismissed', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToToasts(listener)

    const id = showToast('Notify me', { durationMs: 0 })
    expect(listener).toHaveBeenCalledTimes(1)

    dismissToast(id)
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    showToast('After unsubscribe', { durationMs: 0 })
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
