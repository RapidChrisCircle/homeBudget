import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../services/api'
import AlertsPage from './AlertsPage.jsx'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

const overBudgetAlert = {
  key: 'over_budget:1:2026:7',
  kind: 'over_budget',
  title: 'Groceries is over budget',
  detail: '2026-07',
  amount: '50.00',
  link: '/reports',
  dismiss_kind: 'generic',
  recurring_account_id: null,
  recurring_narration_key: null,
}

const missedRecurringAlert = {
  key: 'missed_recurring:1:NETFLIX',
  kind: 'missed_recurring',
  title: 'Netflix looks stopped',
  detail: 'Joint Everyday - last seen 2026-01-15',
  amount: '15.99',
  link: '/recurring',
  dismiss_kind: 'recurring',
  recurring_account_id: 1,
  recurring_narration_key: 'NETFLIX',
}

function mockLoad(alerts) {
  api.get.mockImplementation((path) => {
    if (path === '/alerts') {
      return Promise.resolve({ data: { alerts, count: alerts.length } })
    }
    return Promise.reject(new Error(`unexpected path ${path}`))
  })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AlertsPage />
    </MemoryRouter>
  )
}

async function waitForLoaded() {
  await waitFor(() => expect(screen.queryByText('Loading alerts...')).not.toBeInTheDocument())
}

describe('AlertsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a reassurance message when there are no alerts', async () => {
    mockLoad([])

    renderPage()
    await waitForLoaded()

    expect(screen.getByText('Nothing needs attention right now.')).toBeInTheDocument()
  })

  it('lists an alert with its title, detail and amount', async () => {
    mockLoad([overBudgetAlert])

    renderPage()
    await waitForLoaded()

    expect(screen.getByText('Groceries is over budget')).toBeInTheDocument()
    expect(screen.getByText('2026-07')).toBeInTheDocument()
    expect(screen.getByText('50.00')).toBeInTheDocument()
  })

  it('links the title to the alert\'s own page', async () => {
    mockLoad([overBudgetAlert])

    renderPage()
    await waitForLoaded()

    expect(screen.getByRole('link', { name: 'Groceries is over budget' })).toHaveAttribute('href', '/reports')
  })

  it('dismisses a generic alert via POST /alerts/dismissals', async () => {
    mockLoad([overBudgetAlert])
    api.post.mockResolvedValue({ data: { id: 1, alert_key: overBudgetAlert.key } })

    renderPage()
    await waitForLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/alerts/dismissals', { alert_key: overBudgetAlert.key })
    })
  })

  it('dismisses a recurring-sourced alert via the existing POST /recurring/dismissals', async () => {
    mockLoad([missedRecurringAlert])
    api.post.mockResolvedValue({ data: {} })

    renderPage()
    await waitForLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/recurring/dismissals', { account_id: 1, narration_key: 'NETFLIX' })
    })
  })

  it('shows an error when dismissing fails', async () => {
    mockLoad([overBudgetAlert])
    api.post.mockRejectedValue({ response: { data: { detail: 'Dismiss failed badly' } } })

    renderPage()
    await waitForLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    await waitFor(() => {
      expect(screen.getByText(/Dismiss failed badly/)).toBeInTheDocument()
    })
  })

  it('shows an error state when loading fails', async () => {
    api.get.mockRejectedValue({ response: { data: { detail: 'Boom' } } })

    renderPage()
    await waitForLoaded()

    expect(screen.getByText(/Boom/)).toBeInTheDocument()
  })

  it('shows the kind label for each alert', async () => {
    mockLoad([overBudgetAlert, missedRecurringAlert])

    renderPage()
    await waitForLoaded()

    const rows = screen.getAllByRole('row')
    expect(within(rows[1]).getByText('Over budget')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Missed / stopped')).toBeInTheDocument()
  })
})
