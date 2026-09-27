import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readStoredCollapsed, storeCollapsed } from './sidebar.js'

describe('readStoredCollapsed / storeCollapsed', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to expanded (false) when nothing is stored', () => {
    expect(readStoredCollapsed()).toBe(false)
  })

  it('round-trips a stored true value', () => {
    storeCollapsed(true)
    expect(readStoredCollapsed()).toBe(true)
  })

  it('round-trips a stored false value', () => {
    storeCollapsed(true)
    storeCollapsed(false)
    expect(readStoredCollapsed()).toBe(false)
  })

  it('defaults to expanded for any unrecognized stored value rather than throwing', () => {
    localStorage.setItem('homebudget:sidebar-collapsed', 'sepia')
    expect(readStoredCollapsed()).toBe(false)
  })

  it('degrades to expanded without throwing when localStorage itself throws on read', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    expect(() => readStoredCollapsed()).not.toThrow()
    expect(readStoredCollapsed()).toBe(false)
    spy.mockRestore()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('degrades silently without throwing when localStorage itself throws on write', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    expect(() => storeCollapsed(true)).not.toThrow()
    spy.mockRestore()
  })
})
