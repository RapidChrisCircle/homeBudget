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

function mockLoad({ categories = [sampleCategory], budgetData = sampleBudgetData, usage = [] } = {}) {
  api.get.mockImplementation((path) => {
    // Checked before the plain /categories match below, since it's the
    // more specific path.
    if (path === '/categories/usage') {
      return Promise.resolve({ data: usage })
    }
    if (path.startsWith('/categories')) {
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

// A grouped category's name appears twice once it has children - once as
// its own group Card's collapsible heading, once as its row inside that
// same group's table - so plain getByText is ambiguous. This finds the
// specific <tr>.
function categoryRow(container, name) {
  const row = within(container)
    .getAllByText(name)
    .map((el) => el.closest('tr'))
    .find(Boolean)
  if (!row) {
    throw new Error(`No <tr> found for "${name}"`)
  }
  return row
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
    // Two "Add Category" buttons now exist - the collapsible card's own
    // toggle and the form's submit button, which is rendered last.
    const addCategoryButtons = screen.getAllByRole('button', { name: 'Add Category' })
    fireEvent.click(addCategoryButtons[addCategoryButtons.length - 1])

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/categories', {
        name: 'Groceries',
        kind: 'expense',
        budget_amount: '800',
        parent_id: null,
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
    // Two "Add Category" buttons now exist - the collapsible card's own
    // toggle and the form's submit button, which is rendered last.
    const addCategoryButtons = screen.getAllByRole('button', { name: 'Add Category' })
    fireEvent.click(addCategoryButtons[addCategoryButtons.length - 1])

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/categories', {
        name: 'Salary',
        kind: 'income',
        budget_amount: null,
        parent_id: null,
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

  it('opens the edit form beneath the row being edited, not in the top card', async () => {
    mockLoad()

    render(<CategoriesPage />)

    await waitFor(() => expect(within(categoriesSection()).getByText('Groceries')).toBeInTheDocument())

    const row = categoryRow(categoriesSection(), 'Groceries')
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))

    const nameField = screen.getByLabelText('Name')
    expect(nameField).toHaveValue('Groceries')
    expect(nameField.closest('tr')).not.toBeNull()
    expect(screen.getByText('Finish editing the category below to add another.')).toBeInTheDocument()
  })

  it('keeps the top card titled "Add Category" throughout an edit', async () => {
    mockLoad()

    render(<CategoriesPage />)

    await waitFor(() => expect(within(categoriesSection()).getByText('Groceries')).toBeInTheDocument())
    expect(screen.getAllByText('Add Category').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(screen.getAllByText('Add Category').length).toBeGreaterThan(0)
    expect(screen.queryByText('Edit Category')).not.toBeInTheDocument()
  })

  it('closes the first row\'s editor when a second row is opened', async () => {
    const second = { id: 2, name: 'Dining', kind: 'expense', budget_amount: '150.00' }
    mockLoad({ categories: [sampleCategory, second] })

    render(<CategoriesPage />)

    await waitFor(() => expect(within(categoriesSection()).getByText('Dining')).toBeInTheDocument())

    const firstRow = categoryRow(categoriesSection(), 'Groceries')
    const secondRow = categoryRow(categoriesSection(), 'Dining')

    fireEvent.click(within(firstRow).getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Groceries')

    fireEvent.click(within(secondRow).getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Dining')
    expect(screen.getAllByLabelText('Name')).toHaveLength(1)
  })

  it('cancel leaves the row unchanged and closes the editor', async () => {
    mockLoad()

    render(<CategoriesPage />)

    await waitFor(() => expect(within(categoriesSection()).getByText('Groceries')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Changed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getAllByLabelText('Name')).toHaveLength(1)
    expect(screen.getByLabelText('Name')).toHaveValue('')
    expect(api.put).not.toHaveBeenCalled()
  })

  it('saving an edit posts the same payload as before and closes the editor', async () => {
    mockLoad()
    api.put.mockResolvedValue({ data: sampleCategory })

    render(<CategoriesPage />)

    await waitFor(() => expect(within(categoriesSection()).getByText('Groceries')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/categories/1', {
        name: 'Renamed',
        kind: 'expense',
        budget_amount: '250.00',
        parent_id: null,
      })
    })
    expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument()
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

  // --- Deletion: cascade for groups, bulk for multi-select -------------------

  it('cascade-deletes a group and confirms with its child count', async () => {
    const parent = { id: 1, name: 'Housing', kind: 'expense', budget_amount: null, parent_id: null }
    const child = { id: 2, name: 'Rent', kind: 'expense', budget_amount: '1500.00', parent_id: 1 }
    mockLoad({ categories: [parent, child], budgetData: { ...sampleBudgetData, categories: [] } })
    api.delete.mockResolvedValue({})
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<CategoriesPage />)

    const housingRow = await waitFor(() => categoryRow(categoriesSection(), 'Housing'))

    fireEvent.click(within(housingRow).getByRole('button', { name: 'Delete' }))

    expect(confirmSpy.mock.calls[0][0]).toContain('1 sub-category')

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/categories/1?cascade=true')
    })
  })

  it('deletes a plain (non-group) category without the cascade param', async () => {
    const parent = { id: 1, name: 'Housing', kind: 'expense', budget_amount: null, parent_id: null }
    const child = { id: 2, name: 'Rent', kind: 'expense', budget_amount: '1500.00', parent_id: 1 }
    mockLoad({ categories: [parent, child], budgetData: { ...sampleBudgetData, categories: [] } })
    api.delete.mockResolvedValue({})
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<CategoriesPage />)

    const rentRow = await waitFor(() => categoryRow(categoriesSection(), 'Rent'))

    fireEvent.click(within(rentRow).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/categories/2')
    })
  })

  it('bulk-deletes every selected category in one request', async () => {
    const groceries = { id: 1, name: 'Groceries', kind: 'expense', budget_amount: '250.00', parent_id: null }
    const fuel = { id: 2, name: 'Fuel', kind: 'expense', budget_amount: null, parent_id: null }
    mockLoad({ categories: [groceries, fuel], budgetData: { ...sampleBudgetData, categories: [] } })
    api.post.mockResolvedValue({ data: { deleted_count: 2 } })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<CategoriesPage />)

    await waitFor(() => expect(within(categoriesSection()).getByText('Groceries')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('Select Groceries'))
    fireEvent.click(screen.getByLabelText('Select Fuel'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected (2)' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/categories/bulk-delete', { category_ids: [1, 2] })
    })
  })

  it('disables the bulk delete button until something is selected', async () => {
    mockLoad()

    render(<CategoriesPage />)

    await waitFor(() => expect(within(categoriesSection()).getByText('Groceries')).toBeInTheDocument())

    expect(screen.getByRole('button', { name: 'Delete selected (0)' })).toBeDisabled()
  })

  // --- Unused and Archived --------------------------------------------------

  it('lists a zero-usage category in Unused and archives it', async () => {
    mockLoad({ usage: [
      { category_id: 1, category_name: 'Groceries', parent_id: null, budget_amount: '250.00', archived: false, transaction_count: 0, rule_count: 0 },
    ] })
    api.post.mockResolvedValue({ data: { ...sampleCategory, archived: true } })

    render(<CategoriesPage />)

    const unusedSection = await waitFor(() => screen.getByText('Unused').closest('.card'))
    expect(within(unusedSection).getByText('Groceries')).toBeInTheDocument()

    fireEvent.click(within(unusedSection).getByRole('button', { name: 'Archive' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/categories/1/archive')
    })
  })

  it('excludes a category with real activity from Unused', async () => {
    mockLoad({ usage: [
      { category_id: 1, category_name: 'Groceries', parent_id: null, budget_amount: '250.00', archived: false, transaction_count: 3, rule_count: 0 },
    ] })

    render(<CategoriesPage />)

    await waitFor(() => expect(within(categoriesSection()).getByText('Groceries')).toBeInTheDocument())

    const unusedSection = screen.getByText('Unused').closest('.card')
    expect(within(unusedSection).getByText('Nothing unused right now.')).toBeInTheDocument()
  })

  it('excludes a category still referenced by a rule from Unused', async () => {
    mockLoad({ usage: [
      { category_id: 1, category_name: 'Groceries', parent_id: null, budget_amount: '250.00', archived: false, transaction_count: 0, rule_count: 1 },
    ] })

    render(<CategoriesPage />)

    await waitFor(() => expect(within(categoriesSection()).getByText('Groceries')).toBeInTheDocument())

    const unusedSection = screen.getByText('Unused').closest('.card')
    expect(within(unusedSection).getByText('Nothing unused right now.')).toBeInTheDocument()
  })

  it('lists an archived category in Archived, not in All Categories, and restores it', async () => {
    const archived = { id: 1, name: 'Old Category', kind: 'expense', budget_amount: null, parent_id: null, archived: true }
    mockLoad({ categories: [archived], budgetData: { ...sampleBudgetData, categories: [] } })
    api.post.mockResolvedValue({ data: { ...archived, archived: false } })

    render(<CategoriesPage />)

    const archivedSection = await waitFor(() => screen.getByText('Archived').closest('.card'))
    expect(within(archivedSection).getByText('Old Category')).toBeInTheDocument()
    expect(within(categoriesSection()).queryByText('Old Category')).not.toBeInTheDocument()

    fireEvent.click(within(archivedSection).getByRole('button', { name: 'Restore' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/categories/1/restore')
    })
  })

  // --- Stale budgets table remediation --------------------------------------
  // Regression tests: creating/editing/deleting a category on this page must
  // refresh the Monthly Budgets table below it, not just the category list.

  it('updates the Standing column in the budgets table after editing a standing budget', async () => {
    let edited = false
    api.get.mockImplementation((path) => {
      if (path === '/categories/usage') {
        return Promise.resolve({ data: [] })
      }
      if (path.startsWith('/categories')) {
        return Promise.resolve({ data: [sampleCategory] })
      }
      if (path.startsWith('/budgets')) {
        const standing = edited ? '900.00' : '250.00'
        return Promise.resolve({
          data: {
            ...sampleBudgetData,
            categories: [{ ...sampleBudgetData.categories[0], standing_amount: standing, effective_amount: standing }],
          },
        })
      }
      return Promise.reject(new Error(`unexpected path ${path}`))
    })
    api.put.mockImplementation(() => {
      edited = true
      return Promise.resolve({ data: sampleCategory })
    })

    render(<CategoriesPage />)

    await waitForBudgetsLoaded()
    // Scoped to the row, not the totals footer, which coincidentally shows
    // the same figure here.
    let row = within(budgetsSection()).getByText('Groceries').closest('tr')
    expect(within(row).getByText('250.00')).toBeInTheDocument()

    fireEvent.click(within(categoriesSection()).getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Standing monthly budget'), { target: { value: '900' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => {
      row = within(budgetsSection()).getByText('Groceries').closest('tr')
      expect(within(row).getByText('900.00')).toBeInTheDocument()
    })
    expect(within(row).queryByText('250.00')).not.toBeInTheDocument()
  })

  it('removes a deleted category from the budgets table rather than leaving a phantom row', async () => {
    let deleted = false
    api.get.mockImplementation((path) => {
      if (path === '/categories/usage') {
        return Promise.resolve({ data: [] })
      }
      if (path.startsWith('/categories')) {
        return Promise.resolve({ data: deleted ? [] : [sampleCategory] })
      }
      if (path.startsWith('/budgets')) {
        return Promise.resolve({
          data: { ...sampleBudgetData, categories: deleted ? [] : sampleBudgetData.categories },
        })
      }
      return Promise.reject(new Error(`unexpected path ${path}`))
    })
    api.delete.mockImplementation(() => {
      deleted = true
      return Promise.resolve({})
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<CategoriesPage />)

    await waitForBudgetsLoaded()
    expect(within(budgetsSection()).getByText('Groceries')).toBeInTheDocument()

    fireEvent.click(within(categoriesSection()).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(screen.getByText('No expense categories yet.')).toBeInTheDocument()
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

  // --- Presets ---------------------------------------------------------

  it('applies the Queensland household preset and shows a summary message', async () => {
    mockLoad()
    api.post.mockResolvedValue({ data: { created: ['Housing', 'Mortgage/Rent'], skipped: ['Groceries'] } })

    render(<CategoriesPage />)

    await waitFor(() => expect(within(categoriesSection()).getByText('Groceries')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Load Queensland household preset' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/categories/preset')
    })
    await waitFor(() => {
      expect(screen.getByText('Created 2 categories, skipped 1 already present.')).toBeInTheDocument()
    })
  })

  it('shows an error message when applying the preset fails', async () => {
    mockLoad()
    api.post.mockRejectedValue({ response: { data: { detail: 'database unavailable' } } })

    render(<CategoriesPage />)

    await waitFor(() => expect(within(categoriesSection()).getByText('Groceries')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Load Queensland household preset' }))

    await waitFor(() => {
      expect(screen.getByText(/database unavailable/)).toBeInTheDocument()
    })
  })

  // --- Sub-categories ----------------------------------------------------

  it('offers only top-level categories as a parent option', async () => {
    const parent = { id: 1, name: 'Housing', kind: 'expense', budget_amount: null, parent_id: null }
    const child = { id: 2, name: 'Rent', kind: 'expense', budget_amount: '1500.00', parent_id: 1 }
    mockLoad({ categories: [parent, child], budgetData: { ...sampleBudgetData, categories: [] } })

    render(<CategoriesPage />)

    await waitFor(() => expect(categoryRow(categoriesSection(), 'Housing')).toBeTruthy())

    const options = Array.from(screen.getByLabelText('Parent category').options).map((o) => o.textContent)
    expect(options).toEqual(['No parent (top-level)', 'Housing'])
  })

  it('hides the parent field and explains why when editing a category that has children', async () => {
    const parent = { id: 1, name: 'Housing', kind: 'expense', budget_amount: null, parent_id: null }
    const child = { id: 2, name: 'Rent', kind: 'expense', budget_amount: '1500.00', parent_id: 1 }
    mockLoad({ categories: [parent, child], budgetData: { ...sampleBudgetData, categories: [] } })

    render(<CategoriesPage />)

    await waitFor(() => expect(categoryRow(categoriesSection(), 'Housing')).toBeTruthy())

    const housingRow = categoryRow(categoriesSection(), 'Housing')
    fireEvent.click(within(housingRow).getByRole('button', { name: 'Edit' }))

    expect(screen.queryByLabelText('Parent category')).not.toBeInTheDocument()
    expect(screen.getByText(/cannot be given a parent itself/)).toBeInTheDocument()
    // The backend coerces a group's own budget to null too - the field
    // shouldn't be offered as if setting it would do anything.
    expect(screen.queryByLabelText('Standing monthly budget')).not.toBeInTheDocument()
  })

  it("groups categories under their parent, with the parent row showing the sum of its children's budgets", async () => {
    const parent = { id: 1, name: 'Housing', kind: 'expense', budget_amount: null, parent_id: null }
    const childA = { id: 2, name: 'Rent', kind: 'expense', budget_amount: '1500.00', parent_id: 1 }
    const childB = { id: 3, name: 'Council Rates', kind: 'expense', budget_amount: '400.00', parent_id: 1 }
    const standalone = { id: 4, name: 'Salary', kind: 'income', budget_amount: null, parent_id: null }
    mockLoad({
      categories: [parent, childA, childB, standalone],
      budgetData: { ...sampleBudgetData, categories: [] },
    })

    render(<CategoriesPage />)

    await waitFor(() => expect(categoryRow(categoriesSection(), 'Housing')).toBeTruthy())

    expect(within(categoriesSection()).getByText('Rent')).toBeInTheDocument()
    expect(within(categoriesSection()).getByText('Council Rates')).toBeInTheDocument()

    // The parent row shows the sum of its children (1500 + 400), not its
    // own (null) budget_amount.
    const housingRow = categoryRow(categoriesSection(), 'Housing')
    expect(within(housingRow).getByText('1900.00')).toBeInTheDocument()

    // The standalone (no parent, no children) category lands in "Other".
    expect(within(categoriesSection()).getByText('Other')).toBeInTheDocument()
    expect(within(categoriesSection()).getByText('Salary')).toBeInTheDocument()
  })

  it('renders one flat table with no group headings when nothing has a parent', async () => {
    mockLoad()

    render(<CategoriesPage />)

    await waitFor(() => expect(within(categoriesSection()).getByText('Groceries')).toBeInTheDocument())

    expect(within(categoriesSection()).queryByText('Other')).not.toBeInTheDocument()
    expect(within(categoriesSection()).queryByText('group')).not.toBeInTheDocument()
  })

  // --- Sorting --------------------------------------------------------------

  it('sorts the flat All Categories table by Name', async () => {
    const zebra = { id: 5, name: 'Zebra Expenses', kind: 'expense', budget_amount: '10.00' }
    mockLoad({ categories: [sampleCategory, zebra] })

    render(<CategoriesPage />)

    await waitFor(() => expect(within(categoriesSection()).getByText('Zebra Expenses')).toBeInTheDocument())

    fireEvent.click(within(categoriesSection()).getByRole('button', { name: 'Name' }))

    const rows = categoriesSection().querySelectorAll('tbody tr')
    expect(within(rows[0]).getByText('Groceries')).toBeInTheDocument() // G < Z ascending
  })

  it('keeps a group\'s own row pinned first when sorting - only its children reorder', async () => {
    const parent = { id: 1, name: 'Housing', kind: 'expense', budget_amount: null, parent_id: null }
    const zebraChild = { id: 2, name: 'Zebra Utility', kind: 'expense', budget_amount: '400.00', parent_id: 1 }
    const appleChild = { id: 3, name: 'Apple Utility', kind: 'expense', budget_amount: '100.00', parent_id: 1 }
    mockLoad({
      categories: [parent, zebraChild, appleChild],
      budgetData: { ...sampleBudgetData, categories: [] },
    })

    render(<CategoriesPage />)

    await waitFor(() => expect(categoryRow(categoriesSection(), 'Housing')).toBeTruthy())

    const groupCard = screen.getByText('Housing', { selector: '.card-toggle' }).closest('.card')
    fireEvent.click(within(groupCard).getByRole('button', { name: 'Name' }))

    const rows = groupCard.querySelectorAll('tbody tr')
    // Housing (the group's own row) stays first regardless of the sort -
    // only Apple/Zebra Utility (its children) reorder among themselves.
    expect(within(rows[0]).getByText('Housing')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Apple Utility')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Zebra Utility')).toBeInTheDocument()
  })

  it('sorts the Unused table by Name', async () => {
    const usage = [
      { category_id: 1, category_name: 'Zebra', budget_amount: null, transaction_count: 0, rule_count: 0, archived: false },
      { category_id: 2, category_name: 'Apple', budget_amount: null, transaction_count: 0, rule_count: 0, archived: false },
    ]
    mockLoad({ usage })

    render(<CategoriesPage />)

    const unusedCard = await screen.findByText('Unused').then((el) => el.closest('.card'))
    await waitFor(() => expect(within(unusedCard).getByText('Zebra')).toBeInTheDocument())

    fireEvent.click(within(unusedCard).getByRole('button', { name: 'Name' }))

    const rows = unusedCard.querySelectorAll('tbody tr')
    expect(within(rows[0]).getByText('Apple')).toBeInTheDocument()
  })

  it('sorts the Archived table by Name', async () => {
    const categories = [
      { ...sampleCategory, id: 1, archived: true, name: 'Zebra Archived' },
      { ...sampleCategory, id: 2, archived: true, name: 'Apple Archived' },
    ]
    mockLoad({ categories })

    render(<CategoriesPage />)

    const archivedCard = await screen.findByText('Archived').then((el) => el.closest('.card'))
    await waitFor(() => expect(within(archivedCard).getByText('Zebra Archived')).toBeInTheDocument())

    fireEvent.click(within(archivedCard).getByRole('button', { name: 'Name' }))

    const rows = archivedCard.querySelectorAll('tbody tr')
    expect(within(rows[0]).getByText('Apple Archived')).toBeInTheDocument()
  })

  it('sorts Monthly Budgets while keeping the tfoot Total row pinned last', async () => {
    const budgetData = {
      ...sampleBudgetData,
      categories: [
        { category_id: 1, category_name: 'Zebra', standing_amount: '10.00', override_amount: null, effective_amount: '10.00', is_overridden: false, actual: '5.00', difference: '5.00' },
        { category_id: 2, category_name: 'Apple', standing_amount: '20.00', override_amount: null, effective_amount: '20.00', is_overridden: false, actual: '15.00', difference: '5.00' },
      ],
    }
    mockLoad({ budgetData })

    render(<CategoriesPage />)
    await waitForBudgetsLoaded()

    fireEvent.click(within(budgetsSection()).getByRole('button', { name: 'Category' }))

    const table = within(budgetsSection()).getByText('Monthly budgets').closest('table')
    const bodyRows = table.querySelectorAll('tbody tr')
    expect(within(bodyRows[0]).getByText('Apple')).toBeInTheDocument()
    expect(within(bodyRows[1]).getByText('Zebra')).toBeInTheDocument()

    // The Total row is a <tfoot>, never reordered by a tbody sort.
    const footRow = table.querySelector('tfoot tr')
    expect(within(footRow).getByText('Total')).toBeInTheDocument()
  })
})
