import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../services/api'
import TransactionsPage from './TransactionsPage.jsx'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
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
  bsb_number: null,
  account_number: '1111',
  transaction_date: '2026-07-24',
  narration: 'Coffee',
  cheque_number: null,
  debit: '-5.00',
  credit: null,
  balance: '100.00',
  transaction_type: 'WDL',
}

const sampleBatch = {
  id: 1,
  filename: 'transactions.csv',
  imported_at: '2026-07-24T10:00:00Z',
  row_count: 1,
  skipped_duplicate_count: 0,
}

const sampleCategory = { id: 1, name: 'Groceries' }

function mockLoad(transactions = [sampleTransaction], batches = [sampleBatch], categories = [sampleCategory]) {
  api.get.mockImplementation((path) => {
    if (path === '/transactions') {
      return Promise.resolve({ data: transactions })
    }
    if (path === '/import-batches') {
      return Promise.resolve({ data: batches })
    }
    if (path === '/categories') {
      return Promise.resolve({ data: categories })
    }
    return Promise.reject(new Error(`unexpected path ${path}`))
  })
}

describe('TransactionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading then the transaction table once data resolves', async () => {
    mockLoad()

    render(<TransactionsPage />)

    expect(screen.getByText('Loading transactions...')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Coffee')).toBeInTheDocument()
    })

    expect(screen.getAllByText('transactions.csv').length).toBeGreaterThan(0)
  })

  it('shows validation errors when the import is rejected with a 422', async () => {
    mockLoad([], [])
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

    render(<TransactionsPage />)

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

    render(<TransactionsPage />)

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' })
    fireEvent.click(deleteButtons[deleteButtons.length - 1])

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/transactions/1')
    })
  })

  it('shows an error message when a delete request fails instead of failing silently', async () => {
    mockLoad()
    api.delete.mockRejectedValue({ response: { data: { detail: 'Delete not allowed' } } })

    render(<TransactionsPage />)

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' })
    fireEvent.click(deleteButtons[deleteButtons.length - 1])

    await waitFor(() => {
      expect(screen.getByText(/Delete not allowed/)).toBeInTheDocument()
    })
  })

  it('shows the new account count after a successful import', async () => {
    mockLoad([], [])
    api.post.mockResolvedValue({
      data: { imported_count: 2, skipped_duplicate_count: 0, new_account_count: 1 },
    })

    render(<TransactionsPage />)

    await waitFor(() => expect(screen.queryByText('Loading transactions...')).not.toBeInTheDocument())

    const file = new File(['a,b'], 'good.csv', { type: 'text/csv' })
    const input = document.querySelector('input[type="file"]')

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/created 1 new account\(s\)/)).toBeInTheDocument()
    })
  })

  it('calls the category patch endpoint when a row category is changed', async () => {
    mockLoad()
    api.patch.mockResolvedValue({})

    render(<TransactionsPage />)

    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

    const row = screen.getByText('Coffee').closest('tr')
    const categorySelect = within(row).getByDisplayValue('Uncategorized')
    fireEvent.change(categorySelect, { target: { value: '1' } })

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/transactions/1/category', { category_id: 1 })
    })
  })
})
