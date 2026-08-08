import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../services/api'
import TrendsPage from './TrendsPage.jsx'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
  },
}))

const periods = [
  { year: 2026, month: 5, label: '2026-05' },
  { year: 2026, month: 6, label: '2026-06' },
  { year: 2026, month: 7, label: '2026-07' },
]

const categories = [
  {
    category_id: 1,
    category_name: 'Groceries',
    kind: 'expense',
    amounts: { '2026-05': '100.00', '2026-06': '120.00', '2026-07': '90.00' },
    total: '310.00',
  },
  {
    category_id: 2,
    category_name: 'Fuel',
    kind: 'expense',
    amounts: { '2026-05': '50.00', '2026-06': '55.00', '2026-07': '60.00' },
    total: '165.00',
  },
  {
    category_id: 3,
    category_name: 'Salary',
    kind: 'income',
    amounts: { '2026-05': '5000.00', '2026-06': '5000.00', '2026-07': '5000.00' },
    total: '15000.00',
  },
]

const monthly = [
  { label: '2026-05', total_income: '5000.00', total_spending: '100.00', net_saved: '4900.00' },
  { label: '2026-06', total_income: '5000.00', total_spending: '120.00', net_saved: '4880.00' },
  { label: '2026-07', total_income: '5000.00', total_spending: '90.00', net_saved: '4910.00' },
]

const budget = [
  { label: '2026-05', budgeted: '150.00', actual: '100.00' },
  { label: '2026-06', budgeted: '150.00', actual: '120.00' },
  { label: '2026-07', budgeted: '150.00', actual: '90.00' },
]

function mockLoad(overrides = {}) {
  api.get.mockResolvedValue({
    data: { periods, categories, monthly, budget, ...overrides },
  })
}

function renderPage(initialEntry = '/trends') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/trends" element={<TrendsPage />} />
        {/* Drill-down leaves the page - these stand in for the two
            destinations so a test can assert where a click LANDED, not
            just that navigate() was called with some string. */}
        <Route path="/reports" element={<LocationProbe label="reports" />} />
        <Route path="/transactions" element={<LocationProbe label="ledger" />} />
      </Routes>
    </MemoryRouter>
  )
}

function LocationProbe({ label }) {
  const location = useLocation()

  return <div>{`${label}${location.search}`}</div>
}

describe('TrendsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading then all three charts once data resolves', async () => {
    mockLoad()

    renderPage()

    expect(screen.getByText('Loading trends...')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Spending by Category Over Time')).toBeInTheDocument()
    })
    expect(screen.getByText('Income vs Spending vs Net')).toBeInTheDocument()
    expect(screen.getByText('Budget vs Actual')).toBeInTheDocument()
    expect(screen.getByText('Groceries')).toBeInTheDocument()
    expect(screen.getByText('Income')).toBeInTheDocument()
    expect(screen.getByText('Budgeted')).toBeInTheDocument()
  })

  it('fetches with the default months on mount', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/trends?months=6'))
  })

  it('updates the URL and refetches when the months selector changes', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText('Spending by Category Over Time')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Months'), { target: { value: '12' } })

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/trends?months=12')
    })
  })

  it('shows an empty state when there is no history yet', async () => {
    mockLoad({
      categories: [],
      monthly: monthly.map((m) => ({ ...m, total_income: '0.00', total_spending: '0.00', net_saved: '0.00' })),
      budget: budget.map((b) => ({ ...b, budgeted: '0.00', actual: '0.00' })),
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/Not enough history yet/)).toBeInTheDocument()
    })
  })

  it('shows the empty state on a fresh ledger even when a budgeted-but-idle category is present', async () => {
    // category_grid() outer-joins so a budgeted category with zero activity
    // anywhere in the window still appears - `categories` is non-empty here
    // even though nothing has ever been imported. hasHistory must not be
    // fooled by that; it needs the actual monthly activity to be zero too.
    mockLoad({
      categories: [
        {
          category_id: 99,
          category_name: 'Rent',
          kind: 'expense',
          amounts: { '2026-05': '0.00', '2026-06': '0.00', '2026-07': '0.00' },
          total: '0.00',
        },
      ],
      monthly: monthly.map((m) => ({ ...m, total_income: '0.00', total_spending: '0.00', net_saved: '0.00' })),
      budget: budget.map((b) => ({ ...b, budgeted: '1500.00', actual: '0.00' })),
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/Not enough history yet/)).toBeInTheDocument()
    })
    expect(screen.queryByText('Spending by Category Over Time')).not.toBeInTheDocument()
  })

  it('shows a message instead of a chart when no category has a budget', async () => {
    mockLoad({ budget: budget.map((b) => ({ ...b, budgeted: '0.00' })) })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('No categories have a budget set yet.')).toBeInTheDocument()
    })
  })

  it('sums categories beyond the top limit into an "Other" line', async () => {
    const manyCategories = [
      ...Array.from({ length: 7 }, (_, i) => ({
        category_id: i + 10,
        category_name: `Category ${i}`,
        kind: 'expense',
        amounts: { '2026-05': '100.00', '2026-06': '100.00', '2026-07': '100.00' },
        total: String(700 - i * 10),
      })),
    ]
    mockLoad({ categories: manyCategories })

    renderPage()

    await waitFor(() => expect(screen.getByText('Spending by Category Over Time')).toBeInTheDocument())

    expect(screen.getByText('Other')).toBeInTheDocument()
  })

  it('shows an error message when the request fails', async () => {
    api.get.mockRejectedValue({ response: { data: { detail: 'database unavailable' } } })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/database unavailable/)).toBeInTheDocument()
    })
  })
})

const groupedCategories = [
  {
    category_id: 1,
    category_name: 'Groceries',
    parent_id: 10,
    parent_name: 'Food',
    kind: 'expense',
    amounts: { '2026-05': '100.00', '2026-06': '120.00', '2026-07': '90.00' },
    total: '310.00',
  },
  {
    category_id: 2,
    category_name: 'Takeaway',
    parent_id: 10,
    parent_name: 'Food',
    kind: 'expense',
    amounts: { '2026-05': '40.00', '2026-06': '30.00', '2026-07': '20.00' },
    total: '90.00',
  },
  {
    category_id: 3,
    category_name: 'Rent',
    parent_id: null,
    parent_name: null,
    kind: 'expense',
    amounts: { '2026-05': '500.00', '2026-06': '500.00', '2026-07': '500.00' },
    total: '1500.00',
  },
]

describe('TrendsPage drill-down', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('charts groups rather than their children, until one is drilled into', async () => {
    mockLoad({ categories: groupedCategories })

    renderPage()

    await waitFor(() => expect(screen.getByText('Spending by Category Over Time')).toBeInTheDocument())

    expect(screen.getByRole('button', { name: 'Food' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Groceries' })).not.toBeInTheDocument()
  })

  it('sums a group\'s children into the group\'s own line', async () => {
    mockLoad({ categories: groupedCategories })

    renderPage()

    await waitFor(() => expect(screen.getByText('Spending by Category Over Time')).toBeInTheDocument())

    // 100.00 groceries + 40.00 takeaway for 2026-05.
    expect(screen.getByRole('button', { name: 'Food — 2026-05: 140.00' })).toBeInTheDocument()
  })

  it('drills into a group from its legend entry, and back out again', async () => {
    mockLoad({ categories: groupedCategories })

    renderPage()

    await waitFor(() => expect(screen.getByText('Spending by Category Over Time')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Food' }))

    await waitFor(() => expect(screen.getByText('Spending in Food Over Time')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Groceries' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Takeaway' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back to all categories' }))

    await waitFor(() => expect(screen.getByText('Spending by Category Over Time')).toBeInTheDocument())
  })

  it('drills into a group by clicking one of its points too', async () => {
    mockLoad({ categories: groupedCategories })

    renderPage()

    await waitFor(() => expect(screen.getByText('Spending by Category Over Time')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Food — 2026-06: 150.00' }))

    await waitFor(() => expect(screen.getByText('Spending in Food Over Time')).toBeInTheDocument())
  })

  it('starts drilled in when the URL says so, and survives a reload that way', async () => {
    mockLoad({ categories: groupedCategories })

    renderPage('/trends?group=10')

    await waitFor(() => expect(screen.getByText('Spending in Food Over Time')).toBeInTheDocument())
  })

  it('falls back to the top level for a group with nothing in this window', async () => {
    mockLoad({ categories: groupedCategories })

    renderPage('/trends?group=999')

    await waitFor(() => expect(screen.getByText('Spending by Category Over Time')).toBeInTheDocument())
  })

  it('opens the filtered ledger from a leaf category point', async () => {
    mockLoad({ categories: groupedCategories })

    renderPage()

    await waitFor(() => expect(screen.getByText('Spending by Category Over Time')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Rent — 2026-07: 500.00' }))

    await waitFor(() => {
      expect(screen.getByText('ledger?category_id=3&date_from=2026-07-01&date_to=2026-07-31')).toBeInTheDocument()
    })
  })

  it('opens a leaf category\'s own month once drilled into its group', async () => {
    mockLoad({ categories: groupedCategories })

    renderPage('/trends?group=10')

    await waitFor(() => expect(screen.getByText('Spending in Food Over Time')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Groceries — 2026-05: 100.00' }))

    await waitFor(() => {
      expect(screen.getByText('ledger?category_id=1&date_from=2026-05-01&date_to=2026-05-31')).toBeInTheDocument()
    })
  })

  it('opens that month\'s report from the income-vs-spending chart', async () => {
    mockLoad({ categories: groupedCategories })

    renderPage()

    await waitFor(() => expect(screen.getByText('Income vs Spending vs Net')).toBeInTheDocument())

    fireEvent.click(screen.getAllByRole('button', { name: /^2026-06 — Income/ })[0])

    await waitFor(() => expect(screen.getByText('reports?year=2026&month=6')).toBeInTheDocument())
  })

  it('opens that month\'s report from the budget-vs-actual chart', async () => {
    mockLoad({ categories: groupedCategories })

    renderPage()

    await waitFor(() => expect(screen.getByText('Budget vs Actual')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /^2026-07 — Budgeted/ }))

    await waitFor(() => expect(screen.getByText('reports?year=2026&month=7')).toBeInTheDocument())
  })

  it('drops the drilled-in group when the window changes', async () => {
    mockLoad({ categories: groupedCategories })

    renderPage('/trends?group=10')

    await waitFor(() => expect(screen.getByText('Spending in Food Over Time')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Months'), { target: { value: '12' } })

    await waitFor(() => expect(screen.getByText('Spending by Category Over Time')).toBeInTheDocument())
  })
})
