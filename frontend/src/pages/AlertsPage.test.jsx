import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetAlertsCountForTests, getAlertsCount } from '../services/alertsCount.ts'
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
    _resetAlertsCountForTests()
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

  it('groups alerts into one section per kind, with a heading naming each', async () => {
    mockLoad([overBudgetAlert, missedRecurringAlert])

    renderPage()
    await waitForLoaded()

    expect(screen.getByRole('heading', { name: /Over budget \(1\)/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Missed \/ stopped \(1\)/ })).toBeInTheDocument()
  })

  it('shows an explanation of what a kind means and how to resolve it, once per section', async () => {
    mockLoad([overBudgetAlert])

    renderPage()
    await waitForLoaded()

    expect(screen.getByText(/passed its budget for the month/)).toBeInTheDocument()
  })

  it('dismisses just one group via POST /alerts/dismissals/all with that kind', async () => {
    mockLoad([overBudgetAlert, missedRecurringAlert])
    api.post.mockResolvedValue({ data: { dismissed_count: 1 } })

    renderPage()
    await waitForLoaded()

    const overBudgetSection = screen.getByRole('heading', { name: /Over budget/ }).closest('.alerts-group')
    fireEvent.click(within(overBudgetSection).getByRole('button', { name: 'Dismiss these 1' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/alerts/dismissals/all', { kind: 'over_budget' })
    })
  })

  it('confirms before dismissing everything, and does nothing if declined', async () => {
    mockLoad([overBudgetAlert, missedRecurringAlert])
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    renderPage()
    await waitForLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss all' }))

    expect(window.confirm).toHaveBeenCalled()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('dismisses everything via POST /alerts/dismissals/all with no kind, once confirmed', async () => {
    mockLoad([overBudgetAlert, missedRecurringAlert])
    api.post.mockResolvedValue({ data: { dismissed_count: 2 } })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderPage()
    await waitForLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss all' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/alerts/dismissals/all', {})
    })
  })

  it('disables Dismiss all when there is nothing to dismiss', async () => {
    mockLoad([])

    renderPage()
    await waitForLoaded()

    expect(screen.getByRole('button', { name: 'Dismiss all' })).toBeDisabled()
  })

  it('updates the shared alerts-count store after a dismissal, so the nav badge never goes stale', async () => {
    mockLoad([overBudgetAlert])
    api.post.mockResolvedValue({ data: {} })
    // The refresh after dismissing answers with the NEW, lower count.
    api.get.mockImplementation((path) => {
      if (path !== '/alerts') return Promise.reject(new Error(`unexpected path ${path}`))
      const remaining = api.get.mock.calls.length > 1 ? [] : [overBudgetAlert]
      return Promise.resolve({ data: { alerts: remaining, count: remaining.length } })
    })

    renderPage()
    await waitForLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    await waitFor(() => expect(getAlertsCount()).toBe(0))
  })
})
