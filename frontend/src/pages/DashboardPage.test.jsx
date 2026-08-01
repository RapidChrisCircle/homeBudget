import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../services/api'
import DashboardPage from './DashboardPage.jsx'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
  },
}))

const sampleAccounts = [
  {
    id: 1,
    name: 'Joint Everyday',
    balance: '1200.50',
    balance_as_of: '2026-07-24',
  },
  {
    id: 2,
    name: 'Credit Card',
    balance: '-300.50',
    balance_as_of: '2026-07-20',
  },
]

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
    {
      category_id: 2,
      category_name: 'Fuel',
      budget_amount: '300.00',
      actual: '150.00',
      difference: '150.00',
      transaction_count: 4,
    },
  ],
  grid: { periods: [], rows: [] },
  uncategorized: {
    transaction_count: 412,
    uncategorized_count: 17,
    total_in: '0.00',
    total_out: '-845.10',
    net_total: '-845.10',
  },
}

const sampleTransaction = {
  id: 1,
  account_id: 1,
  account_name: 'Joint Everyday',
  account_number: '1111',
  category_id: null,
  category_name: null,
  transaction_date: '2026-07-24',
  narration: 'Coffee',
  debit: '-5.00',
  credit: null,
  balance: '100.00',
  transaction_type: 'WDL',
}

function envelope(transactions, overrides = {}) {
  return {
    items: transactions,
    total: transactions.length,
    page: 1,
    page_size: 5,
    total_pages: 1,
    ...overrides,
  }
}

const emptyRecurring = {
  series: [],
  summary: {
    series_count: 0,
    total_annual_cost: '0.00',
    due_soon_count: 0,
    due_soon_total: '0.00',
    changed_count: 0,
    overdue_count: 0,
  },
  as_of: null,
}

function mockLoad({
  accounts = sampleAccounts,
  report = sampleReport,
  transactions = [sampleTransaction],
  listResponse = null,
  recurring = emptyRecurring,
} = {}) {
  const list = listResponse || envelope(transactions)

  api.get.mockImplementation((path) => {
    if (path === '/accounts') {
      return Promise.resolve({ data: accounts })
    }
    if (path.startsWith('/reports/monthly')) {
      return Promise.resolve({ data: report })
    }
    if (path === '/recurring') {
      return Promise.resolve({ data: recurring })
    }
    if (path.startsWith('/transactions')) {
      return Promise.resolve({ data: list })
    }
    return Promise.reject(new Error(`unexpected path ${path}`))
  })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  )
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading then the dashboard once data resolves', async () => {
    mockLoad()

    renderPage()

    expect(screen.getByText('Loading dashboard...')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Accounts' })).toBeInTheDocument()
    })
  })

  it('lists each account with its balance and links to its detail page', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText(/1200.50 \(as of 2026-07-24\)/)).toBeInTheDocument())

    expect(screen.getByRole('link', { name: 'Credit Card' })).toHaveAttribute('href', '/accounts/2')
  })

  it('shows a combined balance summing the account balances', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText(/Combined balance: 900.00/)).toBeInTheDocument())
  })

  it('omits accounts with no balance from the combined total', async () => {
    mockLoad({
      accounts: [sampleAccounts[0], { id: 3, name: 'New Account', balance: null, balance_as_of: null }],
    })

    renderPage()

    await waitFor(() => expect(screen.getByText(/Combined balance: 1200.50/)).toBeInTheDocument())
    expect(screen.getByText('No transactions yet')).toBeInTheDocument()
  })

  it('shows the month summary labelled with the month it covers', async () => {
    mockLoad()

    renderPage()

    // The heading must name the month, since it is the most recent month
    // WITH data, not necessarily the current calendar month.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Summary — 2026-07/ })).toBeInTheDocument()
    })

    expect(screen.getByText('5000.00')).toBeInTheDocument()
    expect(screen.getByText('1800.00')).toBeInTheDocument()
  })

  it('lists only the over-budget categories under Needs Attention', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText('Needs Attention')).toBeInTheDocument())

    expect(screen.getByText('Groceries')).toBeInTheDocument()
    // Fuel is under budget, so it must not appear.
    expect(screen.queryByText('Fuel')).not.toBeInTheDocument()
    // Shown as a positive "over by" figure rather than a negative difference.
    expect(screen.getByText('112.34')).toBeInTheDocument()
  })

  it('says nothing is over budget when every category is within its budget', async () => {
    mockLoad({ report: { ...sampleReport, budgets: [sampleReport.budgets[1]] } })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Nothing over budget this month.')).toBeInTheDocument()
    })
  })

  it('deep-links uncategorized review to the ledger filtered to this month', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText(/17 of 412 transaction\(s\)/)).toBeInTheDocument())

    // end_date (2026-08-01) is exclusive, so date_to must be 2026-07-31.
    expect(screen.getByRole('link', { name: 'Review uncategorized transactions' })).toHaveAttribute(
      'href',
      '/transactions?uncategorized=true&date_from=2026-07-01&date_to=2026-07-31'
    )
  })

  it('shows recent activity and requests only a short page of it', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    expect(api.get).toHaveBeenCalledWith('/transactions?page_size=5')
  })

  it('shows an empty state when nothing has been imported', async () => {
    mockLoad({ transactions: [], listResponse: envelope([], { total: 0 }) })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('No transactions imported yet.')).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: /Import a bank statement/ })).toBeInTheDocument()
  })

  it('shows an error message when a request fails', async () => {
    api.get.mockRejectedValue({ response: { data: { detail: 'database unavailable' } } })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/database unavailable/)).toBeInTheDocument()
    })
  })

  it('does not render the Recurring card when nothing recurs', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    expect(screen.queryByText('Recurring')).not.toBeInTheDocument()
  })

  it('lists what is due soon with a total, and links to the recurring page', async () => {
    mockLoad({
      recurring: {
        series: [
          {
            account_id: 1,
            narration_key: 'NETFLIX.COM',
            merchant: 'NETFLIX.COM',
            next_due_date: '2026-08-01',
            typical_amount: '15.99',
            status: 'due_soon',
          },
        ],
        summary: {
          series_count: 1,
          total_annual_cost: '191.88',
          due_soon_count: 1,
          due_soon_total: '15.99',
          changed_count: 0,
          overdue_count: 0,
        },
        as_of: '2026-07-24',
      },
    })

    renderPage()

    await waitFor(() => expect(screen.getByText('Recurring')).toBeInTheDocument())

    expect(screen.getByText('NETFLIX.COM')).toBeInTheDocument()
    expect(screen.getByText(/Due in the next 14 days: 15.99/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See all recurring payments' })).toHaveAttribute(
      'href',
      '/recurring'
    )
  })

  it('captions the recurring card with the data it is based on', async () => {
    // "Due in the next 14 days" is measured from the ledger's own latest
    // transaction, not today - this caption is what stops that being
    // misread once imports have fallen behind.
    mockLoad({
      recurring: {
        series: [],
        summary: {
          series_count: 1,
          total_annual_cost: '191.88',
          due_soon_count: 0,
          due_soon_total: '0.00',
          changed_count: 0,
          overdue_count: 0,
        },
        as_of: '2026-07-24',
      },
    })

    renderPage()

    await waitFor(() => expect(screen.getByText('Recurring')).toBeInTheDocument())

    expect(screen.getByText('Based on transactions imported up to 2026-07-24.')).toBeInTheDocument()
  })

  it('shows price-change and missed-payment counts', async () => {
    mockLoad({
      recurring: {
        series: [],
        summary: {
          series_count: 2,
          total_annual_cost: '400.00',
          due_soon_count: 0,
          due_soon_total: '0.00',
          changed_count: 1,
          overdue_count: 1,
        },
        as_of: '2026-07-24',
      },
    })

    renderPage()

    await waitFor(() => expect(screen.getByText('Recurring')).toBeInTheDocument())

    expect(screen.getByText(/1 price change\(s\)/)).toBeInTheDocument()
    expect(screen.getByText(/1 missed or stopped/)).toBeInTheDocument()
    expect(screen.getByText('Nothing due in the next 14 days.')).toBeInTheDocument()
  })
})
