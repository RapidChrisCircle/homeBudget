import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import DashboardNarrative from './DashboardNarrative.jsx'

function baseReport(overrides = {}) {
  return {
    label: '2026-09',
    start_date: '2026-09-01',
    end_date: '2026-10-01',
    summary: { total_income: '5000.00', total_spending: '3240.00', net_saved: '1760.00' },
    budgets: [{ category_id: 1, difference: '-50.00' }],
    grid: { periods: [{ year: 2026, month: 8, label: '2026-08' }, { year: 2026, month: 9, label: '2026-09' }], rows: [] },
    uncategorized: { transaction_count: 100, uncategorized_count: 38, total_in: '0', total_out: '0', net_total: '0' },
    top_movers: [{ category_id: 2, category_name: 'Groceries', kind: 'expense', current: '500', prior: '100', delta: '400' }],
    has_prior_period_data: true,
    prior_summary: { total_income: '5000.00', total_spending: '2000.00', net_saved: '3000.00' },
    ...overrides,
  }
}

function renderNarrative(report) {
  return render(
    <MemoryRouter>
      <DashboardNarrative report={report} />
    </MemoryRouter>
  )
}

describe('DashboardNarrative', () => {
  it('renders the full sentence, with money through <Amount> and drill-downs as real links', () => {
    renderNarrative(baseReport())

    const narrative = document.querySelector('.dashboard-narrative')
    expect(narrative).toHaveTextContent("2026-09 — you've spent 3240.00")
    expect(narrative).toHaveTextContent('62.0% more than 2026-08')
    expect(narrative).toHaveTextContent('Groceries is the biggest change, up 400.00')
    expect(narrative).toHaveTextContent('1 category is over budget')
    expect(narrative).toHaveTextContent('38 transactions need a category')

    expect(screen.getByRole('link', { name: 'Groceries' })).toHaveAttribute(
      'href', '/transactions?category_id=2&date_from=2026-09-01&date_to=2026-09-30'
    )
    expect(screen.getByRole('link', { name: '1 category is over budget' })).toHaveAttribute('href', '/reports')
    expect(screen.getByRole('link', { name: '38 transactions need a category' })).toHaveAttribute(
      'href', '/transactions?uncategorized=true&date_from=2026-09-01&date_to=2026-09-30'
    )
  })

  it('renders just the total-spent sentence on the earliest month in the database', () => {
    renderNarrative(baseReport({
      has_prior_period_data: false,
      prior_summary: null,
      top_movers: [],
      budgets: [],
      uncategorized: { transaction_count: 5, uncategorized_count: 0, total_in: '0', total_out: '0', net_total: '0' },
    }))

    const narrative = document.querySelector('.dashboard-narrative')
    expect(narrative).toHaveTextContent("2026-09 — you've spent 3240.00.")
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
