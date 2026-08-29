import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../services/api'
import ComparisonSparklineWidget from './ComparisonSparklineWidget.jsx'

vi.mock('../../services/api', () => ({
  api: {
    get: vi.fn(),
  },
}))

function dailyRow(date, out) {
  return { date, total_in: '0', total_out: out, count: 1 }
}

describe('ComparisonSparklineWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 6, 10)) // 10 July 2026
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('defaults to the last_month basis and fetches this month plus last month', async () => {
    api.get.mockResolvedValue({ data: [] })

    render(<ComparisonSparklineWidget config={{}} navigate={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('This month')).toBeInTheDocument())
    expect(api.get).toHaveBeenCalledWith('/reports/daily?date_from=2026-07-01&date_to=2026-07-31')
    expect(api.get).toHaveBeenCalledWith('/reports/daily?date_from=2026-06-01&date_to=2026-06-30')
    expect(screen.getByText('Last month')).toBeInTheDocument()
  })

  it('sums this month\'s spend cumulatively up to today, no further', async () => {
    api.get.mockImplementation((path) => {
      if (path.includes('2026-07')) {
        return Promise.resolve({ data: [dailyRow('2026-07-01', '10.00'), dailyRow('2026-07-05', '20.00')] })
      }
      return Promise.resolve({ data: [] })
    })

    render(<ComparisonSparklineWidget config={{}} navigate={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('This month')).toBeInTheDocument())
    // Day 5 cumulative: 10 + 20 = 30.
    expect(screen.getByText('This month — 5: 30.00')).toBeInTheDocument()
  })

  it('averages three prior months for the three_month_average basis', async () => {
    api.get.mockImplementation((path) => {
      if (path.includes('date_from=2026-04-01')) {
        return Promise.resolve({
          data: [dailyRow('2026-04-01', '10.00'), dailyRow('2026-05-01', '20.00'), dailyRow('2026-06-01', '30.00')],
        })
      }
      return Promise.resolve({ data: [] })
    })

    render(<ComparisonSparklineWidget config={{ comparisonBasis: 'three_month_average' }} navigate={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('3-month average')).toBeInTheDocument())
    expect(api.get).toHaveBeenCalledWith('/reports/daily?date_from=2026-04-01&date_to=2026-06-30')
    // Day 1 of each of the 3 prior months: (10 + 20 + 30) / 3 = 20.
    expect(screen.getByText('3-month average — 1: 20.00')).toBeInTheDocument()
  })

  it('paces a flat budget total evenly across the month for the budget basis', async () => {
    api.get.mockImplementation((path) => {
      if (path.startsWith('/budgets')) {
        return Promise.resolve({ data: { totals: { budgeted: '3100.00' } } })
      }
      return Promise.resolve({ data: [] })
    })

    render(<ComparisonSparklineWidget config={{ comparisonBasis: 'budget' }} navigate={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Budget')).toBeInTheDocument())
    expect(api.get).toHaveBeenCalledWith('/budgets?year=2026&month=7')
    // 3100 / 31 days * 1 = 100.00 on day 1.
    expect(screen.getByText('Budget — 1: 100.00')).toBeInTheDocument()
  })

  it('navigates to the ledger for the clicked day', async () => {
    api.get.mockImplementation((path) => {
      if (path.includes('2026-07')) {
        return Promise.resolve({ data: [dailyRow('2026-07-05', '20.00')] })
      }
      return Promise.resolve({ data: [] })
    })
    const navigate = vi.fn()

    render(<ComparisonSparklineWidget config={{}} navigate={navigate} />)

    await waitFor(() => expect(screen.getByText('This month')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /^This month — 5/ }))

    expect(navigate).toHaveBeenCalledWith('/transactions?date_from=2026-07-05&date_to=2026-07-05')
  })

  it('shows an error message when a request fails', async () => {
    api.get.mockRejectedValue({ response: { data: { detail: 'boom' } } })

    render(<ComparisonSparklineWidget config={{}} navigate={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument())
  })
})
