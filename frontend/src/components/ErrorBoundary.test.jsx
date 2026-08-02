import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ErrorBoundary from './ErrorBoundary.jsx'

function Bomb() {
  throw new Error('kaboom')
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React logs the caught error to the console by default in test envs;
    // componentDidCatch also logs deliberately (see the component) - both
    // are expected noise for these tests, not a real failure.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders children normally when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>all good</p>
      </ErrorBoundary>
    )

    expect(screen.getByText('all good')).toBeInTheDocument()
  })

  it('catches a render error and shows a fallback with a reload action', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText(/kaboom/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument()
  })

  it('recovers once remounted with a new key and non-throwing children - the mechanism App.jsx relies on for "navigate away recovers"', () => {
    const { rerender } = render(
      <ErrorBoundary key="a">
        <Bomb />
      </ErrorBoundary>
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()

    // App.jsx keys ErrorBoundary on the route pathname - a different key
    // here stands in for "the user navigated to a different page", which
    // remounts the boundary and clears its tripped state.
    rerender(
      <ErrorBoundary key="b">
        <p>a different, working page</p>
      </ErrorBoundary>
    )

    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
    expect(screen.getByText('a different, working page')).toBeInTheDocument()
  })
})
