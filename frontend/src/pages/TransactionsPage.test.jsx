import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../services/api'
import TransactionsPage from './TransactionsPage.jsx'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

const sampleTransaction = {
  id: 1,
  import_batch_id: 1,
  account_id: 1,
  account_name: 'Joint Everyday',
  category_id: null,
  category_name: null,
  categorized_by_rule_id: null,
  bsb_number: null,
  account_number: '1111',
  transaction_date: '2026-07-24',
  narration: 'Coffee',
  cheque_number: null,
  debit: '-5.00',
  credit: null,
  balance: '100.00',
  transaction_type: 'WDL',
  note: null,
  is_split: false,
  splits: [],
}

const sampleBatch = {
  id: 1,
  filename: 'transactions.csv',
  imported_at: '2026-07-24T10:00:00Z',
  row_count: 1,
  skipped_duplicate_count: 0,
}

const sampleCategory = { id: 1, name: 'Groceries' }
const sampleAccount = { id: 1, name: 'Joint Everyday' }

function envelope(transactions, overrides = {}) {
  return {
    items: transactions,
    total: transactions.length,
    page: 1,
    page_size: 50,
    total_pages: 1,
    ...overrides,
  }
}

function mockLoad({
  transactions = [sampleTransaction],
  batches = [sampleBatch],
  categories = [sampleCategory],
  accounts = [sampleAccount],
  transactionTypes = ['WDL'],
  listResponse = envelope(transactions),
} = {}) {
  api.get.mockImplementation((path) => {
    if (path === '/transactions/types') {
      return Promise.resolve({ data: transactionTypes })
    }
    if (path.startsWith('/transactions?') || path === '/transactions') {
      return Promise.resolve({ data: listResponse })
    }
    if (path === '/import-batches') {
      return Promise.resolve({ data: batches })
    }
    if (path === '/categories') {
      return Promise.resolve({ data: categories })
    }
    if (path === '/accounts') {
      return Promise.resolve({ data: accounts })
    }
    if (path.startsWith('/transactions/groups')) {
      return Promise.resolve({ data: { groups: [] } })
    }
    return Promise.reject(new Error(`unexpected path ${path}`))
  })
}

// The page navigates to /rules, so it needs Router context. The probe route
// lets tests assert where "Make rule" landed.
function renderPage(initialEntry = '/transactions') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/transactions" element={<TransactionsPage />} />
        <Route path="/rules" element={<div>rules page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

// The filename/note/Split/Make rule/Delete controls live behind a row's own
// "Details" disclosure now, not unconditionally in the row - tests that
// need one of them must open it first, the same way a user would.
function expandRow(row) {
  fireEvent.click(within(row).getByRole('button', { name: 'Details' }))
}

describe('TransactionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading then the transaction table once data resolves', async () => {
    mockLoad()

    renderPage()

    expect(screen.getByText('Loading transactions...')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Coffee')).toBeInTheDocument()
    })

    expect(screen.getAllByText('transactions.csv').length).toBeGreaterThan(0)
  })

  it('shows validation errors when the import is rejected with a 422', async () => {
    mockLoad({ transactions: [], batches: [] })
    api.post.mockRejectedValue({
      response: {
        status: 422,
        data: {
          detail: {
            detail: 'CSV import rejected: one or more rows are invalid',
            errors: [{ row_number: 3, message: "invalid Transaction Date '32/13/2026'" }],
          },
        },
      },
    })

    renderPage()

    await waitFor(() => expect(screen.queryByText('Loading transactions...')).not.toBeInTheDocument())

    const file = new File(['bad,csv'], 'bad.csv', { type: 'text/csv' })
    const input = document.querySelector('input[type="file"]')

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/invalid Transaction Date/)).toBeInTheDocument()
    })
    expect(screen.getByText(/Row 3:/)).toBeInTheDocument()
  })

  it('calls the delete endpoint with the transaction id when its delete button is clicked', async () => {
    mockLoad()
    api.delete.mockResolvedValue({})

    renderPage()

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    expandRow(screen.getByText('Coffee').closest('tr'))
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' })
    fireEvent.click(deleteButtons[deleteButtons.length - 1])

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/transactions/1')
    })
  })

  it('shows an error message when a delete request fails instead of failing silently', async () => {
    mockLoad()
    api.delete.mockRejectedValue({ response: { data: { detail: 'Delete not allowed' } } })

    renderPage()

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    expandRow(screen.getByText('Coffee').closest('tr'))
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' })
    fireEvent.click(deleteButtons[deleteButtons.length - 1])

    await waitFor(() => {
      expect(screen.getByText(/Delete not allowed/)).toBeInTheDocument()
    })
  })

  it('shows the new account and auto-categorized counts after a successful import', async () => {
    mockLoad({ transactions: [], batches: [] })
    api.post.mockResolvedValue({
      data: {
        imported_count: 2,
        skipped_duplicate_count: 0,
        new_account_count: 1,
        auto_categorized_count: 2,
      },
    })

    renderPage()

    await waitFor(() => expect(screen.queryByText('Loading transactions...')).not.toBeInTheDocument())

    const file = new File(['a,b'], 'good.csv', { type: 'text/csv' })
    const input = document.querySelector('input[type="file"]')

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/created 1 new account\(s\)/)).toBeInTheDocument()
    })
    expect(screen.getByText(/auto-categorized\s+2 transaction\(s\)/)).toBeInTheDocument()
  })

  it('calls the category patch endpoint when a row category is changed', async () => {
    mockLoad()
    api.patch.mockResolvedValue({})

    renderPage()

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    const row = screen.getByText('Coffee').closest('tr')
    const categorySelect = within(row).getByDisplayValue('Uncategorized')
    fireEvent.change(categorySelect, { target: { value: '1' } })

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/transactions/1/category', { category_id: 1 })
    })
  })

  it('navigates to the rules page with the row narration when Make rule is clicked', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    expandRow(screen.getByText('Coffee').closest('tr'))
    fireEvent.click(screen.getByRole('button', { name: 'Make rule from Coffee' }))

    expect(await screen.findByText('rules page')).toBeInTheDocument()
  })

  it('applies rules and shows the number categorized', async () => {
    mockLoad()
    api.post.mockResolvedValue({ data: { categorized_count: 3 } })

    renderPage()

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Apply rules now' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/category-rules/apply')
    })
    expect(await screen.findByText('Categorized 3 transaction(s).')).toBeInTheDocument()
  })

  it('shows the auto marker for a rule-categorized row', async () => {
    mockLoad({
      transactions: [{ ...sampleTransaction, category_id: 1, category_name: 'Groceries', categorized_by_rule_id: 7 }],
    })

    renderPage()

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    const row = screen.getByText('Coffee').closest('tr')
    expect(within(row).getByTitle('Set automatically by a rule')).toBeInTheDocument()
  })

  it('applies filters and requests the filtered query string', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Narration contains'), { target: { value: 'woolworths' } })
    fireEvent.change(screen.getByLabelText('Account'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/^\/transactions\?.*search=woolworths/))
    })
    expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/account_id=1/))
  })

  it('requests uncategorized=true when the Uncategorized only option is chosen', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'uncategorized' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/uncategorized=true/))
    })
  })

  it('scopes the similar-transactions groups request to the applied filters', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())
    expect(api.get).toHaveBeenCalledWith('/transactions/groups?')

    fireEvent.change(screen.getByLabelText('Narration contains'), { target: { value: 'coffee' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/transactions/groups?search=coffee')
    })
  })

  it('clears filters back to an unfiltered request', async () => {
    mockLoad()

    renderPage('/transactions?search=woolworths')

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    expect(screen.getByLabelText('Narration contains')).toHaveValue('woolworths')

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Narration contains')).toHaveValue('')
    })
    expect(api.get).toHaveBeenCalledWith('/transactions?')
  })

  it('prefills filters from the URL on a deep link', async () => {
    mockLoad()

    renderPage('/transactions?uncategorized=true&date_from=2026-07-01&date_to=2026-07-31')

    await waitFor(() => {
      expect(screen.getByLabelText('Category')).toHaveValue('uncategorized')
    })
    expect(screen.getByLabelText('From date')).toHaveValue('2026-07-01')
    expect(screen.getByLabelText('To date')).toHaveValue('2026-07-31')
  })

  it('shows pagination info and requests the next page', async () => {
    mockLoad({ listResponse: envelope([sampleTransaction], { total: 120, page: 1, page_size: 50, total_pages: 3 }) })

    renderPage()

    await waitFor(() => expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/page=2/))
    })
  })

  it('changing rows per page requests the new size and resets to page 1', async () => {
    mockLoad({ listResponse: envelope([sampleTransaction], { total: 120, page: 2, page_size: 50, total_pages: 3 }) })

    renderPage()

    await waitFor(() => expect(screen.getByText(/Page 2 of 3/)).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '100' } })

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/page_size=100/))
    })
    expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/page=1/))
  })

  it('clears row selection when the page changes', async () => {
    mockLoad({ listResponse: envelope([sampleTransaction], { total: 120, page: 1, page_size: 50, total_pages: 3 }) })

    renderPage()

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    // The header now also has a select-all checkbox, so target the row's.
    const rowCheckbox = within(screen.getByText('Coffee').closest('tr')).getByRole('checkbox')
    fireEvent.click(rowCheckbox)
    expect(screen.getByText('Set category for selected (1)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => {
      expect(screen.getByText('Set category for selected (0)')).toBeInTheDocument()
    })
  })

  it('selects and deselects every row on the page with the header checkbox', async () => {
    const second = { ...sampleTransaction, id: 2, narration: 'Woolworths' }
    mockLoad({ transactions: [sampleTransaction, second] })

    renderPage()

    await waitFor(() => expect(screen.getByText('Woolworths')).toBeInTheDocument())

    const selectAll = screen.getByLabelText('Select all on this page')

    fireEvent.click(selectAll)
    expect(screen.getByText('Set category for selected (2)')).toBeInTheDocument()

    fireEvent.click(selectAll)
    expect(screen.getByText('Set category for selected (0)')).toBeInTheDocument()
  })

  it('shows the select-all checkbox as indeterminate when only some rows are selected', async () => {
    const second = { ...sampleTransaction, id: 2, narration: 'Woolworths' }
    mockLoad({ transactions: [sampleTransaction, second] })

    renderPage()

    await waitFor(() => expect(screen.getByText('Woolworths')).toBeInTheDocument())

    const rowCheckbox = within(screen.getByText('Coffee').closest('tr')).getByRole('checkbox')
    fireEvent.click(rowCheckbox)

    const selectAll = screen.getByLabelText('Select all on this page')
    expect(selectAll.indeterminate).toBe(true)
    expect(selectAll.checked).toBe(false)
  })

  it('does not refetch the filter lookups when a filter changes', async () => {
    // The lookups don't depend on the filters. Refetching all four on every
    // Apply click and page turn was four wasted requests per interaction.
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    // The groups card's own request (/transactions/groups) is deliberately
    // excluded here - unlike the four true lookups, it's SUPPOSED to
    // refetch when a filter changes, since it's scoped to the same filters
    // as the ledger itself (see groupsQueryFromSearchParams).
    const isLookupCall = ([path]) => !path.startsWith('/transactions?') && !path.startsWith('/transactions/groups')

    const lookupCallsAfterMount = api.get.mock.calls.filter(isLookupCall).length
    expect(lookupCallsAfterMount).toBe(4)

    fireEvent.change(screen.getByLabelText('Narration contains'), { target: { value: 'coffee' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/search=coffee/))
    })

    const lookupCallsAfterFilter = api.get.mock.calls.filter(isLookupCall).length
    expect(lookupCallsAfterFilter).toBe(4)
  })

  it('does refetch the lookups after an import, which can create accounts and batches', async () => {
    mockLoad()
    api.post.mockResolvedValue({
      data: {
        imported_count: 1,
        skipped_duplicate_count: 0,
        new_account_count: 1,
        auto_categorized_count: 0,
        batch: sampleBatch,
      },
    })

    renderPage()

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    const file = new File(['a'], 'transactions.csv', { type: 'text/csv' })
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } })

    await waitFor(() => {
      const lookupCalls = api.get.mock.calls.filter(([path]) => path === '/accounts').length
      expect(lookupCalls).toBe(2)
    })
  })

  it('makes a category created from the toolbar available in every row select immediately', async () => {
    mockLoad()
    api.post.mockResolvedValue({ data: { id: 9, name: 'Subscriptions', kind: 'expense' } })

    renderPage()

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '+ New category' }))
    fireEvent.change(screen.getByLabelText('New category name'), { target: { value: 'Subscriptions' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Bulk category')).toHaveValue('9')
    })

    // No reload/refetch needed - the row's own select already has it too.
    const row = screen.getByText('Coffee').closest('tr')
    const rowOptions = Array.from(within(row).getByRole('combobox').options).map((o) => o.textContent)
    expect(rowOptions).toContain('Subscriptions')
  })

  it('opens the split editor for a row and shows the transaction in its title', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    // The Split button lives in the row's OWN detail row (a sibling <tr>,
    // not a descendant of the collapsed row), once expanded - so it's
    // found unscoped here rather than via within(row).
    expandRow(screen.getByText('Coffee').closest('tr'))
    fireEvent.click(screen.getByRole('button', { name: 'Split' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/Split "Coffee"/)).toBeInTheDocument()
  })

  it('shows a split badge and per-category breakdown instead of a select for a split transaction', async () => {
    mockLoad({
      transactions: [{
        ...sampleTransaction,
        category_id: null,
        is_split: true,
        splits: [
          { id: 201, category_id: 1, category_name: 'Groceries', amount: '-3.00', note: null },
          { id: 202, category_id: null, category_name: null, amount: '-2.00', note: null },
        ],
      }],
    })

    renderPage()

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    const row = screen.getByText('Coffee').closest('tr')
    expect(within(row).getByText('split')).toBeInTheDocument()
    expect(within(row).getByText(/Groceries/)).toBeInTheDocument()
    expect(within(row).queryByLabelText('Category for Coffee')).not.toBeInTheDocument()

    // A split row has nothing to re-split into further from this button -
    // editing goes through "Edit split" instead. Both live in the row's
    // detail expander (a sibling <tr>), so they're found unscoped here
    // rather than via within(row) once it's open.
    expandRow(row)
    expect(screen.queryByRole('button', { name: 'Split' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit split' })).toBeInTheDocument()
  })

  it('saves a note on blur, but only when it actually changed', async () => {
    mockLoad()
    api.patch.mockResolvedValue({})

    renderPage()

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    expandRow(screen.getByText('Coffee').closest('tr'))
    const noteInput = screen.getByLabelText('Note for Coffee')

    // Focusing and blurring without editing must not fire a request.
    fireEvent.focus(noteInput)
    fireEvent.blur(noteInput)
    expect(api.patch).not.toHaveBeenCalledWith('/transactions/1/note', expect.anything())

    fireEvent.change(noteInput, { target: { value: 'Split with Sam' } })
    fireEvent.blur(noteInput)

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/transactions/1/note', { note: 'Split with Sam' })
    })
  })

  // --- Row expander -----------------------------------------------------

  it('hides Delete behind the row expander until it is opened', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    const row = screen.getByText('Coffee').closest('tr')
    // Import History's batch row also has a Delete button - only that one
    // exists until the transaction row's own expander is opened.
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1)

    expandRow(row)

    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2)
  })

  it('tracks aria-expanded on the row disclosure button as it opens and closes', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    const toggle = screen.getByRole('button', { name: 'Details' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)

    const hideToggle = screen.getByRole('button', { name: 'Hide' })
    expect(hideToggle).toHaveAttribute('aria-expanded', 'true')
    expect(hideToggle).toBe(toggle)

    fireEvent.click(hideToggle)

    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-expanded', 'false')
    // Back down to just the batch row's own Delete button - the
    // transaction's detail row (and its Delete) is gone again, not merely
    // visually hidden.
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1)
  })
})
