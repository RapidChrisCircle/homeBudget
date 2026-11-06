import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TransferMatchingCard from './TransferMatchingCard.jsx'
import { api } from '../services/api'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}))

function mockLoad(data) {
  api.get.mockImplementation((path) => {
    if (path === '/transfers') {
      return Promise.resolve({ data })
    }
    return Promise.reject(new Error(`unexpected path ${path}`))
  })
}

function renderCard() {
  return render(
    <MemoryRouter>
      <TransferMatchingCard />
    </MemoryRouter>
  )
}

function section() {
  return screen.getByText('Transfer Matching').closest('.card')
}

async function waitForLoaded() {
  await waitFor(() => expect(screen.queryByText('Loading transfer matches...')).not.toBeInTheDocument())
}

describe('TransferMatchingCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a reassurance message when everything matches and is categorized', async () => {
    mockLoad({ matches: [], unmatched: [] })

    renderCard()
    await waitForLoaded()

    expect(within(section()).getByText(/looks correctly matched/)).toBeInTheDocument()
  })

  it('does not list a matched pair that is already fully categorized as a transfer', async () => {
    mockLoad({
      matches: [{
        leg_a_id: 1, leg_a_account_id: 1, leg_a_account_name: 'Everyday', leg_a_date: '2026-01-05',
        leg_a_category_name: 'Card Payment', leg_a_is_transfer: true,
        leg_b_id: 2, leg_b_account_id: 2, leg_b_account_name: 'Savings', leg_b_date: '2026-01-05',
        leg_b_category_name: 'Card Payment', leg_b_is_transfer: true,
        amount: '200.00', both_categorized_as_transfer: true,
      }],
      unmatched: [],
    })

    renderCard()
    await waitForLoaded()

    expect(within(section()).queryByText(/isn.t fully categorized/)).not.toBeInTheDocument()
    expect(within(section()).getByText(/looks correctly matched/)).toBeInTheDocument()
  })

  it('lists a matched pair with mismatched categorization, badging the offending leg', async () => {
    mockLoad({
      matches: [{
        leg_a_id: 1, leg_a_account_id: 1, leg_a_account_name: 'Everyday', leg_a_date: '2026-01-05',
        leg_a_category_name: 'Groceries', leg_a_is_transfer: false,
        leg_b_id: 2, leg_b_account_id: 2, leg_b_account_name: 'Savings', leg_b_date: '2026-01-06',
        leg_b_category_name: 'Card Payment', leg_b_is_transfer: true,
        amount: '200.00', both_categorized_as_transfer: false,
      }],
      unmatched: [],
    })

    renderCard()
    await waitForLoaded()

    const scoped = within(section())
    expect(scoped.getByText(/isn.t fully categorized/)).toBeInTheDocument()
    expect(scoped.getByText(/Everyday/)).toBeInTheDocument()
    expect(scoped.getByText(/Savings/)).toBeInTheDocument()
    expect(scoped.getByText('200.00')).toBeInTheDocument()
    // Leg A (Groceries, not a transfer) is flagged; Leg B (already a
    // transfer) is not.
    expect(scoped.getByText('Groceries')).toBeInTheDocument()
    expect(scoped.queryByText('Card Payment')).not.toBeInTheDocument()
  })

  it('badges an uncategorized offending leg as "Uncategorized", not blank', async () => {
    mockLoad({
      matches: [{
        leg_a_id: 1, leg_a_account_id: 1, leg_a_account_name: 'Everyday', leg_a_date: '2026-01-05',
        leg_a_category_name: null, leg_a_is_transfer: false,
        leg_b_id: 2, leg_b_account_id: 2, leg_b_account_name: 'Savings', leg_b_date: '2026-01-05',
        leg_b_category_name: 'Card Payment', leg_b_is_transfer: true,
        amount: '200.00', both_categorized_as_transfer: false,
      }],
      unmatched: [],
    })

    renderCard()
    await waitForLoaded()

    expect(within(section()).getByText('Uncategorized')).toBeInTheDocument()
  })

  it('links a mismatched pair into the ledger scoped to exactly its two transactions', async () => {
    mockLoad({
      matches: [{
        leg_a_id: 11, leg_a_account_id: 1, leg_a_account_name: 'Everyday', leg_a_date: '2026-01-05',
        leg_a_category_name: 'Groceries', leg_a_is_transfer: false,
        leg_b_id: 22, leg_b_account_id: 2, leg_b_account_name: 'Savings', leg_b_date: '2026-01-06',
        leg_b_category_name: 'Card Payment', leg_b_is_transfer: true,
        amount: '200.00', both_categorized_as_transfer: false,
      }],
      unmatched: [],
    })

    renderCard()
    await waitForLoaded()

    expect(within(section()).getByRole('link', { name: 'View in ledger' })).toHaveAttribute(
      'href', '/transactions?transaction_ids=11&transaction_ids=22'
    )
  })

  it('lists an unmatched transfer leg', async () => {
    mockLoad({
      matches: [],
      unmatched: [{
        transaction_id: 5, account_id: 1, account_name: 'Everyday', transaction_date: '2026-01-05',
        narration: 'Lonely Transfer', amount: '-300.00',
      }],
    })

    renderCard()
    await waitForLoaded()

    const scoped = within(section())
    expect(scoped.getByText('Unmatched transfers')).toBeInTheDocument()
    expect(scoped.getByText('Lonely Transfer')).toBeInTheDocument()
    expect(scoped.getByText('-300.00')).toBeInTheDocument()
  })

  it('links an unmatched leg into the ledger scoped to just that transaction', async () => {
    mockLoad({
      matches: [],
      unmatched: [{
        transaction_id: 5, account_id: 1, account_name: 'Everyday', transaction_date: '2026-01-05',
        narration: 'Lonely Transfer', amount: '-300.00',
      }],
    })

    renderCard()
    await waitForLoaded()

    expect(within(section()).getByRole('link', { name: 'View in ledger' })).toHaveAttribute(
      'href', '/transactions?transaction_ids=5'
    )
  })

  it('shows an error state when the request fails', async () => {
    api.get.mockRejectedValue({ response: { data: { detail: 'Boom' } } })

    renderCard()
    await waitForLoaded()

    expect(within(section()).getByText(/Boom/)).toBeInTheDocument()
  })

  it('allows acknowledging a mismatched pair and hides it from the screen', async () => {
    mockLoad({
      matches: [{
        leg_a_id: 1, leg_a_account_id: 1, leg_a_account_name: 'Everyday', leg_a_date: '2026-01-05',
        leg_a_category_name: 'Groceries', leg_a_is_transfer: false,
        leg_b_id: 2, leg_b_account_id: 2, leg_b_account_name: 'Savings', leg_b_date: '2026-01-06',
        leg_b_category_name: 'Card Payment', leg_b_is_transfer: true,
        amount: '200.00', both_categorized_as_transfer: false,
      }],
      unmatched: [],
    })
    api.post.mockResolvedValue({ data: { id: 1, key: 'pair:1:2' } })

    renderCard()
    await waitForLoaded()

    expect(within(section()).getByText(/Everyday/)).toBeInTheDocument()
    expect(within(section()).getByText('Groceries')).toBeInTheDocument()

    const ackButton = within(section()).getByRole('button', { name: 'Acknowledge' })
    fireEvent.click(ackButton)

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/transfers/acknowledge', { leg_a_id: 1, leg_b_id: 2 })
    })

    // Hidden from the active table and shows feedback message
    await waitFor(() => {
      expect(within(section()).queryByText('Groceries')).not.toBeInTheDocument()
    })
    expect(within(section()).getByText(/Transfer match acknowledged and hidden/)).toBeInTheDocument()

    // Can toggle acknowledged transfers
    const toggleButton = within(section()).getByRole('button', { name: /Show acknowledged transfers/ })
    expect(toggleButton).toBeInTheDocument()
    fireEvent.click(toggleButton)

    expect(within(section()).getByText('Acknowledged transfer pairs')).toBeInTheDocument()
    expect(within(section()).getByRole('button', { name: 'Restore' })).toBeInTheDocument()
  })

  it('allows editing narration on an unmatched transfer', async () => {
    mockLoad({
      matches: [],
      unmatched: [{
        transaction_id: 42, account_id: 1, account_name: 'Everyday', transaction_date: '2026-01-05',
        narration: 'Vague TFR', amount: '-100.00',
      }],
    })
    api.patch.mockResolvedValue({ data: { id: 42, narration: 'Transfer to partner for dinner' } })

    renderCard()
    await waitForLoaded()

    expect(within(section()).getByText('Vague TFR')).toBeInTheDocument()

    const editButton = within(section()).getByRole('button', { name: 'Edit narration for Vague TFR' })
    fireEvent.click(editButton)

    const input = within(section()).getByLabelText('Edit narration')
    expect(input.value).toBe('Vague TFR')

    fireEvent.change(input, { target: { value: 'Transfer to partner for dinner' } })
    const saveButton = within(section()).getByRole('button', { name: 'Save' })
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/transactions/42/narration', {
        narration: 'Transfer to partner for dinner',
      })
    })

    await waitFor(() => {
      expect(within(section()).getByText('Transfer to partner for dinner')).toBeInTheDocument()
    })
    expect(within(section()).getByText('Narration updated.')).toBeInTheDocument()
  })

  it('allows acknowledging an unmatched transfer and hides it from the screen', async () => {
    mockLoad({
      matches: [],
      unmatched: [{
        transaction_id: 99, account_id: 1, account_name: 'Everyday', transaction_date: '2026-01-05',
        narration: 'Old Account Transfer', amount: '-50.00',
      }],
    })
    api.post.mockResolvedValue({ data: { id: 2, key: 'unmatched:99' } })

    renderCard()
    await waitForLoaded()

    expect(within(section()).getByText('Old Account Transfer')).toBeInTheDocument()

    const ackButton = within(section()).getByRole('button', { name: 'Acknowledge' })
    fireEvent.click(ackButton)

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/transfers/acknowledge', { transaction_id: 99 })
    })

    await waitFor(() => {
      expect(within(section()).queryByText('Old Account Transfer')).not.toBeInTheDocument()
    })
    expect(within(section()).getByText(/Unmatched transfer acknowledged and hidden/)).toBeInTheDocument()
  })
})
