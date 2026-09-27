import { describe, expect, it } from 'vitest'
import { buildNarrative } from './narrative.js'

function baseReport(overrides = {}) {
  return {
    label: '2026-09',
    start_date: '2026-09-01',
    end_date: '2026-10-01',
    summary: { total_income: '5000.00', total_spending: '3240.00', net_saved: '1760.00' },
    budgets: [],
    grid: { periods: [{ year: 2026, month: 8, label: '2026-08' }, { year: 2026, month: 9, label: '2026-09' }], rows: [] },
    uncategorized: { transaction_count: 100, uncategorized_count: 0, total_in: '0', total_out: '0', net_total: '0' },
    top_movers: [],
    has_prior_period_data: false,
    prior_summary: null,
    ...overrides,
  }
}

function joinText(segments) {
  return segments.map((s) => (s.type === 'link' ? s.text : s.type === 'percent' ? s.value : s.type === 'text' ? s.text : String(s.value))).join('')
}

describe('buildNarrative', () => {
  it('always leads with the period label and total spent', () => {
    const segments = buildNarrative(baseReport())

    expect(segments[0]).toEqual({ type: 'text', text: "2026-09 — you've spent " })
    expect(segments[1]).toEqual({ type: 'amount', value: '3240.00' })
  })

  it('omits the comparison clause entirely when there is no prior period data', () => {
    const segments = buildNarrative(baseReport({ has_prior_period_data: false }))

    expect(joinText(segments)).toBe("2026-09 — you've spent 3240.00.")
  })

  it('states a percentage increase against a real prior month', () => {
    const report = baseReport({
      has_prior_period_data: true,
      prior_summary: { total_income: '5000.00', total_spending: '2000.00', net_saved: '3000.00' },
    })

    const text = joinText(buildNarrative(report))
    expect(text).toContain('62.0% more than 2026-08')
  })

  it('states a percentage decrease when spending fell', () => {
    const report = baseReport({
      has_prior_period_data: true,
      summary: { total_income: '5000.00', total_spending: '1000.00', net_saved: '4000.00' },
      prior_summary: { total_income: '5000.00', total_spending: '2000.00', net_saved: '3000.00' },
    })

    expect(joinText(buildNarrative(report))).toContain('50.0% less than 2026-08')
  })

  it('says "up from $0.00" rather than a percentage when the prior month was a real, genuine zero', () => {
    const report = baseReport({
      has_prior_period_data: true,
      prior_summary: { total_income: '0', total_spending: '0.00', net_saved: '0' },
    })

    const text = joinText(buildNarrative(report))
    expect(text).toContain('up from 0.00 in 2026-08')
    expect(text).not.toContain('%')
  })

  it('shows only the period sentence when spending is unchanged from a real zero prior month', () => {
    const report = baseReport({
      has_prior_period_data: true,
      summary: { total_income: '0', total_spending: '0.00', net_saved: '0' },
      prior_summary: { total_income: '0', total_spending: '0.00', net_saved: '0' },
    })

    expect(joinText(buildNarrative(report))).toBe("2026-09 — you've spent 0.00.")
  })

  it('names the biggest mover only alongside real prior-period data', () => {
    const withoutPrior = baseReport({
      has_prior_period_data: false,
      top_movers: [{ category_id: 1, category_name: 'Groceries', kind: 'expense', current: '500', prior: '100', delta: '400' }],
    })
    expect(joinText(buildNarrative(withoutPrior))).not.toContain('Groceries')

    const withPrior = baseReport({
      has_prior_period_data: true,
      prior_summary: { total_income: '5000.00', total_spending: '3000.00', net_saved: '2000.00' },
      top_movers: [{ category_id: 1, category_name: 'Groceries', kind: 'expense', current: '500', prior: '100', delta: '400' }],
    })
    const text = joinText(buildNarrative(withPrior))
    expect(text).toContain('Groceries is the biggest change, up 400')

    const moverLink = buildNarrative(withPrior).find((s) => s.type === 'link' && s.text === 'Groceries')
    expect(moverLink.to).toBe('/transactions?category_id=1&date_from=2026-09-01&date_to=2026-09-30')
  })

  it('says "down" for a mover whose spending fell', () => {
    const report = baseReport({
      has_prior_period_data: true,
      prior_summary: { total_income: '5000.00', total_spending: '3000.00', net_saved: '2000.00' },
      top_movers: [{ category_id: 2, category_name: 'Fuel', kind: 'expense', current: '50', prior: '200', delta: '-150' }],
    })

    expect(joinText(buildNarrative(report))).toContain('Fuel is the biggest change, down 150')
  })

  it('pluralizes the over-budget clause correctly, and links to /reports', () => {
    const one = baseReport({ budgets: [{ category_id: 1, difference: '-10.00' }] })
    expect(joinText(buildNarrative(one))).toContain('1 category is over budget')

    const two = baseReport({ budgets: [{ category_id: 1, difference: '-10.00' }, { category_id: 2, difference: '-5.00' }] })
    expect(joinText(buildNarrative(two))).toContain('2 categories are over budget')

    const overBudgetLink = buildNarrative(one).find((s) => s.type === 'link' && s.to === '/reports')
    expect(overBudgetLink).toBeDefined()
  })

  it('excludes a null-difference budget line from the over-budget count', () => {
    const report = baseReport({ budgets: [{ category_id: 1, difference: null }] })
    expect(joinText(buildNarrative(report))).not.toContain('over budget')
  })

  it('pluralizes the uncategorized clause correctly, and links into the ledger', () => {
    const one = baseReport({ uncategorized: { transaction_count: 10, uncategorized_count: 1, total_in: '0', total_out: '0', net_total: '0' } })
    expect(joinText(buildNarrative(one))).toContain('1 transaction needs a category')

    const many = baseReport({ uncategorized: { transaction_count: 10, uncategorized_count: 38, total_in: '0', total_out: '0', net_total: '0' } })
    expect(joinText(buildNarrative(many))).toContain('38 transactions need a category')

    const uncategorizedLink = buildNarrative(one).find((s) => s.type === 'link' && s.text.includes('needs a category'))
    expect(uncategorizedLink.to).toBe('/transactions?uncategorized=true&date_from=2026-09-01&date_to=2026-09-30')
  })

  it('says just the total-spent sentence on an otherwise all-clear month', () => {
    const report = baseReport()
    expect(joinText(buildNarrative(report))).toBe("2026-09 — you've spent 3240.00.")
  })
})
