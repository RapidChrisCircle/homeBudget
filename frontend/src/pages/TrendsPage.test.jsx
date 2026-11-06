import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../services/api'
import { lastCompletedMonth } from '../utils/trendsSeries.js'
import TrendsPage from './TrendsPage.jsx'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
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
    expect(screen.getAllByText('Groceries').length).toBeGreaterThan(0)
    expect(screen.getByText('Income')).toBeInTheDocument()
    expect(screen.getByText('Budgeted')).toBeInTheDocument()
  })

  it('fetches with the default months on mount', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/trends?months=6&exclude_savings_spend=true'))
  })

  it('updates the URL and refetches when the months selector changes', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText('Spending by Category Over Time')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Months'), { target: { value: '12' } })

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/trends?months=12&exclude_savings_spend=true')
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
    transaction_count: 5,
    first_date: '2026-05-04',
    last_date: '2026-07-22',
    average_spend: '62.00',
  },
  {
    category_id: 2,
    category_name: 'Takeaway',
    parent_id: 10,
    parent_name: 'Food',
    kind: 'expense',
    amounts: { '2026-05': '40.00', '2026-06': '30.00', '2026-07': '20.00' },
    total: '90.00',
    transaction_count: 3,
    first_date: '2026-05-10',
    last_date: '2026-07-19',
    average_spend: '30.00',
  },
  {
    category_id: 3,
    category_name: 'Rent',
    parent_id: null,
    parent_name: null,
    kind: 'expense',
    amounts: { '2026-05': '500.00', '2026-06': '500.00', '2026-07': '500.00' },
    total: '1500.00',
    transaction_count: 3,
    first_date: '2026-05-01',
    last_date: '2026-07-01',
    average_spend: '500.00',
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

  it('opens the ledger filtered to kind=income from the Income bar', async () => {
    mockLoad({ categories: groupedCategories })

    renderPage()

    await waitFor(() => expect(screen.getByText('Income vs Spending vs Net')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Income — 2026-06: 5000.00' }))

    await waitFor(() => {
      expect(screen.getByText('ledger?kind=income&date_from=2026-06-01&date_to=2026-06-30')).toBeInTheDocument()
    })
  })

  it('opens the ledger filtered to kind=expense from the Spending bar', async () => {
    mockLoad({ categories: groupedCategories })

    renderPage()

    await waitFor(() => expect(screen.getByText('Income vs Spending vs Net')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Spending — 2026-07: 90.00' }))

    await waitFor(() => {
      expect(screen.getByText('ledger?kind=expense&date_from=2026-07-01&date_to=2026-07-31')).toBeInTheDocument()
    })
  })

  it('offers no drill-down on the Net saved bar - a difference, not a transaction kind', async () => {
    mockLoad({ categories: groupedCategories })

    renderPage()

    await waitFor(() => expect(screen.getByText('Income vs Spending vs Net')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: /^Net saved — / })).not.toBeInTheDocument()
  })

  it('opens the ledger filtered to kind=expense from the budget-vs-actual chart\'s Actual bar', async () => {
    mockLoad({ categories: groupedCategories })

    renderPage()

    await waitFor(() => expect(screen.getByText('Budget vs Actual')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Actual — 2026-07: 90.00' }))

    await waitFor(() => {
      expect(screen.getByText('ledger?kind=expense&date_from=2026-07-01&date_to=2026-07-31')).toBeInTheDocument()
    })
  })

  it('offers no drill-down on the Budgeted bar - a projection, not real transactions', async () => {
    mockLoad({ categories: groupedCategories })

    renderPage()

    await waitFor(() => expect(screen.getByText('Budget vs Actual')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: /^Budgeted — / })).not.toBeInTheDocument()
  })

  it('drops the drilled-in group when the window changes', async () => {
    mockLoad({ categories: groupedCategories })

    renderPage('/trends?group=10')

    await waitFor(() => expect(screen.getByText('Spending in Food Over Time')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Months'), { target: { value: '12' } })

    await waitFor(() => expect(screen.getByText('Spending by Category Over Time')).toBeInTheDocument())
  })

  it('drills into a sub-category from the legend to show its merchants and supports sorting by total spent or merchant', async () => {
    api.get.mockImplementation((url) => {
      if (url.startsWith('/trends/merchants')) {
        return Promise.resolve({
          data: {
            category_id: 2,
            category_name: 'Takeaway',
            parent_id: 10,
            parent_name: 'Food',
            total_spent: '90.00',
            merchants: [
              {
                narration_key: 'BISTRO',
                merchant: 'BISTRO LA VUE',
                nickname: null,
                sample_narration: 'BISTRO LA VUE',
                transaction_count: 1,
                total_spent: '55.00',
                average_spend: '55.00',
                first_date: '2026-06-14',
                last_date: '2026-06-14',
                transaction_ids: [101],
              },
              {
                narration_key: 'ALPHA CAFE',
                merchant: 'ALPHA CAFE',
                nickname: null,
                sample_narration: 'ALPHA CAFE',
                transaction_count: 2,
                total_spent: '35.00',
                average_spend: '17.50',
                first_date: '2026-05-03',
                last_date: '2026-07-19',
                transaction_ids: [102, 103],
              },
            ],
          },
        })
      }
      return Promise.resolve({
        data: { periods, categories: groupedCategories, monthly, budget },
      })
    })

    renderPage()

    await waitFor(() => expect(screen.getByText('Spending by Category Over Time')).toBeInTheDocument())

    // Step 1: Click group "Food" in legend
    fireEvent.click(screen.getByRole('button', { name: 'Food' }))
    await waitFor(() => expect(screen.getByText('Spending in Food Over Time')).toBeInTheDocument())

    // Step 2: Click sub-category "Takeaway" in legend
    fireEvent.click(screen.getByRole('button', { name: 'Takeaway' }))

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/trends/merchants?category_id=2&months=6&exclude_savings_spend=true')
      expect(screen.getByText(/Merchants in Takeaway/)).toBeInTheDocument()
    })

    // Default sort is Total Spent descending: BISTRO LA VUE (55.00) before ALPHA CAFE (35.00)
    const merchantsTable = screen.getByRole('table', { name: 'Merchants in Takeaway' })
    const getMerchantOrder = () =>
      within(merchantsTable)
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.querySelector('td')?.textContent)

    expect(getMerchantOrder()).toEqual(['BISTRO LA VUE', 'ALPHA CAFE'])

    // Click Total Spent header (desc -> unsorted -> asc) to sort ascending (35.00 before 55.00)
    fireEvent.click(within(merchantsTable).getByRole('button', { name: /Total Spent/ }))
    fireEvent.click(within(merchantsTable).getByRole('button', { name: /Total Spent/ }))
    expect(getMerchantOrder()).toEqual(['ALPHA CAFE', 'BISTRO LA VUE'])

    // Click Merchant header to sort alphabetically ascending, then descending
    fireEvent.click(within(merchantsTable).getByRole('button', { name: /Merchant/ }))
    expect(getMerchantOrder()).toEqual(['ALPHA CAFE', 'BISTRO LA VUE'])
    fireEvent.click(within(merchantsTable).getByRole('button', { name: /Merchant/ }))
    expect(getMerchantOrder()).toEqual(['BISTRO LA VUE', 'ALPHA CAFE'])

    // Average Spend column is displayed and sortable
    expect(within(merchantsTable).getByText('17.50')).toBeInTheDocument()
    fireEvent.click(within(merchantsTable).getByRole('button', { name: /Average Spend/ }))
    expect(getMerchantOrder()).toEqual(['ALPHA CAFE', 'BISTRO LA VUE'])

    // Give ALPHA CAFE a nickname
    api.put.mockResolvedValue({
      data: { narration_key: 'ALPHA CAFE', nickname: 'Morning Coffee' },
    })
    fireEvent.click(within(merchantsTable).getByRole('button', { name: 'Nickname ALPHA CAFE' }))
    fireEvent.change(within(merchantsTable).getByLabelText('Nickname for ALPHA CAFE'), {
      target: { value: 'Morning Coffee' },
    })
    fireEvent.click(within(merchantsTable).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/trends/merchants/nickname', {
        narration_key: 'ALPHA CAFE',
        nickname: 'Morning Coffee',
      })
      expect(within(merchantsTable).getByText(/Morning Coffee/)).toBeInTheDocument()
    })

    // Clicking "View in ledger" opens the merchant's transactions in /transactions
    const viewLinks = within(merchantsTable).getAllByRole('link', { name: 'View in ledger' })
    fireEvent.click(viewLinks[0])
    await waitFor(() => {
      expect(screen.getByText('ledger?transaction_ids=102&transaction_ids=103')).toBeInTheDocument()
    })
  })

  it('renders the category table and sub-category table with transactions, date range, average spend, total spent, and sorting on each column', async () => {
    mockLoad({ categories: groupedCategories })

    renderPage()

    await waitFor(() => expect(screen.getByText('Spending by Category Over Time')).toBeInTheDocument())

    const categoryTable = screen.getByRole('table', { name: 'Spending by category' })
    const getCategoryOrder = () =>
      within(categoryTable)
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.querySelector('td')?.textContent)

    // Default sort is Total Spent descending: Rent (1500.00) before Food (400.00)
    expect(getCategoryOrder()).toEqual(['Rent', 'Food'])
    expect(within(categoryTable).getByText('50.00')).toBeInTheDocument() // Food average spend: 400 / 8

    // Sort by Category (asc -> Food, Rent)
    fireEvent.click(within(categoryTable).getByRole('button', { name: /^Category/ }))
    expect(getCategoryOrder()).toEqual(['Food', 'Rent'])

    // Sort by Transactions (asc -> Rent(3), Food(8))
    fireEvent.click(within(categoryTable).getByRole('button', { name: /Transactions/ }))
    expect(getCategoryOrder()).toEqual(['Rent', 'Food'])

    // Sort by Date Range (asc -> Rent(2026-05-01), Food(2026-05-04))
    fireEvent.click(within(categoryTable).getByRole('button', { name: /Date Range/ }))
    expect(getCategoryOrder()).toEqual(['Rent', 'Food'])

    // Sort by Average Spend (asc -> Food(50.00), Rent(500.00))
    fireEvent.click(within(categoryTable).getByRole('button', { name: /Average Spend/ }))
    expect(getCategoryOrder()).toEqual(['Food', 'Rent'])

    // Drill into Food sub-categories directly from the table button
    fireEvent.click(within(categoryTable).getByRole('button', { name: 'Sub-categories in Food' }))

    await waitFor(() => expect(screen.getByText('Spending in Food Over Time')).toBeInTheDocument())

    const subCategoryTable = screen.getByRole('table', { name: 'Sub-categories in Food' })
    const getSubCategoryOrder = () =>
      within(subCategoryTable)
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.querySelector('td')?.textContent)

    // Sub-category table inherits current sort (Average Spend asc: Takeaway(30.00), Groceries(62.00))
    expect(getSubCategoryOrder()).toEqual(['Takeaway', 'Groceries'])

    // Sort by Total Spent desc (asc first, then desc -> Groceries(310.00), Takeaway(90.00))
    fireEvent.click(within(subCategoryTable).getByRole('button', { name: /Total Spent/ }))
    fireEvent.click(within(subCategoryTable).getByRole('button', { name: /Total Spent/ }))
    expect(getSubCategoryOrder()).toEqual(['Groceries', 'Takeaway'])
  })

  it('switches the Average Spend column between per-transaction and per-month, and sorts by the active basis', async () => {
    // Food: 400 total / 8 tx = 50.00 per tx, 400 / 3 months = 133.33 per month.
    // Rent: 1500 / 3 tx = 500.00 per tx, 1500 / 3 months = 500.00 per month.
    // Make a third row where the two bases disagree on order.
    const categoriesWithCoffee = [
      ...groupedCategories,
      {
        category_id: 4,
        category_name: 'Coffee',
        parent_id: null,
        parent_name: null,
        kind: 'expense',
        amounts: { '2026-05': '60.00', '2026-06': '60.00', '2026-07': '60.00' },
        total: '180.00',
        transaction_count: 1,
        first_date: '2026-05-02',
        last_date: '2026-07-02',
        average_spend: '180.00',
      },
    ]
    mockLoad({ categories: categoriesWithCoffee })

    renderPage()

    await waitFor(() => expect(screen.getByText('Spending by Category Over Time')).toBeInTheDocument())

    const categoryTable = screen.getByRole('table', { name: 'Spending by category' })
    const getOrder = () =>
      within(categoryTable)
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.querySelector('td')?.textContent)

    // Per transaction (default): Food 50, Coffee 180, Rent 500.
    expect(within(categoryTable).getByRole('button', { name: /Average Spend \(per transaction\)/ })).toBeInTheDocument()
    fireEvent.click(within(categoryTable).getByRole('button', { name: /Average Spend/ }))
    expect(getOrder()).toEqual(['Food', 'Coffee', 'Rent'])

    // Per month: Coffee 60, Food 133.33, Rent 500.
    fireEvent.change(screen.getByLabelText('Average spend'), { target: { value: 'month' } })
    expect(within(categoryTable).getByRole('button', { name: /Average Spend \(per month\)/ })).toBeInTheDocument()
    expect(within(categoryTable).getByText('133.33')).toBeInTheDocument()
    expect(getOrder()).toEqual(['Coffee', 'Food', 'Rent'])
  })

  it('restricts Ending month input max attribute to last completed month and clamps values beyond it', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText('Spending by Category Over Time')).toBeInTheDocument())

    const endingMonthInput = screen.getByLabelText('Ending month')
    const maxMonth = lastCompletedMonth()
    expect(endingMonthInput).toHaveAttribute('max', maxMonth.label)

    // Entering a future month clamps to maxMonth
    fireEvent.change(endingMonthInput, { target: { value: '2099-12' } })

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        `/trends?year=${maxMonth.year}&month=${maxMonth.month}&months=6&exclude_savings_spend=true`
      )
    })
  })

  it('filters out any current or future month data points from charts and tables', async () => {
    const futurePeriod = { year: 2099, month: 12, label: '2099-12' }
    mockLoad({
      periods: [...periods, futurePeriod],
      monthly: [
        ...monthly,
        { label: '2099-12', total_income: '9999.00', total_spending: '9999.00', net_saved: '0.00' },
      ],
      budget: [
        ...budget,
        { label: '2099-12', budgeted: '9999.00', actual: '9999.00' },
      ],
    })

    renderPage()

    await waitFor(() => expect(screen.getByText('Spending by Category Over Time')).toBeInTheDocument())

    // Future month should not appear in any chart titles, bars, or ending month selector
    expect(screen.queryByText('2099-12')).not.toBeInTheDocument()
    const endingMonthInput = screen.getByLabelText('Ending month')
    expect(endingMonthInput.value).not.toBe('2099-12')
  })

  it('defaults to excluding once-off savings spend and allows toggling to include them', async () => {
    renderPage()

    await waitFor(() => expect(screen.getByText('Spending by Category Over Time')).toBeInTheDocument())

    const checkbox = screen.getByLabelText('Exclude once-off savings spend')
    expect(checkbox).toBeChecked()

    fireEvent.click(checkbox)
    expect(checkbox).not.toBeChecked()

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining('exclude_savings_spend=false'))
    })

    fireEvent.click(checkbox)
    expect(checkbox).toBeChecked()

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining('exclude_savings_spend=true'))
    })
  })
})
