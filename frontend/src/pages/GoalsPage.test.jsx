import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../services/api'
import GoalsPage from './GoalsPage.jsx'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

const sampleAccount = { id: 1, name: 'Savings', account_type: 'savings', balance: '1500.00' }

const sampleGoal = {
  id: 1,
  name: 'Emergency Fund',
  target_amount: '5000.00',
  target_date: null,
  mode: 'account_balance',
  account_id: 1,
  account_name: 'Savings',
  allocated_amount: null,
  archived: false,
  current_amount: '1500.00',
  percent: '30',
  remaining: '3500.00',
  monthly_required: null,
}

function mockLoad({ goals = [sampleGoal], accountEnvelopeSummaries = [], accounts = [sampleAccount] } = {}) {
  api.get.mockImplementation((path) => {
    if (path.startsWith('/goals')) {
      return Promise.resolve({ data: { goals, account_envelope_summaries: accountEnvelopeSummaries } })
    }
    if (path === '/accounts') {
      return Promise.resolve({ data: accounts })
    }
    return Promise.reject(new Error(`unexpected path ${path}`))
  })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <GoalsPage />
    </MemoryRouter>
  )
}

function goalsSection() {
  return screen.getByText('Goals', { selector: 'button' }).closest('.card')
}

describe('GoalsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading then the goals table', async () => {
    mockLoad()

    renderPage()

    expect(screen.getByText('Loading goals...')).toBeInTheDocument()

    await waitFor(() => {
      expect(within(goalsSection()).getByText('Emergency Fund')).toBeInTheDocument()
    })
  })

  it('shows progress, remaining and the account name', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(within(goalsSection()).getByText('Emergency Fund')).toBeInTheDocument())

    const row = within(goalsSection()).getByText('Emergency Fund').closest('tr')
    expect(within(row).getByText('1500.00')).toBeInTheDocument()
    expect(within(row).getByText('5000.00')).toBeInTheDocument()
    expect(within(row).getByText('3500.00')).toBeInTheDocument()
    expect(within(row).getByText('30%', { exact: false })).toBeInTheDocument()
    expect(within(row).getByText('Savings')).toBeInTheDocument()
  })

  it('shows an em dash for monthly needed when there is no target date', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(within(goalsSection()).getByText('Emergency Fund')).toBeInTheDocument())

    const row = within(goalsSection()).getByText('Emergency Fund').closest('tr')
    expect(within(row).getByText('—')).toBeInTheDocument()
  })

  it('shows the monthly required figure when a target date is set', async () => {
    mockLoad({
      goals: [{ ...sampleGoal, target_date: '2027-01-01', monthly_required: '350.00' }],
    })

    renderPage()

    await waitFor(() => expect(within(goalsSection()).getByText('Emergency Fund')).toBeInTheDocument())

    const row = within(goalsSection()).getByText('Emergency Fund').closest('tr')
    expect(within(row).getByText('350.00')).toBeInTheDocument()
  })

  it('marks a goal that has met its target', async () => {
    mockLoad({
      goals: [{ ...sampleGoal, current_amount: '5000.00', remaining: '0.00', percent: '100' }],
    })

    renderPage()

    await waitFor(() => expect(within(goalsSection()).getByText('Emergency Fund')).toBeInTheDocument())

    expect(within(goalsSection()).getByText('met')).toBeInTheDocument()
  })

  it('shows an over-allocation warning naming the account and the shortfall', async () => {
    mockLoad({
      goals: [],
      accountEnvelopeSummaries: [{
        account_id: 1,
        account_name: 'Shared Savings',
        account_balance: '600.00',
        allocated_total: '800.00',
        over_allocated: true,
        over_allocated_by: '200.00',
      }],
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Over-allocated accounts')).toBeInTheDocument()
    })
    const section = screen.getByText('Over-allocated accounts').closest('.card')
    expect(within(section).getByText('Shared Savings')).toBeInTheDocument()
    expect(within(section).getByText('200.00')).toBeInTheDocument()
  })

  it('does not show the over-allocation card when nothing is over-allocated', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(within(goalsSection()).getByText('Emergency Fund')).toBeInTheDocument())

    expect(screen.queryByText('Over-allocated accounts')).not.toBeInTheDocument()
  })

  it('requires an allocated amount only in envelope mode', async () => {
    mockLoad({ goals: [] })

    renderPage()

    await waitFor(() => expect(screen.queryByText('Loading goals...')).not.toBeInTheDocument())

    expect(screen.queryByLabelText('Allocated so far')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Tracking method'), { target: { value: 'envelope' } })

    expect(screen.getByLabelText('Allocated so far')).toBeInTheDocument()
  })

  it('submits the create form for an account_balance goal', async () => {
    mockLoad({ goals: [] })
    api.post.mockResolvedValue({ data: sampleGoal })

    renderPage()

    await waitFor(() => expect(screen.queryByText('Loading goals...')).not.toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Emergency Fund' } })
    fireEvent.change(screen.getByLabelText('Target amount'), { target: { value: '5000' } })
    fireEvent.change(screen.getByLabelText('Account'), { target: { value: '1' } })

    const addButtons = screen.getAllByRole('button', { name: 'Add Goal' })
    fireEvent.click(addButtons[addButtons.length - 1])

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/goals', expect.objectContaining({
        name: 'Emergency Fund',
        target_amount: '5000',
        mode: 'account_balance',
        account_id: 1,
        allocated_amount: null,
      }))
    })
  })

  it('archives a goal', async () => {
    mockLoad()
    api.post.mockResolvedValue({ data: { ...sampleGoal, archived: true } })

    renderPage()

    await waitFor(() => expect(within(goalsSection()).getByText('Emergency Fund')).toBeInTheDocument())

    fireEvent.click(within(goalsSection()).getByRole('button', { name: 'Archive' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/goals/1/archive')
    })
  })

  it('lists an archived goal separately and restores it', async () => {
    mockLoad({ goals: [{ ...sampleGoal, archived: true }] })
    api.post.mockResolvedValue({ data: { ...sampleGoal, archived: false } })

    renderPage()

    const archivedSection = await waitFor(() => screen.getByText('Archived').closest('.card'))
    expect(within(archivedSection).getByText('Emergency Fund')).toBeInTheDocument()
    expect(within(goalsSection()).queryByText('Emergency Fund')).not.toBeInTheDocument()

    fireEvent.click(within(archivedSection).getByRole('button', { name: 'Restore' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/goals/1/restore')
    })
  })

  it('deletes a goal when confirmed', async () => {
    mockLoad()
    api.delete.mockResolvedValue({})
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderPage()

    await waitFor(() => expect(within(goalsSection()).getByText('Emergency Fund')).toBeInTheDocument())

    fireEvent.click(within(goalsSection()).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/goals/1')
    })
  })

  it('shows an error message when loading fails', async () => {
    api.get.mockRejectedValue({ response: { data: { detail: 'Server error' } } })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/Server error/)).toBeInTheDocument()
    })
  })

  // --- Sorting --------------------------------------------------------------

  it('sorts the Goals table by Name', async () => {
    const zebra = { ...sampleGoal, id: 2, name: 'Zebra Goal' }
    const apple = { ...sampleGoal, id: 3, name: 'Apple Goal' }
    mockLoad({ goals: [zebra, apple] })

    renderPage()

    await waitFor(() => expect(within(goalsSection()).getByText('Zebra Goal')).toBeInTheDocument())

    fireEvent.click(within(goalsSection()).getByRole('button', { name: 'Name' }))

    const rows = goalsSection().querySelectorAll('tbody tr')
    expect(within(rows[0]).getByText('Apple Goal')).toBeInTheDocument()
  })

  it('sorts the Archived table by Name', async () => {
    const zebra = { ...sampleGoal, id: 2, name: 'Zebra Archived', archived: true }
    const apple = { ...sampleGoal, id: 3, name: 'Apple Archived', archived: true }
    mockLoad({ goals: [zebra, apple] })

    renderPage()

    const archivedSection = await waitFor(() => screen.getByText('Archived').closest('.card'))
    await waitFor(() => expect(within(archivedSection).getByText('Zebra Archived')).toBeInTheDocument())

    fireEvent.click(within(archivedSection).getByRole('button', { name: 'Name' }))

    const rows = archivedSection.querySelectorAll('tbody tr')
    expect(within(rows[0]).getByText('Apple Archived')).toBeInTheDocument()
  })
})
