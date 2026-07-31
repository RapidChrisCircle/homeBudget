import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    page_size: 50,
    total_pages: 1,
    ...overrides,
  }
}

function mockLoad({
  account = sampleAccount,
  transactions = [sampleTransaction],
  categories = [],
  transactionTypes = ['WDL'],
  listResponse = envelope(transactions),
} = {}) {
  api.get.mockImplementation((path) => {
    if (path === `/accounts/${account.id}`) {
      return Promise.resolve({ data: account })
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

  it('requests the next page while staying scoped to the account', async () => {
    mockLoad({ listResponse: envelope([sampleTransaction], { total: 120, page: 1, page_size: 50, total_pages: 3 }) })

    renderPage()

    await waitFor(() => expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/account_id=1.*page=2|page=2.*account_id=1/))
    })
  })
})
