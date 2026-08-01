import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../services/api'
import CategoriesPage from './CategoriesPage.jsx'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

const sampleCategory = { id: 1, name: 'Groceries', kind: 'expense', budget_amount: '250.00' }

const sampleBudgetData = {
  year: 2026,
  month: 7,
  categories: [
    {
      category_id: 1,
      category_name: 'Groceries',
      standing_amount: '250.00',
      override_amount: null,
      effective_amount: '250.00',
      is_overridden: false,
      actual: '180.00',
      difference: '70.00',
    },
  ],
  totals: { budgeted: '250.00', actual: '180.00', difference: '70.00' },
}

function mockLoad({ categories = [sampleCategory], budgetData = sampleBudgetData } = {}) {
  api.get.mockImplementation((path) => {
    if (path === '/categories') {
      return Promise.resolve({ data: categories })
    }
    if (path.startsWith('/budgets')) {
      return Promise.resolve({ data: budgetData })
    }
    return Promise.reject(new Error(`unexpected path ${path}`))
  })
}

async function waitForBudgetsLoaded() {
  await waitFor(() => expect(screen.queryByText('Loading budgets...')).not.toBeInTheDocument())
}

// The "All Categories" table and the "Monthly Budgets" table both list
// category names, so plain getByText('Groceries') is ambiguous once the
// budgets card has loaded - scope category-CRUD assertions to this table.
function categoriesSection() {
  return screen.getByText('All Categories').closest('.card')
}

function budgetsSection() {
  return screen.getByText('Monthly Budgets').closest('.card')
}

describe('CategoriesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading then the category table with kind and budget columns', async () => {
    mockLoad()

    render(<CategoriesPage />)

    expect(screen.getByText('Loading categories...')).toBeInTheDocument()

    await waitFor(() => {
      expect(within(categoriesSection()).getByText('Groceries')).toBeInTheDocument()
    })
    expect(within(categoriesSection()).getByText('expense')).toBeInTheDocument()
    expect(within(categoriesSection()).getByText('250.00')).toBeInTheDocument()
  })

  it('submits the create form with the entered name, kind and budget', async () => {
    mockLoad({ categories: [] })
    api.post.mockResolvedValue({ data: sampleCategory })

    render(<CategoriesPage />)

    await waitFor(() => expect(screen.queryByText('Loading categories...')).not.toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Groceries' } })
    fireEvent.change(screen.getByLabelText('Standing monthly budget'), { target: { value: '800' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Category' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/categories', {
        name: 'Groceries',
        kind: 'expense',
        budget_amount: '800',
      })
    })
  })

  it('sends a null budget when the field is left blank', async () => {
    mockLoad({ categories: [] })
    api.post.mockResolvedValue({ data: sampleCategory })

    render(<CategoriesPage />)

    await waitFor(() => expect(screen.queryByText('Loading categories...')).not.toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Salary' } })
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'income' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Category' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/categories', {
        name: 'Salary',
        kind: 'income',
        budget_amount: null,
      })
    })
  })

  it('hides the budget field for non-expense kinds', async () => {
    mockLoad({ categories: [] })

    render(<CategoriesPage />)

    await waitFor(() => expect(screen.queryByText('Loading categories...')).not.toBeInTheDocument())

    expect(screen.getByLabelText('Standing monthly budget')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'transfer' } })

    expect(screen.queryByLabelText('Standing monthly budget')).not.toBeInTheDocument()
  })

  it('prefills the form when editing a category', async () => {
    mockLoad()

    render(<CategoriesPage />)

    await waitFor(() => expect(within(categoriesSection()).getByText('Groceries')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(screen.getByLabelText('Name')).toHaveValue('Groceries')
    expect(screen.getByLabelText('Kind')).toHaveValue('expense')
    expect(screen.getByLabelText('Standing monthly budget')).toHaveValue(250)
  })

  it('deletes a category when confirmed', async () => {
    mockLoad()
    api.delete.mockResolvedValue({})
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<CategoriesPage />)

    await waitFor(() => expect(within(categoriesSection()).getByText('Groceries')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/categories/1')
    })
  })

  // --- Monthly Budgets card -------------------------------------------------

  it('renders the budget table with standing, this month and actual figures', async () => {
    mockLoad()

    render(<CategoriesPage />)

    await waitForBudgetsLoaded()

    expect(screen.getByLabelText("This month's budget for Groceries")).toHaveValue(250)
    // Scoped to the row, not the totals footer - with a single category the
    // totals coincidentally show the same figures.
    const row = within(budgetsSection()).getByText('Groceries').closest('tr')
    expect(within(row).getByText('180.00')).toBeInTheDocument() // actual
    expect(within(row).getByText(/70.00/)).toBeInTheDocument() // difference
  })

  it('marks an overridden category and offers a revert action', async () => {
    mockLoad({
      budgetData: {
        ...sampleBudgetData,
        categories: [
          { ...sampleBudgetData.categories[0], override_amount: '400.00', effective_amount: '400.00', is_overridden: true },
        ],
      },
    })

    render(<CategoriesPage />)

    await waitForBudgetsLoaded()

    expect(screen.getByTitle('Overridden for this month specifically')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revert to standing' })).toBeInTheDocument()
  })

  it('does not offer a revert action for a non-overridden category', async () => {
    mockLoad()

    render(<CategoriesPage />)

    await waitForBudgetsLoaded()

    expect(screen.queryByRole('button', { name: 'Revert to standing' })).not.toBeInTheDocument()
  })

  it('sums the totals row from the API response, not recomputed locally', async () => {
    mockLoad()

    render(<CategoriesPage />)

    await waitForBudgetsLoaded()

    const totalRow = screen.getByText('Total').closest('tr')
    expect(totalRow).toHaveTextContent('250.00')
    expect(totalRow).toHaveTextContent('180.00')
    expect(totalRow).toHaveTextContent('70.00')
  })

  it('refetches when the month selector changes', async () => {
    mockLoad()

    render(<CategoriesPage />)

    await waitForBudgetsLoaded()

    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-08' } })

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/budgets?year=2026&month=8')
    })
  })

  it('saves an edited budget amount for the current month', async () => {
    mockLoad()
    api.put.mockResolvedValue({ data: sampleBudgetData.categories[0] })

    render(<CategoriesPage />)

    await waitForBudgetsLoaded()

    fireEvent.change(screen.getByLabelText("This month's budget for Groceries"), { target: { value: '300' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/budgets/1', { year: 2026, month: 7, amount: '300' })
    })
  })

  it('disables Save when the input is left empty', async () => {
    mockLoad()

    render(<CategoriesPage />)

    await waitForBudgetsLoaded()

    fireEvent.change(screen.getByLabelText("This month's budget for Groceries"), { target: { value: '' } })

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('reverts an override back to standing', async () => {
    mockLoad({
      budgetData: {
        ...sampleBudgetData,
        categories: [
          { ...sampleBudgetData.categories[0], override_amount: '400.00', effective_amount: '400.00', is_overridden: true },
        ],
      },
    })
    api.delete.mockResolvedValue({})

    render(<CategoriesPage />)

    await waitForBudgetsLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Revert to standing' }))

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/budgets/1?year=2026&month=7')
    })
  })

  it('copies budgets from the previous month', async () => {
    mockLoad()
    api.post.mockResolvedValue({ data: { copied_count: 1 } })

    render(<CategoriesPage />)

    await waitForBudgetsLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Copy from previous month' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/budgets/copy', {
        from_year: 2026, from_month: 6, to_year: 2026, to_month: 7,
      })
    })
  })

  it('shows a message when there are no expense categories to budget', async () => {
    mockLoad({ budgetData: { ...sampleBudgetData, categories: [] } })

    render(<CategoriesPage />)

    await waitForBudgetsLoaded()

    expect(screen.getByText('No expense categories yet.')).toBeInTheDocument()
  })
})
