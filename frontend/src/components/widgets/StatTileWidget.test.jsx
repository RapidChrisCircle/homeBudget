import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import StatTileWidget from './StatTileWidget.jsx'

const kpis = {
  periods: [{ year: 2026, month: 6, label: '2026-06' }, { year: 2026, month: 7, label: '2026-07' }],
  total_income: '5000.00',
  total_expenses: '3200.00',
  net_saved: '1800.00',
  transaction_count: 42,
  avg_per_month: '1600.00',
  avg_per_transaction: '76.19',
}

describe('StatTileWidget', () => {
  it('reads the configured metric off the kpis response', () => {
    render(<StatTileWidget config={{ metric: 'total_income' }} kpis={kpis} navigate={vi.fn()} />)

    expect(screen.getByText('Total Income')).toBeInTheDocument()
    expect(screen.getByText('5000.00')).toBeInTheDocument()
  })

  it('shows the window as a period caption', () => {
    render(<StatTileWidget config={{ metric: 'total_expenses' }} kpis={kpis} navigate={vi.fn()} />)

    expect(screen.getByText('2026-06 - 2026-07')).toBeInTheDocument()
  })

  it('defaults to total_income when no metric is configured', () => {
    render(<StatTileWidget config={{}} kpis={kpis} navigate={vi.fn()} />)

    expect(screen.getByText('Total Income')).toBeInTheDocument()
  })

  it('drills a kind-backed metric into the ledger for the whole window', () => {
    const navigate = vi.fn()
    render(<StatTileWidget config={{ metric: 'total_expenses' }} kpis={kpis} navigate={navigate} />)

    fireEvent.click(screen.getByRole('button'))

    expect(navigate).toHaveBeenCalledWith('/transactions?kind=expense&date_from=2026-06-01&date_to=2026-07-31')
  })

  it('is not clickable for a metric with no real transaction kind', () => {
    render(<StatTileWidget config={{ metric: 'net_saved' }} kpis={kpis} navigate={vi.fn()} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows an em dash rather than crashing when kpis has not loaded yet', () => {
    render(<StatTileWidget config={{ metric: 'total_income' }} kpis={null} navigate={vi.fn()} />)

    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
