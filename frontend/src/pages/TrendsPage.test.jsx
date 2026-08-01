import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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

function renderPage() {
  return render(
    <MemoryRouter>
      <TrendsPage />
    </MemoryRouter>
  )
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
