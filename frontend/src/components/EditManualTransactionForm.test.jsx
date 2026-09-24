import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EditManualTransactionForm from './EditManualTransactionForm.jsx'
import { api } from '../services/api'

vi.mock('../services/api', () => ({
  api: {
    put: vi.fn(),
  },
}))

const categories = [
  { id: 1, name: 'Groceries', parent_id: null },
]

const debitTransaction = {
  id: 7,
  transaction_date: '2026-09-01',
  narration: 'Corner store',
  debit: '-12.50',
  credit: null,
  category_id: null,
  category_name: null,
  note: null,
}

const creditTransaction = {
  id: 8,
  transaction_date: '2026-09-02',
  narration: 'Reimbursement',
  debit: null,
  credit: '20.00',
  category_id: 1,
  category_name: 'Groceries',
  note: 'from Sam',
}

function renderEditor(transaction, props = {}) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(
    <EditManualTransactionForm
      transaction={transaction}
      categories={categories}
      onClose={onClose}
      onSaved={onSaved}
      {...props}
    />
  )
  return { onClose, onSaved }
}

describe('EditManualTransactionForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prefills a debit transaction as Money out with a positive amount', () => {
    renderEditor(debitTransaction)

    expect(screen.getByLabelText('Date')).toHaveValue('2026-09-01')
    expect(screen.getByLabelText('Narration')).toHaveValue('Corner store')
    expect(screen.getByLabelText('Money out')).toBeChecked()
    expect(screen.getByLabelText('Amount')).toHaveValue(12.5)
  })

  it('prefills a credit transaction as Money in, with its category and note', () => {
    renderEditor(creditTransaction)

    expect(screen.getByLabelText('Money in')).toBeChecked()
    expect(screen.getByLabelText('Amount')).toHaveValue(20)
    expect(screen.getByLabelText('Edit transaction category')).toHaveValue('1')
    expect(screen.getByLabelText('Note (optional)')).toHaveValue('from Sam')
  })

  it('saves the edited fields via PUT', async () => {
    api.put.mockResolvedValue({ data: { id: 7 } })
    const { onSaved } = renderEditor(debitTransaction)

    fireEvent.change(screen.getByLabelText('Narration'), { target: { value: 'Corner store snacks' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '15.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/transactions/7', expect.objectContaining({
      transaction_date: '2026-09-01',
      narration: 'Corner store snacks',
      debit: '15.00',
      credit: null,
    })))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('switching direction sends the amount under the other field', async () => {
    api.put.mockResolvedValue({ data: {} })
    renderEditor(debitTransaction)

    fireEvent.click(screen.getByLabelText('Money in'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/transactions/7', expect.objectContaining({
      debit: null,
      credit: '12.50',
    })))
  })

  it('cancels without saving', () => {
    const { onClose } = renderEditor(debitTransaction)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalled()
    expect(api.put).not.toHaveBeenCalled()
  })

  it('closes on Escape', () => {
    const { onClose } = renderEditor(debitTransaction)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })

  it('shows the API error rather than closing on failure', async () => {
    api.put.mockRejectedValue({
      response: { data: { detail: "Manual transactions must be dated on or after this account's other latest transaction (2026-09-05)" } },
    })
    const { onSaved } = renderEditor(debitTransaction)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/on or after this account's other latest transaction/)).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
  })
})
