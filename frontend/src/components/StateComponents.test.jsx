import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import EmptyState from './EmptyState.jsx'
import ErrorState from './ErrorState.jsx'
import LoadingState from './LoadingState.jsx'

describe('LoadingState', () => {
  it('renders the given message with a status role', () => {
    render(<LoadingState message="Loading transactions..." />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading transactions...')
  })

  it('renders a skeleton of that many rows when `rows` is given, keeping the message accessible', () => {
    const { container } = render(<LoadingState message="Loading transactions..." rows={4} />)

    // The message is still announced to a screen reader (role="status"
    // still carries the text) even though it's visually replaced by the
    // skeleton shape.
    expect(screen.getByRole('status')).toHaveTextContent('Loading transactions...')
    expect(container.querySelectorAll('.skeleton-row')).toHaveLength(4)
  })

  it('renders the plain message with no skeleton when rows is omitted', () => {
    const { container } = render(<LoadingState message="Loading transactions..." />)

    expect(container.querySelectorAll('.skeleton-row')).toHaveLength(0)
  })
})

describe('ErrorState', () => {
  it('renders the label and message with an alert role', () => {
    render(<ErrorState label="Failed to load accounts:" message="Network Error" />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Failed to load accounts: Network Error')
    expect(screen.getByText('Failed to load accounts:').tagName).toBe('STRONG')
  })
})

describe('EmptyState', () => {
  it('renders the message', () => {
    render(<EmptyState message="No accounts yet." />)

    expect(screen.getByText('No accounts yet.')).toBeInTheDocument()
  })

  it('renders optional follow-up children', () => {
    render(
      <EmptyState message="No transactions imported yet.">
        <a href="/transactions">Import a bank statement to get started</a>
      </EmptyState>
    )

    expect(screen.getByRole('link', { name: 'Import a bank statement to get started' })).toBeInTheDocument()
  })
})
