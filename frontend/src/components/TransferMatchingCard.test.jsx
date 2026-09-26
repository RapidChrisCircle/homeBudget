import { render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TransferMatchingCard from './TransferMatchingCard.jsx'
import { api } from '../services/api'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
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

    render(<TransferMatchingCard />)
    await waitForLoaded()

    expect(within(section()).getByText(/looks correctly matched/)).toBeInTheDocument()
  })

  it('does not list a matched pair that is already fully categorized as a transfer', async () => {
    mockLoad({
      matches: [{
        leg_a_id: 1, leg_a_account_id: 1, leg_a_account_name: 'Everyday', leg_a_date: '2026-01-05',
        leg_b_id: 2, leg_b_account_id: 2, leg_b_account_name: 'Savings', leg_b_date: '2026-01-05',
        amount: '200.00', both_categorized_as_transfer: true,
      }],
      unmatched: [],
    })

    render(<TransferMatchingCard />)
    await waitForLoaded()

    expect(within(section()).queryByText(/isn.t fully categorized/)).not.toBeInTheDocument()
    expect(within(section()).getByText(/looks correctly matched/)).toBeInTheDocument()
  })

  it('lists a matched pair with mismatched categorization', async () => {
    mockLoad({
      matches: [{
        leg_a_id: 1, leg_a_account_id: 1, leg_a_account_name: 'Everyday', leg_a_date: '2026-01-05',
        leg_b_id: 2, leg_b_account_id: 2, leg_b_account_name: 'Savings', leg_b_date: '2026-01-06',
        amount: '200.00', both_categorized_as_transfer: false,
      }],
      unmatched: [],
    })

    render(<TransferMatchingCard />)
    await waitForLoaded()

    const scoped = within(section())
    expect(scoped.getByText(/isn.t fully categorized/)).toBeInTheDocument()
    expect(scoped.getByText(/Everyday/)).toBeInTheDocument()
    expect(scoped.getByText(/Savings/)).toBeInTheDocument()
    expect(scoped.getByText('200.00')).toBeInTheDocument()
  })

  it('lists an unmatched transfer leg', async () => {
    mockLoad({
      matches: [],
      unmatched: [{
        transaction_id: 5, account_id: 1, account_name: 'Everyday', transaction_date: '2026-01-05',
        narration: 'Lonely Transfer', amount: '-300.00',
      }],
    })

    render(<TransferMatchingCard />)
    await waitForLoaded()

    const scoped = within(section())
    expect(scoped.getByText('Unmatched transfers')).toBeInTheDocument()
    expect(scoped.getByText('Lonely Transfer')).toBeInTheDocument()
    expect(scoped.getByText('-300.00')).toBeInTheDocument()
  })

  it('shows an error state when the request fails', async () => {
    api.get.mockRejectedValue({ response: { data: { detail: 'Boom' } } })

    render(<TransferMatchingCard />)
    await waitForLoaded()

    expect(within(section()).getByText(/Boom/)).toBeInTheDocument()
  })
})
