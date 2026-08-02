import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, readStoredMode, resolveAutoTheme, resolveTheme, storeMode } from './theme.js'

function at(hour) {
  return new Date(2026, 6, 15, hour, 0, 0)
}

describe('resolveAutoTheme', () => {
  it('is dark late at night', () => {
    expect(resolveAutoTheme(at(22))).toBe('dark')
    expect(resolveAutoTheme(at(3))).toBe('dark')
  })

  it('is light during the day', () => {
    expect(resolveAutoTheme(at(9))).toBe('light')
    expect(resolveAutoTheme(at(14))).toBe('light')
  })

  it('is dark exactly at 18:00 and light exactly at 06:00', () => {
    expect(resolveAutoTheme(at(18))).toBe('dark')
    expect(resolveAutoTheme(at(6))).toBe('light')
  })

  it('is light just before 18:00 and dark just before 06:00', () => {
    expect(resolveAutoTheme(new Date(2026, 6, 15, 17, 59))).toBe('light')
    expect(resolveAutoTheme(new Date(2026, 6, 15, 5, 59))).toBe('dark')
  })
})

describe('resolveTheme', () => {
  it('resolves auto from the clock', () => {
    expect(resolveTheme('auto', at(22))).toBe('dark')
    expect(resolveTheme('auto', at(9))).toBe('light')
  })

  it('passes an explicit light/dark choice straight through, ignoring the clock', () => {
    expect(resolveTheme('light', at(22))).toBe('light')
    expect(resolveTheme('dark', at(9))).toBe('dark')
  })
})

describe('readStoredMode / storeMode', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to auto when nothing is stored', () => {
    expect(readStoredMode()).toBe('auto')
  })

  it('round-trips a stored mode', () => {
    storeMode('dark')
    expect(readStoredMode()).toBe('dark')
  })

  it('falls back to auto for an unrecognized stored value rather than throwing', () => {
    localStorage.setItem('homebudget:theme-mode', 'sepia')
    expect(readStoredMode()).toBe('auto')
  })

  it('degrades to auto without throwing when localStorage itself throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    expect(() => readStoredMode()).not.toThrow()
    expect(readStoredMode()).toBe('auto')
    spy.mockRestore()
  })
})

describe('applyTheme', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.style.colorScheme = ''
  })

  it('stamps data-theme and color-scheme onto the document element', () => {
    applyTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })
})
