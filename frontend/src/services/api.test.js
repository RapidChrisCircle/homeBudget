import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetBuildIdentityForTests,
  describeApiError,
  getMultipleBuildsDetected,
  recordBuildIdentity,
  subscribeToBuildIdentity,
} from './api.ts'

// Plain fake axios-error shapes - no network mocking needed, since
// describeApiError only ever reads error.response/.config/.message, the
// same fields axios itself populates on a real rejected request.
function axiosError({ status, data, statusText = 'Not Found', method = 'get', url = '/transactions' } = {}) {
  return {
    config: { method, url },
    response: status === undefined ? undefined : { status, statusText, data },
    message: 'Request failed with status code ' + status,
  }
}

describe('describeApiError', () => {
  it('enriches a bare 404 with the method, path and status', async () => {
    const error = axiosError({ status: 404, data: { detail: 'Not Found' } })

    await expect(describeApiError(error)).rejects.toBe(error)
    expect(error.response.data.detail).toBe(
      '404 Not Found — GET /transactions did not match any route on the API that answered'
    )
  })

  it('enriches a bare 405 the same way, with the actual method used', async () => {
    const error = axiosError({
      status: 405, statusText: 'Method Not Allowed', data: { detail: 'Method Not Allowed' }, method: 'post',
    })

    await expect(describeApiError(error)).rejects.toBe(error)
    expect(error.response.data.detail).toBe(
      '405 Method Not Allowed — POST /transactions did not match any route on the API that answered'
    )
  })

  it('leaves a real, specific detail from this API completely untouched', async () => {
    const error = axiosError({ status: 404, data: { detail: 'Category not found' } })

    await expect(describeApiError(error)).rejects.toBe(error)
    expect(error.response.data.detail).toBe('Category not found')
  })

  it('leaves a 422 validation detail untouched - it is content, not ambiguity', async () => {
    const error = axiosError({
      status: 422, data: { detail: 'min_amount must not be greater than max_amount' },
    })

    await expect(describeApiError(error)).rejects.toBe(error)
    expect(error.response.data.detail).toBe('min_amount must not be greater than max_amount')
  })

  it('does not mistake a 500 for a route-matching problem, even with a generic-looking detail', async () => {
    const error = axiosError({ status: 500, statusText: 'Internal Server Error', data: { detail: 'Not Found' } })

    // "Not Found" only means "no route matched" when paired with 404 (or
    // "Method Not Allowed" with 405) - on any other status it is left
    // alone rather than guessed at.
    await expect(describeApiError(error)).rejects.toBe(error)
    expect(error.response.data.detail).toBe('Not Found')
  })

  it('fills in a status line when there is no detail at all', async () => {
    const error = axiosError({ status: 500, statusText: 'Internal Server Error', data: {} })

    await expect(describeApiError(error)).rejects.toBe(error)
    expect(error.response.data.detail).toBe('500 Internal Server Error — GET /transactions')
  })

  it('leaves a network error (no response reached) untouched', async () => {
    const error = axiosError({ status: undefined })
    error.message = 'Network Error'

    await expect(describeApiError(error)).rejects.toBe(error)
    expect(error.response).toBeUndefined()
    expect(error.message).toBe('Network Error')
  })

  it('always rejects, never swallows the error', async () => {
    const error = axiosError({ status: 404, data: { detail: 'Not Found' } })

    await expect(describeApiError(error)).rejects.toBeDefined()
  })
})

function withCommit(commit) {
  return { headers: commit === undefined ? {} : { 'x-app-commit': commit } }
}

describe('recordBuildIdentity', () => {
  beforeEach(() => {
    _resetBuildIdentityForTests()
  })

  it('is undetected before anything has been recorded', () => {
    expect(getMultipleBuildsDetected()).toBe(false)
  })

  it('establishes the first response as the baseline without flagging anything', () => {
    recordBuildIdentity(withCommit('abc1234'))

    expect(getMultipleBuildsDetected()).toBe(false)
  })

  it('does not flag a consistent commit across many responses', () => {
    recordBuildIdentity(withCommit('abc1234'))
    recordBuildIdentity(withCommit('abc1234'))
    recordBuildIdentity(withCommit('abc1234'))

    expect(getMultipleBuildsDetected()).toBe(false)
  })

  it('flags a later response with a different commit', () => {
    recordBuildIdentity(withCommit('abc1234'))
    recordBuildIdentity(withCommit('def5678'))

    expect(getMultipleBuildsDetected()).toBe(true)
  })

  it('does not flag a build that consistently has no header at all - the feature simply is not deployed there', () => {
    recordBuildIdentity(withCommit(undefined))
    recordBuildIdentity(withCommit(undefined))

    expect(getMultipleBuildsDetected()).toBe(false)
  })

  it('flags the header appearing where it was consistently absent before', () => {
    recordBuildIdentity(withCommit(undefined))
    recordBuildIdentity(withCommit('abc1234'))

    expect(getMultipleBuildsDetected()).toBe(true)
  })

  it('is a one-way latch - it does not clear once a mismatch is seen', () => {
    recordBuildIdentity(withCommit('abc1234'))
    recordBuildIdentity(withCommit('def5678'))
    recordBuildIdentity(withCommit('abc1234'))

    expect(getMultipleBuildsDetected()).toBe(true)
  })

  it('notifies subscribers exactly once, the moment a mismatch is first detected', () => {
    const listener = vi.fn()
    subscribeToBuildIdentity(listener)

    recordBuildIdentity(withCommit('abc1234'))
    expect(listener).not.toHaveBeenCalled()

    recordBuildIdentity(withCommit('def5678'))
    expect(listener).toHaveBeenCalledTimes(1)

    recordBuildIdentity(withCommit('ghi9999'))
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('stops notifying a listener once it unsubscribes', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToBuildIdentity(listener)
    unsubscribe()

    recordBuildIdentity(withCommit('abc1234'))
    recordBuildIdentity(withCommit('def5678'))

    expect(listener).not.toHaveBeenCalled()
  })

  it('tolerates a response with no headers object at all', () => {
    expect(() => recordBuildIdentity(undefined)).not.toThrow()
    expect(() => recordBuildIdentity({})).not.toThrow()
  })
})
