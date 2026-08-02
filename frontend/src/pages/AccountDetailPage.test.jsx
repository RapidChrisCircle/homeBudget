import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../services/api'
import AccountDetailPage from './AccountDetailPage.jsx'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    patch: vi.fn(),
  },
}))

const sampleAccount = {
  id: 1,
  name: 'Joint Everyday',
  institution: 'ANZ',
  account_type: 'everyday',
  bsb_number: '013-006',
  account_number: '5229 8024 5118 3514',
  balance: '-4838.18',
  balance_as_of: '2026-07-24',
}

const sampleTransaction = {
  id: 1,
  account_id: 1,
  category_id: null,
  category_name: null,
  categorized_by_rule_id: null,
  transaction_date: '2026-07-24',
  narration: 'Coffee',
  debit: '-5.00',
  credit: null,
  balance: '100.00',
  transaction_type: 'WDL',
  note: null,
  is_split: false,
  splits: [],
}

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

const sampleBalanceHistory = {
  periods: [
    { year: 2026, month: 5, label: '2026-05' },
    { year: 2026, month: 6, label: '2026-06' },
    { year: 2026, month: 7, label: '2026-07' },
  ],
  balances: { '2026-05': null, '2026-06': '-4700.00', '2026-07': '-4838.18' },
}

function mockLoad({
  account = sampleAccount,
  transactions = [sampleTransaction],
  categories = [],
  transactionTypes = ['WDL'],
  listResponse = envelope(transactions),
  balanceHistory = sampleBalanceHistory,
} = {}) {
  api.get.mockImplementation((path) => {
    if (path === `/accounts/${account.id}`) {
      return Promise.resolve({ data: account })
    }
    if (path === `/accounts/${account.id}/balance-history`) {
      return Promise.resolve({ data: balanceHistory })
    }
    if (path.startsWith('/transactions?')) {
      return Promise.resolve({ data: listResponse })
    }
    if (path === '/categories') {
      return Promise.resolve({ data: categories })
    }
    if (path === '/transactions/types') {
      return Promise.resolve({ data: transactionTypes })
    }
    return Promise.reject(new Error(`unexpected path ${path}`))
  })
}

function renderPage(initialEntry = '/accounts/1') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/accounts/:accountId" element={<AccountDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AccountDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the balance header and the account transactions', async () => {
    mockLoad()

    renderPage()

    expect(screen.getByText('Loading account...')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Joint Everyday' })).toBeInTheDocument()
    })
    expect(screen.getByText(/-4838.18 \(as of 2026-07-24\)/)).toBeInTheDocument()
    expect(screen.getByText('Coffee')).toBeInTheDocument()
  })

  it('shows "No transactions yet" when the account has no balance', async () => {
    mockLoad({ account: { ...sampleAccount, balance: null, balance_as_of: null }, transactions: [] })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/No transactions yet/)).toBeInTheDocument()
    })
  })

  it('scopes the transaction request to this account', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/^\/transactions\?.*account_id=1/))
  })

  it('applies filters scoped to the account', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Narration contains'), { target: { value: 'woolworths' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/account_id=1.*search=woolworths|search=woolworths.*account_id=1/))
    })
  })

  it('still renders pagination when the current page has no rows', async () => {
    // A page can go out of range from a stale bookmark or rows deleted
    // elsewhere. Hiding the controls when the page is empty leaves no way back.
    mockLoad({
      transactions: [],
      listResponse: envelope([], { total: 120, page: 3, page_size: 50, total_pages: 3 }),
    })

    renderPage('/accounts/1?page=3')

    await waitFor(() => {
      expect(screen.getByText(/No transactions match these filters/)).toBeInTheDocument()
    })

    const previous = screen.getByRole('button', { name: 'Previous' })
    expect(previous).toBeInTheDocument()
    expect(previous).not.toBeDisabled()
  })

  it('changes a row category and refreshes', async () => {
    mockLoad({ categories: [{ id: 9, name: 'Groceries' }] })
    api.patch.mockResolvedValue({})

    renderPage()

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Category for Coffee'), { target: { value: '9' } })

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/transactions/1/category', { category_id: 9 })
    })
  })

  it('surfaces a failed category change', async () => {
    mockLoad({ categories: [{ id: 9, name: 'Groceries' }] })
    api.patch.mockRejectedValue({ response: { data: { detail: 'Category not found' } } })

    renderPage()

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Category for Coffee'), { target: { value: '9' } })

    await waitFor(() => {
      expect(screen.getByText(/Category not found/)).toBeInTheDocument()
    })
  })

  // Regression coverage: this page has no split editor, so a split
  // transaction must never render the plain category select at all - that
  // select's "Uncategorized" option would misrepresent an
  // already-categorized transaction, and choosing it would silently wipe
  // the split (PATCH .../category clears splits - see api/transactions.py).
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
    expect(within(row).queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('still shows the plain category select, and still patches on change, for an unsplit transaction', async () => {
    mockLoad({ categories: [{ id: 9, name: 'Groceries' }] })
    api.patch.mockResolvedValue({})

    renderPage()

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    const row = screen.getByText('Coffee').closest('tr')
    expect(within(row).getByLabelText('Category for Coffee')).toBeInTheDocument()

    fireEvent.change(within(row).getByLabelText('Category for Coffee'), { target: { value: '9' } })

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/transactions/1/category', { category_id: 9 })
    })
  })

  it('requests the next page while staying scoped to the account', async () => {
    mockLoad({ listResponse: envelope([sampleTransaction], { total: 120, page: 1, page_size: 50, total_pages: 3 }) })

    renderPage()

    await waitFor(() => expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/account_id=1.*page=2|page=2.*account_id=1/))
    })
  })

  it('changing rows per page requests the new size while staying scoped to the account', async () => {
    mockLoad({ listResponse: envelope([sampleTransaction], { total: 120, page: 1, page_size: 50, total_pages: 3 }) })

    renderPage()

    await waitFor(() => expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '20' } })

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/page_size=20/))
    })
    expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/account_id=1/))
  })

  it('renders the balance history chart', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText('Balance History')).toBeInTheDocument())

    expect(screen.getByRole('img', { name: 'Balance history' })).toBeInTheDocument()
    expect(screen.getByText('Balance — 2026-07: -4838.18')).toBeInTheDocument()
  })

  it('does not fetch the balance history again when the ledger filters change', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText('Balance History')).toBeInTheDocument())

    const callsAfterMount = api.get.mock.calls.filter(([path]) => path.endsWith('/balance-history')).length
    expect(callsAfterMount).toBe(1)

    fireEvent.change(screen.getByLabelText('Narration contains'), { target: { value: 'woolworths' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

    await waitFor(() => expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/search=woolworths/)))

    const callsAfterFilter = api.get.mock.calls.filter(([path]) => path.endsWith('/balance-history')).length
    expect(callsAfterFilter).toBe(1)
  })

  it('does not render the chart section when the balance history request fails', async () => {
    mockLoad()
    api.get.mockImplementation((path) => {
      if (path === '/accounts/1/balance-history') {
        return Promise.reject(new Error('boom'))
      }
      if (path === '/accounts/1') {
        return Promise.resolve({ data: sampleAccount })
      }
      if (path.startsWith('/transactions?')) {
        return Promise.resolve({ data: envelope([sampleTransaction]) })
      }
      if (path === '/categories') {
        return Promise.resolve({ data: [] })
      }
      if (path === '/transactions/types') {
        return Promise.resolve({ data: ['WDL'] })
      }
      return Promise.reject(new Error(`unexpected path ${path}`))
    })

    renderPage()

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    expect(screen.queryByText('Balance History')).not.toBeInTheDocument()
  })
})
