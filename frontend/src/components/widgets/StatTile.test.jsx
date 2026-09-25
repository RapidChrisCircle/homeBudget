import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import StatTile from './StatTile.jsx'

describe('StatTile', () => {
  it('renders the label, period and formatted value', () => {
    render(<StatTile label="Total Income" value="5000" period="Jul 2026" />)

    expect(screen.getByText('Total Income')).toBeInTheDocument()
    expect(screen.getByText('Jul 2026')).toBeInTheDocument()
    expect(screen.getByText('5000.00')).toBeInTheDocument()
  })

  it('shows an em dash rather than a formatted number when the value is null', () => {
    render(<StatTile label="Avg Per Transaction" value={null} />)

    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('colors an income tile green, an expense tile red, by class rather than the value\'s own sign', () => {
    const { rerender } = render(<StatTile label="Income" value="100" tone="income" />)
    expect(screen.getByText('100.00')).toHaveClass('stat-tile-income')

    rerender(<StatTile label="Expenses" value="100" tone="expense" />)
    expect(screen.getByText('100.00')).toHaveClass('stat-tile-expense')
  })

  it('renders as a plain, non-interactive tile when no onClick is given', () => {
    render(<StatTile label="Total Income" value="5000" />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders as a clickable button, with the given accessible label, when onClick is given', () => {
    const onClick = vi.fn()
    render(<StatTile label="Total Income" value="5000" onClick={onClick} clickLabel="View income transactions" />)

    const button = screen.getByRole('button', { name: 'View income transactions' })
    fireEvent.click(button)

    expect(onClick).toHaveBeenCalledTimes(1)
  })


  it('uses a custom formatValue when given, instead of the dollar-figure default', () => {
    render(<StatTile label="Savings Rate" value="0.36" formatValue={(v) => `${(Number(v) * 100).toFixed(1)}%`} />)

    expect(screen.getByText('36.0%')).toBeInTheDocument()
    expect(screen.queryByText('0.36')).not.toBeInTheDocument()
  })
})
