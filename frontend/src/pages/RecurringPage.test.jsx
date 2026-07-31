import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../services/api'
import RecurringPage from './RecurringPage.jsx'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

const activeSeries = {
  account_id: 1,
  account_name: 'Joint Everyday',
  narration_key: 'NETFLIX.COM',
  merchant: 'NETFLIX.COM',
  sample_narration: 'NETFLIX.COM 12345',
  cadence: 'monthly',
  interval_days: 30,
  occurrence_count: 5,
  first_date: '2026-01-15',
  last_date: '2026-05-15',
  typical_amount: '15.99',
  latest_amount: '15.99',
  amount_varies: false,
  amount_changed: false,
  next_due_date: '2026-06-15',
  status: 'due_soon',
  annual_cost: '191.88',
  category_id: null,
  category_name: null,
  dismissed: false,
  dismissal_id: null,
}

const dismissedSeries = {
  ...activeSeries,
  account_id: 2,
  narration_key: 'OLD GYM',
  merchant: 'OLD GYM',
  dismissed: true,
  dismissal_id: 42,
}

function summaryFor(series) {
  const active = series.filter((s) => !s.dismissed)
  return {
    series_count: active.length,
    total_annual_cost: active.reduce((sum, s) => sum + Number(s.annual_cost), 0).toFixed(2),
    due_soon_count: active.filter((s) => s.status === 'due_soon').length,
    due_soon_total: '0.00',
    changed_count: active.filter((s) => s.amount_changed).length,
    overdue_count: active.filter((s) => s.status === 'overdue' || s.status === 'ended').length,
  }
}

function mockLoad({ series = [activeSeries], asOf = '2026-05-15' } = {}) {
  api.get.mockImplementation((path) => {
    if (path.startsWith('/recurring')) {
      return Promise.resolve({ data: { series, summary: summaryFor(series), as_of: asOf } })
    }
    return Promise.reject(new Error(`unexpected path ${path}`))
  })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <RecurringPage />
    </MemoryRouter>
  )
}

describe('RecurringPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading then the series table once data resolves', async () => {
    mockLoad()

    renderPage()

    expect(screen.getByText('Loading recurring payments...')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('NETFLIX.COM')).toBeInTheDocument()
    })
    expect(screen.getByText('Monthly')).toBeInTheDocument()
    expect(screen.getByText('Due soon')).toBeInTheDocument()
  })

  it('shows an empty state when nothing recurs', async () => {
    mockLoad({ series: [] })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/No recurring payments detected yet/)).toBeInTheDocument()
    })
  })

  it('links to the ledger scoped to the account and merchant', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText('NETFLIX.COM')).toBeInTheDocument())

    expect(screen.getByRole('link', { name: 'View in ledger' })).toHaveAttribute(
      'href',
      '/transactions?account_id=1&search=NETFLIX.COM'
    )
  })

  it('dismisses a series and refreshes the list', async () => {
    mockLoad()
    api.post.mockResolvedValue({ data: { id: 1, account_id: 1, narration_key: 'NETFLIX.COM' } })

    renderPage()

    await waitFor(() => expect(screen.getByText('NETFLIX.COM')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/recurring/dismissals', {
        account_id: 1,
        narration_key: 'NETFLIX.COM',
      })
    })
  })

  it('shows a dismissed section that restores a series', async () => {
    mockLoad({ series: [activeSeries, dismissedSeries] })
    api.delete.mockResolvedValue({})

    renderPage()

    await waitFor(() => expect(screen.getByText('NETFLIX.COM')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Show dismissed (1)' }))
    expect(screen.getByText('OLD GYM')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/recurring/dismissals/42')
    })
  })

  it('surfaces an action error without losing the loaded list', async () => {
    mockLoad()
    api.post.mockRejectedValue({ response: { data: { detail: 'Account not found' } } })

    renderPage()

    await waitFor(() => expect(screen.getByText('NETFLIX.COM')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    await waitFor(() => {
      expect(screen.getByText(/Account not found/)).toBeInTheDocument()
    })
    expect(screen.getByText('NETFLIX.COM')).toBeInTheDocument()
  })
})
