import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../services/api'
import TransactionCalendarWidget from './TransactionCalendarWidget.jsx'

vi.mock('../../services/api', () => ({
  api: {
    get: vi.fn(),
  },
}))

describe('TransactionCalendarWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Only Date is faked - testing-library's own waitFor relies on REAL
    // timers to poll, so faking setTimeout/setInterval too would hang
    // every assertion below.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 6, 15)) // 15 July 2026 (JS months are 0-based)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches the current month by default and renders it', async () => {
    api.get.mockResolvedValue({ data: [{ date: '2026-07-05', total_in: '0', total_out: '40.00', count: 1 }] })

    render(<TransactionCalendarWidget config={{}} navigate={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('July 2026')).toBeInTheDocument())
    expect(api.get).toHaveBeenCalledWith('/reports/daily?date_from=2026-07-01&date_to=2026-07-31')
  })

  it('renders one calendar per month when config.months asks for several', async () => {
    api.get.mockResolvedValue({ data: [] })

    render(<TransactionCalendarWidget config={{ months: 3 }} navigate={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('July 2026')).toBeInTheDocument())
    expect(screen.getByText('May 2026')).toBeInTheDocument()
    expect(screen.getByText('June 2026')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/reports/daily?date_from=2026-05-01&date_to=2026-07-31')
  })

  it('splits the single fetch response back out by month', async () => {
    api.get.mockResolvedValue({
      data: [
        { date: '2026-06-10', total_in: '0', total_out: '20.00', count: 1 },
        { date: '2026-07-05', total_in: '0', total_out: '40.00', count: 1 },
      ],
    })

    render(<TransactionCalendarWidget config={{ months: 2 }} navigate={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('June 2026')).toBeInTheDocument())
    // Each month's own total (↓) only counts that month's own day(s).
    expect(screen.getByText('↓ 20.00')).toBeInTheDocument()
    expect(screen.getByText('↓ 40.00')).toBeInTheDocument()
  })

  it('navigates to the ledger for the clicked day', async () => {
    api.get.mockResolvedValue({ data: [{ date: '2026-07-05', total_in: '0', total_out: '40.00', count: 1 }] })
    const navigate = vi.fn()

    render(<TransactionCalendarWidget config={{}} navigate={navigate} />)

    await waitFor(() => expect(screen.getByText('July 2026')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /2026-07-05/ }))

    expect(navigate).toHaveBeenCalledWith('/transactions?date_from=2026-07-05&date_to=2026-07-05')
  })

  it('shows an error message when the request fails', async () => {
    api.get.mockRejectedValue({ response: { data: { detail: 'boom' } } })

    render(<TransactionCalendarWidget config={{}} navigate={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument())
  })
})
