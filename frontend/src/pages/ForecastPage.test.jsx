import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../services/api'
import ForecastPage from './ForecastPage.jsx'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

const sampleCategories = [
  { id: 1, name: 'Groceries', kind: 'expense' },
  { id: 2, name: 'Fuel', kind: 'expense' },
]

function month(label, isPartial, opening, recurringIn, recurringOut, other, closing) {
  return {
    label,
    is_partial: isPartial,
    opening: String(opening),
    recurring_in: String(recurringIn),
    recurring_out: String(recurringOut),
    estimated_other: String(other),
    closing: String(closing),
  }
}

const sampleForecast = {
  as_of: '2026-04-10',
  periods: [
    { year: 2026, month: 4, label: '2026-04', is_partial: true },
    { year: 2026, month: 5, label: '2026-05', is_partial: false },
  ],
  accounts: [
    {
      account_id: 1,
      account_name: 'Joint Everyday',
      opening_balance: '1000.00',
      daily_run_rate: '-10.00',
      months: [
        month('2026-04', true, 1000.00, 0, 50.00, -200.00, 750.00),
        month('2026-05', false, 750.00, 3000.00, 500.00, -300.00, 2950.00),
      ],
    },
  ],
  combined: {
    opening_balance: '1000.00',
    months: [
      month('2026-04', true, 1000.00, 0, 50.00, -200.00, 750.00),
      month('2026-05', false, 750.00, 3000.00, 500.00, -300.00, 2950.00),
    ],
  },
  upcoming: [
    { due_date: '2026-04-15', account_id: 1, narration_key: 'RED ENERGY', merchant: 'RED ENERGY', amount: '50.00', direction: 'outflow' },
    { due_date: '2026-05-01', account_id: 1, narration_key: 'SALARY', merchant: 'SALARY', amount: '3000.00', direction: 'inflow' },
  ],
}

function mockLoad(overrides = {}, categories = sampleCategories) {
  api.get.mockImplementation((path) => {
    if (path === '/categories') {
      return Promise.resolve({ data: categories })
    }
    if (path.startsWith('/forecast')) {
      return Promise.resolve({ data: { ...sampleForecast, ...overrides } })
    }
    return Promise.reject(new Error(`unexpected path ${path}`))
  })
}

describe('ForecastPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading then the chart and per-account table once data resolves', async () => {
    mockLoad()

    render(<ForecastPage />)

    expect(screen.getByText('Loading forecast...')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Projected Closing Balance')).toBeInTheDocument()
    })
    expect(screen.getByRole('heading', { name: 'Joint Everyday' })).toBeInTheDocument()
    expect(screen.getByText(/2026-04 \(partial\)/)).toBeInTheDocument()
    expect(screen.queryByText(/2026-05 \(partial\)/)).not.toBeInTheDocument()
  })

  it('captions the projection with the as-of date', async () => {
    mockLoad()

    render(<ForecastPage />)

    await waitFor(() => {
      expect(screen.getByText(/Projected from transactions imported up to 2026-04-10/)).toBeInTheDocument()
    })
  })

  it('lists upcoming commitments with direction', async () => {
    mockLoad()

    render(<ForecastPage />)

    await waitFor(() => expect(screen.getByText('Upcoming Commitments')).toBeInTheDocument())

    expect(screen.getByText('RED ENERGY')).toBeInTheDocument()
    expect(screen.getByText('SALARY')).toBeInTheDocument()
    expect(screen.getByText('Out')).toBeInTheDocument()
    expect(screen.getByText('In')).toBeInTheDocument()
  })

  it('shows the estimated daily run rate per account', async () => {
    mockLoad()

    render(<ForecastPage />)

    // "Estimated daily run rate: " and the amount are separate DOM nodes
    // now that the amount renders via <Amount>, so match on the paragraph's
    // full text content rather than a single text node.
    await waitFor(() => {
      expect(
        screen.getByText((_, el) => el?.tagName === 'P' && el.textContent.includes('Estimated daily run rate') && el.textContent.includes('-10.00'))
      ).toBeInTheDocument()
    })
  })

  it('shows an empty state on a fresh ledger', async () => {
    mockLoad({ as_of: null, accounts: [], combined: null, upcoming: [] })

    render(<ForecastPage />)

    await waitFor(() => {
      expect(screen.getByText(/Not enough history yet/)).toBeInTheDocument()
    })
  })

  it('shows an error message when the request fails', async () => {
    api.get.mockRejectedValue({ response: { data: { detail: 'database unavailable' } } })

    render(<ForecastPage />)

    await waitFor(() => {
      expect(screen.getByText(/database unavailable/)).toBeInTheDocument()
    })
  })

  it('sorts Upcoming Commitments by Merchant', async () => {
    mockLoad()

    render(<ForecastPage />)

    await waitFor(() => expect(screen.getByText('RED ENERGY')).toBeInTheDocument())

    const card = screen.getByText('Upcoming Commitments').closest('.card')
    fireEvent.click(within(card).getByRole('button', { name: 'Merchant' }))

    const rows = card.querySelectorAll('tbody tr')
    expect(rows[0]).toHaveTextContent('RED ENERGY') // R < S ascending
  })

  it('does not make the per-account monthly table sortable - Month is a chronological projection', async () => {
    mockLoad()

    render(<ForecastPage />)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Joint Everyday' })).toBeInTheDocument())

    const accountCard = screen.getByRole('heading', { name: 'Joint Everyday' }).closest('.card')
    expect(within(accountCard).queryByRole('button', { name: 'Month' })).not.toBeInTheDocument()
    expect(accountCard.querySelector('.sortable-header')).toBeNull()
  })
})

describe('ForecastPage scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function scenariosCard() {
    return screen.getByText('Scenarios').closest('.card')
  }

  it('lists each unique upcoming commitment once as a stop-it checkbox', async () => {
    mockLoad()

    render(<ForecastPage />)

    await waitFor(() => expect(screen.getByText('Scenarios')).toBeInTheDocument())

    const card = scenariosCard()
    expect(within(card).getByLabelText(/RED ENERGY/)).toBeInTheDocument()
    expect(within(card).getByLabelText(/SALARY/)).toBeInTheDocument()
  })

  it('disables Run scenario until something is actually selected', async () => {
    mockLoad()

    render(<ForecastPage />)

    await waitFor(() => expect(screen.getByText('Scenarios')).toBeInTheDocument())

    expect(within(scenariosCard()).getByRole('button', { name: 'Run scenario' })).toBeDisabled()
  })

  it('runs a stop-this-subscription scenario and shows the comparison', async () => {
    mockLoad()
    const scenarioResult = {
      ...sampleForecast,
      combined: {
        opening_balance: '1000.00',
        months: sampleForecast.combined.months.map((m) => ({ ...m, closing: '3200.00' })),
      },
    }
    api.post.mockResolvedValue({ data: scenarioResult })

    render(<ForecastPage />)
    await waitFor(() => expect(screen.getByText('Scenarios')).toBeInTheDocument())

    const card = scenariosCard()
    fireEvent.click(within(card).getByLabelText(/RED ENERGY/))
    fireEvent.click(within(card).getByRole('button', { name: 'Run scenario' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/forecast/scenario', {
        months: 3,
        stopped_series: [{ account_id: 1, narration_key: 'RED ENERGY' }],
        category_adjustments: [],
      })
    })
    await waitFor(() => expect(within(card).getAllByText(/3200.00/).length).toBeGreaterThan(0))
    expect(within(card).getByRole('button', { name: 'Clear scenario' })).toBeInTheDocument()
  })

  it('runs a category-adjustment scenario', async () => {
    mockLoad()
    api.post.mockResolvedValue({ data: sampleForecast })

    render(<ForecastPage />)
    await waitFor(() => expect(screen.getByText('Scenarios')).toBeInTheDocument())

    const card = scenariosCard()
    fireEvent.click(within(card).getByRole('button', { name: '+ Add adjustment' }))
    fireEvent.change(within(card).getByLabelText('Category to adjust'), { target: { value: '1' } })
    fireEvent.change(within(card).getByLabelText('Percent change'), { target: { value: '-20' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Run scenario' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/forecast/scenario', {
        months: 3,
        stopped_series: [],
        category_adjustments: [{ category_id: 1, percent: '-20' }],
      })
    })
  })

  it('removes an adjustment row', async () => {
    mockLoad()

    render(<ForecastPage />)
    await waitFor(() => expect(screen.getByText('Scenarios')).toBeInTheDocument())

    const card = scenariosCard()
    fireEvent.click(within(card).getByRole('button', { name: '+ Add adjustment' }))
    expect(within(card).getByLabelText('Category to adjust')).toBeInTheDocument()

    fireEvent.click(within(card).getByRole('button', { name: 'Remove this adjustment' }))

    expect(within(card).queryByLabelText('Category to adjust')).not.toBeInTheDocument()
  })

  it('clears the scenario and reverts to the baseline chart', async () => {
    mockLoad()
    api.post.mockResolvedValue({ data: sampleForecast })

    render(<ForecastPage />)
    await waitFor(() => expect(screen.getByText('Scenarios')).toBeInTheDocument())

    const card = scenariosCard()
    fireEvent.click(within(card).getByLabelText(/RED ENERGY/))
    fireEvent.click(within(card).getByRole('button', { name: 'Run scenario' }))

    await waitFor(() => expect(within(card).getByRole('button', { name: 'Clear scenario' })).toBeInTheDocument())

    fireEvent.click(within(card).getByRole('button', { name: 'Clear scenario' }))

    expect(within(card).queryByRole('button', { name: 'Clear scenario' })).not.toBeInTheDocument()
    expect(within(card).getByLabelText(/RED ENERGY/)).not.toBeChecked()
  })

  it('shows an error when the scenario request fails', async () => {
    mockLoad()
    api.post.mockRejectedValue({ response: { data: { detail: 'Unknown category id(s)' } } })

    render(<ForecastPage />)
    await waitFor(() => expect(screen.getByText('Scenarios')).toBeInTheDocument())

    const card = scenariosCard()
    fireEvent.click(within(card).getByLabelText(/RED ENERGY/))
    fireEvent.click(within(card).getByRole('button', { name: 'Run scenario' }))

    await waitFor(() => {
      expect(within(card).getByText(/Unknown category id\(s\)/)).toBeInTheDocument()
    })
  })
})
