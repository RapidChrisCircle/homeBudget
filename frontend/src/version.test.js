import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAppVersion, getGitSha } from './version.js'

describe('version', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the build-injected app version when defined', () => {
    vi.stubGlobal('__APP_VERSION__', '1.2.3')

    expect(getAppVersion()).toBe('1.2.3')
  })

  it('falls back to "dev" when the build did not inject a version', () => {
    vi.stubGlobal('__APP_VERSION__', undefined)

    expect(getAppVersion()).toBe('dev')
  })

  it('returns the build-injected git sha when defined', () => {
    vi.stubGlobal('__GIT_SHA__', 'abc1234')

    expect(getGitSha()).toBe('abc1234')
  })

  it('falls back to "unknown" when the build did not inject a sha', () => {
    vi.stubGlobal('__GIT_SHA__', undefined)

    expect(getGitSha()).toBe('unknown')
  })
})
