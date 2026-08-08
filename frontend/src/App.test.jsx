import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.jsx'
import { api, __setMultipleBuildsDetected } from './services/api'

// The real subscribeToBuildIdentity/getMultipleBuildsDetected pair lives in
// services/api.ts, driven by the response interceptor - out of reach here
// since this file mocks the whole module (as every page test does). This
// stands in a minimal, independently controllable version of the same
// subscribe/getSnapshot shape, so a test can flip the flag directly rather
// than fabricating axios responses just to reach it.
vi.mock('./services/api', () => {
  let multipleBuildsDetected = false
  const listeners = new Set()

  return {
    api: {
      get: vi.fn(),
    },
    subscribeToBuildIdentity: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getMultipleBuildsDetected: () => multipleBuildsDetected,
    __setMultipleBuildsDetected: (value) => {
      multipleBuildsDetected = value
      for (const listener of listeners) listener()
    },
  }
})

// The dashboard renders at "/" and fires its own four API calls regardless
// of what these tests actually care about, so every path it touches needs a
// response that won't throw - an empty ledger (transactions total: 0) short
// -circuits Dashboard straight to its EmptyState branch, before it ever
// reads deeper into the report/recurring payloads.
function mockApi({ version, versionRejects = false } = {}) {
  api.get.mockImplementation((path) => {
    if (path === '/version') {
      return versionRejects ? Promise.reject(new Error('network error')) : Promise.resolve({ data: version })
    }
    if (path === '/accounts') {
      return Promise.resolve({ data: [] })
    }
    if (path.startsWith('/reports/monthly')) {
      return Promise.resolve({ data: {} })
    }
    if (path.startsWith('/transactions')) {
      return Promise.resolve({ data: { items: [], total: 0 } })
    }
    if (path === '/recurring') {
      return Promise.resolve({ data: { series: [], summary: null, as_of: null } })
    }
    return Promise.reject(new Error(`unexpected path ${path}`))
  })
}

function renderApp(initialEntries = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <App />
    </MemoryRouter>
  )
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    __setMultipleBuildsDetected(false)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.documentElement.removeAttribute('data-theme')
  })

  it('renders the frontend version and commit in the header', async () => {
    vi.stubGlobal('__APP_VERSION__', '0.11.0')
    vi.stubGlobal('__GIT_SHA__', 'd283b98abc')
    mockApi({ version: { version: '0.11.0', commit: 'd283b98abc' } })

    renderApp()

    expect(screen.getByText('homeBudget')).toBeInTheDocument()
    expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent.includes('v0.11.0') && el.textContent.includes('d283b98'))).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(/API v0\.11\.0/)).toBeInTheDocument()
    })
  })

  it('marks the active nav link and leaves the others unmarked', async () => {
    mockApi({ version: { version: '0.11.0', commit: 'unknown' } })

    renderApp(['/accounts'])

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/version'))

    expect(screen.getByRole('link', { name: 'Accounts' })).toHaveClass('active')
    expect(screen.getByRole('link', { name: 'Transactions' })).not.toHaveClass('active')
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveClass('active')
  })

  it('surfaces a mismatch notice when the API commit differs from the frontend commit', async () => {
    vi.stubGlobal('__GIT_SHA__', 'aaa1111')
    mockApi({ version: { version: '0.11.0', commit: 'bbb2222' } })

    renderApp()

    await waitFor(() => {
      expect(screen.getByText(/different builds/)).toBeInTheDocument()
    })
  })

  it('does not warn about a mismatch when both sides report an unknown commit', async () => {
    vi.stubGlobal('__GIT_SHA__', 'unknown')
    mockApi({ version: { version: '0.11.0', commit: 'unknown' } })

    renderApp()

    await waitFor(() => {
      expect(screen.getByText(/API v0\.11\.0/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/different builds/)).not.toBeInTheDocument()
  })

  it('surfaces a duplicate-build notice when responses stop coming from one consistent build', async () => {
    mockApi({ version: { version: '0.11.0', commit: 'unknown' } })

    renderApp()
    await waitFor(() => expect(screen.getByText(/API v0\.11\.0/)).toBeInTheDocument())
    expect(screen.queryByText(/more than one API build/)).not.toBeInTheDocument()

    act(() => {
      __setMultipleBuildsDetected(true)
    })

    expect(screen.getByText(/more than one API build/)).toBeInTheDocument()
  })

  it('renders "API version unknown" rather than a mismatch warning when the API is unreachable', async () => {
    vi.stubGlobal('__GIT_SHA__', 'aaa1111')
    mockApi({ versionRejects: true })

    renderApp()

    await waitFor(() => {
      expect(screen.getByText('API version unknown')).toBeInTheDocument()
    })
    expect(screen.queryByText(/different builds/)).not.toBeInTheDocument()
  })

  it('sets the document title to include the app version', () => {
    vi.stubGlobal('__APP_VERSION__', '0.11.0')
    mockApi({ version: { version: '0.11.0', commit: 'unknown' } })

    renderApp()

    expect(document.title).toBe('homeBudget v0.11.0')
  })

  it('changing the Theme select applies the chosen theme to the document', async () => {
    mockApi({ version: { version: '0.11.0', commit: 'unknown' } })

    renderApp()

    const select = screen.getByLabelText('Theme')
    expect(select).toHaveValue('auto')

    fireEvent.change(select, { target: { value: 'dark' } })

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    })

    fireEvent.change(select, { target: { value: 'light' } })

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    })
  })
})
