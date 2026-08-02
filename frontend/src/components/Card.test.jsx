import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import Card from './Card.jsx'

function renderCard(props = {}) {
  return render(
    <Card id="test-card" title="Accounts" {...props}>
      <p>card body content</p>
    </Card>
  )
}

describe('Card', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders open by default, with its content visible', () => {
    renderCard()

    expect(screen.getByText('card body content')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accounts' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('the heading is still reachable by role and name, same as a plain heading', () => {
    renderCard()

    expect(screen.getByRole('heading', { name: 'Accounts' })).toBeInTheDocument()
  })

  it('collapses and unmounts its content when toggled, and restores it when toggled again', () => {
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Accounts' }))

    expect(screen.queryByText('card body content')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accounts' })).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Accounts' }))

    expect(screen.getByText('card body content')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accounts' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('honours defaultOpen=false when nothing is persisted yet', () => {
    renderCard({ defaultOpen: false })

    expect(screen.queryByText('card body content')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accounts' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('persists a collapsed state across remounts under the same id', () => {
    const { unmount } = renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Accounts' }))
    unmount()

    renderCard()

    expect(screen.queryByText('card body content')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accounts' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('does not confuse two different cards persisted under different ids', () => {
    const first = renderCard({ id: 'card-a' })
    fireEvent.click(screen.getByRole('button', { name: 'Accounts' }))
    first.unmount()

    render(
      <Card id="card-b" title="Accounts">
        <p>card body content</p>
      </Card>
    )

    // A fresh id with nothing persisted falls back to defaultOpen (true).
    expect(screen.getByText('card body content')).toBeInTheDocument()
  })
})
