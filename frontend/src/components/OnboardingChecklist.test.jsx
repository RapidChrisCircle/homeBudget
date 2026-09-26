import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OnboardingChecklist from './OnboardingChecklist.jsx'
import { api } from '../services/api'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
  },
}))

function mockLoad({ total = 0, accounts = [], categories = [] } = {}) {
  api.get.mockImplementation((path) => {
    if (path.startsWith('/transactions')) {
      return Promise.resolve({ data: { total } })
    }
    if (path === '/accounts') {
      return Promise.resolve({ data: accounts })
    }
    if (path === '/categories') {
      return Promise.resolve({ data: categories })
    }
    return Promise.reject(new Error(`unexpected path ${path}`))
  })
}

function renderChecklist() {
  return render(
    <MemoryRouter>
      <OnboardingChecklist />
    </MemoryRouter>
  )
}

describe('OnboardingChecklist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing before the data resolves', () => {
    mockLoad()

    const { container } = renderChecklist()

    expect(container).toBeEmptyDOMElement()
  })

  it('shows all four steps pending on a completely empty install', async () => {
    mockLoad()

    renderChecklist()

    await waitFor(() => expect(screen.getByText('Getting Started')).toBeInTheDocument())

    expect(screen.getByText('Import a bank statement')).toBeInTheDocument()
    expect(screen.getByText('Classify your accounts')).toBeInTheDocument()
    expect(screen.getByText('Set up your categories')).toBeInTheDocument()
    expect(screen.getByText('Set your budgets')).toBeInTheDocument()
    expect(screen.getAllByText('○')).toHaveLength(4)
  })

  it('marks import done once transactions exist', async () => {
    mockLoad({ total: 5 })

    renderChecklist()

    await waitFor(() => expect(screen.getByText('Getting Started')).toBeInTheDocument())

    const step = screen.getByText('Import a bank statement').closest('li')
    expect(step).toHaveClass('onboarding-step-done')
    expect(step.querySelector('a')).not.toBeInTheDocument()
  })

  it('does not mark accounts classified until every account has a type', async () => {
    mockLoad({
      total: 5,
      accounts: [{ id: 1, account_type: 'everyday' }, { id: 2, account_type: null }],
    })

    renderChecklist()

    await waitFor(() => expect(screen.getByText('Getting Started')).toBeInTheDocument())

    const step = screen.getByText('Classify your accounts').closest('li')
    expect(step).toHaveClass('onboarding-step-pending')
  })

  it('marks accounts classified once every account has a type', async () => {
    mockLoad({
      total: 5,
      accounts: [{ id: 1, account_type: 'everyday' }, { id: 2, account_type: 'credit_card' }],
    })

    renderChecklist()

    await waitFor(() => expect(screen.getByText('Getting Started')).toBeInTheDocument())

    const step = screen.getByText('Classify your accounts').closest('li')
    expect(step).toHaveClass('onboarding-step-done')
  })

  it('marks categories done once any category exists', async () => {
    mockLoad({ total: 5, categories: [{ id: 1, name: 'Groceries', budget_amount: null }] })

    renderChecklist()

    await waitFor(() => expect(screen.getByText('Getting Started')).toBeInTheDocument())

    expect(screen.getByText('Set up your categories').closest('li')).toHaveClass('onboarding-step-done')
    expect(screen.getByText('Set your budgets').closest('li')).toHaveClass('onboarding-step-pending')
  })

  it('marks budgets done once any category has a budget_amount', async () => {
    mockLoad({ total: 5, categories: [{ id: 1, name: 'Groceries', budget_amount: '400.00' }] })

    renderChecklist()

    await waitFor(() => expect(screen.getByText('Getting Started')).toBeInTheDocument())

    expect(screen.getByText('Set your budgets').closest('li')).toHaveClass('onboarding-step-done')
  })

  it('renders nothing once every step is complete', async () => {
    mockLoad({
      total: 5,
      accounts: [{ id: 1, account_type: 'everyday' }],
      categories: [{ id: 1, name: 'Groceries', budget_amount: '400.00' }],
    })

    const { container } = renderChecklist()

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/categories'))
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing if the data cannot be fetched', async () => {
    api.get.mockRejectedValue(new Error('network error'))

    const { container } = renderChecklist()

    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
