import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../services/api'
import ReportsPage from './ReportsPage.jsx'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
  },
}))

const sampleReport = {
  year: 2026,
  month: 7,
  label: '2026-07',
  start_date: '2026-07-01',
  end_date: '2026-08-01',
  summary: { total_income: '5000.00', total_spending: '3200.00', net_saved: '1800.00' },
  budgets: [
    {
      category_id: 1,
      category_name: 'Groceries',
      budget_amount: '800.00',
      actual: '912.34',
      difference: '-112.34',
      transaction_count: 21,
    },
  ],
  grid: {
    periods: [
      { year: 2026, month: 6, label: '2026-06' },
      { year: 2026, month: 7, label: '2026-07' },
    ],
    rows: [
      {
        category_id: 1,
        category_name: 'Groceries',
        kind: 'expense',
        amounts: { '2026-06': '780.00', '2026-07': '912.34' },
        total: '1692.34',
      },
    ],
  },
  uncategorized: {
    transaction_count: 412,
    uncategorized_count: 17,
    total_in: '0.00',
    total_out: '-845.10',
    net_total: '-845.10',
  },
}

const samplePeriods = [
  { year: 2026, month: 7, label: '2026-07', transaction_count: 40 },
  { year: 2026, month: 6, label: '2026-06', transaction_count: 35 },
]

function mockLoad(report = sampleReport, periods = samplePeriods) {
  api.get.mockImplementation((path) => {
    if (path.startsWith('/reports/monthly')) {
      return Promise.resolve({ data: report })
    }
    if (path === '/reports/periods') {
      return Promise.resolve({ data: periods })
    }
    return Promise.reject(new Error(`unexpected path ${path}`))
  })
}

function renderPage(initialEntry = '/reports') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ReportsPage />
    </MemoryRouter>
  )
}

describe('ReportsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading then the report once data resolves', async () => {
    mockLoad()

    renderPage()

    expect(screen.getByText('Loading report...')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(/Monthly Summary/)).toBeInTheDocument()
    })
  })

  it('shows the summary totals', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText('5000.00')).toBeInTheDocument())
    expect(screen.getByText('3200.00')).toBeInTheDocument()
    expect(screen.getByText('1800.00')).toBeInTheDocument()
  })

  it('renders a budget row with its difference', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText(/-112.34/)).toBeInTheDocument())
    expect(screen.getAllByText('912.34').length).toBeGreaterThan(0)
  })

  it('renders the grid with one column per month', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText('Category Totals Over Time')).toBeInTheDocument())
    expect(screen.getByText('2026-06')).toBeInTheDocument()
    expect(screen.getByText('2026-07')).toBeInTheDocument()
    expect(screen.getByText('780.00')).toBeInTheDocument()
  })

  it('shows the uncategorized count and total', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/17 of 412 transaction\(s\)/)).toBeInTheDocument()
    })
    expect(screen.getByText(/-845.10/)).toBeInTheDocument()
  })

  it('re-fetches when the month is changed', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText(/-112.34/)).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Select month'), { target: { value: '2026-6' } })

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/reports/monthly?year=2026&month=6')
    })
  })

  it('shows a message when there are no transactions', async () => {
    mockLoad(sampleReport, [])

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('No transactions imported yet.')).toBeInTheDocument()
    })
  })

  it('links "review uncategorized" to the ledger filtered to this month, uncategorized only', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText(/17 of 412 transaction\(s\)/)).toBeInTheDocument())

    const link = screen.getByRole('link', { name: 'Review uncategorized transactions' })
    // end_date (2026-08-01) is exclusive, so the deep link's date_to must be
    // the last actual day of the month (2026-07-31), not the end_date itself.
    expect(link).toHaveAttribute(
      'href',
      '/transactions?uncategorized=true&date_from=2026-07-01&date_to=2026-07-31'
    )
  })

  it('marks a negative spent figure as a net refund', async () => {
    const refundReport = {
      ...sampleReport,
      budgets: [
        { ...sampleReport.budgets[0], actual: '-30.00', difference: '130.00' },
      ],
    }
    mockLoad(refundReport)

    renderPage()

    await waitFor(() => {
      expect(screen.getByTitle('Net refund — refunds exceeded spending this month')).toBeInTheDocument()
    })
  })

  // --- Sorting --------------------------------------------------------------

  it('sorts Budget vs Actual by Category', async () => {
    const report = {
      ...sampleReport,
      budgets: [
        { category_id: 1, category_name: 'Zebra', budget_amount: '10.00', actual: '5.00', difference: '5.00' },
        { category_id: 2, category_name: 'Apple', budget_amount: '20.00', actual: '15.00', difference: '5.00' },
      ],
    }
    mockLoad(report)

    renderPage()

    await waitFor(() => expect(screen.getByText('Zebra')).toBeInTheDocument())

    const card = screen.getByText('Budget vs Actual').closest('.card')
    fireEvent.click(within(card).getByRole('button', { name: 'Category' }))

    const rows = card.querySelectorAll('tbody tr')
    expect(within(rows[0]).getByText('Apple')).toBeInTheDocument()
  })

  it('sorts Category Totals Over Time by Total, without disturbing the per-period columns', async () => {
    const report = {
      ...sampleReport,
      grid: {
        periods: sampleReport.grid.periods,
        rows: [
          { category_id: 1, category_name: 'Zebra', kind: 'expense', amounts: { '2026-06': '5.00', '2026-07': '5.00' }, total: '10.00' },
          { category_id: 2, category_name: 'Apple', kind: 'expense', amounts: { '2026-06': '1.00', '2026-07': '1.00' }, total: '2.00' },
        ],
      },
    }
    mockLoad(report)

    renderPage()

    await waitFor(() => expect(screen.getByText('Category Totals Over Time')).toBeInTheDocument())

    const card = screen.getByText('Category Totals Over Time').closest('.card')
    fireEvent.click(within(card).getByRole('button', { name: 'Total' }))

    const rows = card.querySelectorAll('tbody tr')
    expect(within(rows[0]).getByText('Apple')).toBeInTheDocument() // 2.00 < 10.00 ascending
    // The period columns themselves are unaffected - not sortable, and
    // Apple's own June/July figures still show against its own row.
    expect(within(rows[0]).getAllByText('1.00')).toHaveLength(2)
  })
})

describe('ReportsPage month in the URL', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads the backend default period when the URL names no month', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/reports/monthly'))
  })

  it('loads the month the URL names - this is what /trends drills into', async () => {
    mockLoad()

    renderPage('/reports?year=2026&month=6')

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/reports/monthly?year=2026&month=6'))
  })

  it('puts a month picked from the selector into the URL, so the view is shareable', async () => {
    mockLoad()

    renderPage()
    await waitFor(() => expect(screen.getByLabelText('Select month')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Select month'), { target: { value: '2026-6' } })

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/reports/monthly?year=2026&month=6'))
  })
})
