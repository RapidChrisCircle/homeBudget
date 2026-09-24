import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AddTransactionForm from './AddTransactionForm.jsx'
import { api } from '../services/api'

vi.mock('../services/api', () => ({
  api: {
    post: vi.fn(),
  },
}))

const accounts = [
  { id: 1, name: 'Cash' },
  { id: 2, name: 'Joint Everyday' },
]

const categories = [
  { id: 1, name: 'Groceries', parent_id: null },
]

function fillRequiredFields({ direction = 'debit', amount = '12.50', narration = 'Corner store' } = {}) {
  fireEvent.change(screen.getByLabelText('New transaction account'), { target: { value: '1' } })
  fireEvent.change(screen.getByLabelText('Narration'), { target: { value: narration } })
  if (direction === 'credit') {
    fireEvent.click(screen.getByLabelText('Money in'))
  }
  fireEvent.change(screen.getByLabelText('Amount'), { target: { value: amount } })
}

describe('AddTransactionForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists every account and defaults to today', () => {
    render(<AddTransactionForm accounts={accounts} categories={categories} onCreated={vi.fn()} />)

    expect(screen.getByRole('option', { name: 'Cash' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Joint Everyday' })).toBeInTheDocument()
    const today = new Date().toISOString().slice(0, 10)
    expect(screen.getByLabelText('Date')).toHaveValue(today)
  })

  it('defaults to Money out', () => {
    render(<AddTransactionForm accounts={accounts} categories={categories} onCreated={vi.fn()} />)

    expect(screen.getByLabelText('Money out')).toBeChecked()
    expect(screen.getByLabelText('Money in')).not.toBeChecked()
  })

  it('posts a debit as the negative amount and a credit as positive', async () => {
    api.post.mockResolvedValue({ data: { id: 1 } })
    const onCreated = vi.fn()
    render(<AddTransactionForm accounts={accounts} categories={categories} onCreated={onCreated} />)

    fillRequiredFields({ direction: 'debit', amount: '12.50' })
    fireEvent.click(screen.getByRole('button', { name: 'Add transaction' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/transactions', expect.objectContaining({
      account_id: 1,
      narration: 'Corner store',
      debit: '12.50',
      credit: null,
      category_id: null,
      note: null,
    })))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 1 }))
  })

  it('posts Money in as a credit', async () => {
    api.post.mockResolvedValue({ data: { id: 2 } })
    render(<AddTransactionForm accounts={accounts} categories={categories} onCreated={vi.fn()} />)

    fillRequiredFields({ direction: 'credit', amount: '20.00' })
    fireEvent.click(screen.getByRole('button', { name: 'Add transaction' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/transactions', expect.objectContaining({
      debit: null,
      credit: '20.00',
    })))
  })

  it('includes the chosen category and note when given', async () => {
    api.post.mockResolvedValue({ data: { id: 3 } })
    render(<AddTransactionForm accounts={accounts} categories={categories} onCreated={vi.fn()} />)

    fillRequiredFields()
    fireEvent.change(screen.getByLabelText('New transaction category'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'weekly shop' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add transaction' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/transactions', expect.objectContaining({
      category_id: 1,
      note: 'weekly shop',
    })))
  })

  it('resets narration, amount and note after a successful add, keeping the account and date', async () => {
    api.post.mockResolvedValue({ data: { id: 4 } })
    render(<AddTransactionForm accounts={accounts} categories={categories} onCreated={vi.fn()} />)

    fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: 'Add transaction' }))

    await waitFor(() => expect(api.post).toHaveBeenCalled())
    expect(screen.getByLabelText('Narration')).toHaveValue('')
    expect(screen.getByLabelText('Amount')).toHaveValue(null)
    expect(screen.getByLabelText('New transaction account')).toHaveValue('1')
  })

  it('shows the API error - e.g. the backdating rejection - without crashing', async () => {
    api.post.mockRejectedValue({
      response: { data: { detail: "Manual transactions must be dated on or after this account's latest transaction (2026-09-05)" } },
    })
    render(<AddTransactionForm accounts={accounts} categories={categories} onCreated={vi.fn()} />)

    fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: 'Add transaction' }))

    expect(await screen.findByText(/on or after this account's latest transaction/)).toBeInTheDocument()
  })
})
