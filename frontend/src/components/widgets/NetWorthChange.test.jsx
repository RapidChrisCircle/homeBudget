import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import NetWorthChange from './NetWorthChange.jsx'

describe('NetWorthChange', () => {
  it('computes the change between the first and last KNOWN balances, skipping nulls', () => {
    render(
      <NetWorthChange
        balances={[
          { label: '2026-01', balance: null },
          { label: '2026-02', balance: '40000.00' },
          { label: '2026-03', balance: '41900.00' },
        ]}
        windowLabel="Jan - Mar 2026"
      />
    )

    expect(screen.getByText('1900.00')).toBeInTheDocument()
  })

  it('colors a positive change green (income tone) and a negative change red (expense tone)', () => {
    const { rerender } = render(
      <NetWorthChange balances={[{ label: 'a', balance: '100' }, { label: 'b', balance: '200' }]} windowLabel="w" />
    )
    expect(screen.getByText('100.00')).toHaveClass('stat-tile-income')

    rerender(
      <NetWorthChange balances={[{ label: 'a', balance: '200' }, { label: 'b', balance: '100' }]} windowLabel="w" />
    )
    expect(screen.getByText('-100.00')).toHaveClass('stat-tile-expense')
  })

  it('shows an em dash when there is fewer than two known balances', () => {
    render(<NetWorthChange balances={[{ label: 'a', balance: null }]} windowLabel="w" />)

    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('is clickable when onClick is given', () => {
    const onClick = vi.fn()
    render(
      <NetWorthChange
        balances={[{ label: 'a', balance: '100' }, { label: 'b', balance: '200' }]}
        windowLabel="Jul 2026"
        onClick={onClick}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'View transactions for Jul 2026' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
