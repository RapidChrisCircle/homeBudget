import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import LedgerFilters from './LedgerFilters.jsx'
import { EMPTY_FILTERS } from './ledgerFilterParams.js'

// This form is shared by the ledger and the account detail page, so a
// regression here breaks two pages at once - hence its own tests rather than
// relying on the page-level ones.

const categories = [{ id: 1, name: 'Groceries' }]
const accounts = [{ id: 7, name: 'Joint Everyday' }]

function renderFilters(props = {}) {
  return render(
    <LedgerFilters
      values={EMPTY_FILTERS}
      onFieldChange={() => () => {}}
      onApply={(e) => e.preventDefault()}
      onClear={() => {}}
      categories={categories}
      transactionTypes={['WDL']}
      {...props}
    />
  )
}

describe('LedgerFilters', () => {
  it('renders every filter field', () => {
    renderFilters({ accounts })

    expect(screen.getByLabelText('Account')).toBeInTheDocument()
    expect(screen.getByLabelText('Category')).toBeInTheDocument()
    expect(screen.getByLabelText('From date')).toBeInTheDocument()
    expect(screen.getByLabelText('To date')).toBeInTheDocument()
    expect(screen.getByLabelText('Narration contains')).toBeInTheDocument()
    expect(screen.getByLabelText('Type')).toBeInTheDocument()
    expect(screen.getByLabelText('Min amount')).toBeInTheDocument()
    expect(screen.getByLabelText('Max amount')).toBeInTheDocument()
  })

  it('omits the account select when no accounts prop is given', () => {
    renderFilters()

    expect(screen.queryByLabelText('Account')).not.toBeInTheDocument()
    // The rest of the form is unaffected.
    expect(screen.getByLabelText('Category')).toBeInTheDocument()
  })

  it('offers uncategorized-only as a distinct choice from all categories', () => {
    renderFilters()

    const options = Array.from(screen.getByLabelText('Category').options).map((o) => o.value)
    expect(options).toEqual(['', 'uncategorized', '1'])
  })

  it('fires onApply on submit and onClear on the clear button', () => {
    const onApply = vi.fn((e) => e.preventDefault())
    const onClear = vi.fn()
    renderFilters({ onApply, onClear })

    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    expect(onApply).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(onClear).toHaveBeenCalled()
  })

  it('reports edits through onFieldChange, keyed by field name', () => {
    const handler = vi.fn()
    renderFilters({ onFieldChange: (field) => (event) => handler(field, event.target.value) })

    fireEvent.change(screen.getByLabelText('Narration contains'), { target: { value: 'woolworths' } })

    expect(handler).toHaveBeenCalledWith('search', 'woolworths')
  })

  it('offers groups alongside ungrouped accounts, excluding a grouped account\'s own individual entry', () => {
    const groups = [{ id: 3, name: 'Visa Group' }]
    const mixedAccounts = [
      { id: 7, name: 'Joint Everyday' },
      { id: 8, name: 'Old Visa', group_id: 3 },
    ]
    renderFilters({ accounts: mixedAccounts, groups })

    const options = Array.from(screen.getByLabelText('Account').options).map((o) => ({
      value: o.value, label: o.textContent,
    }))

    expect(options).toEqual([
      { value: '', label: 'All accounts' },
      { value: 'group-3', label: 'Visa Group' },
      { value: '7', label: 'Joint Everyday' },
    ])
  })

  it('reports a group selection as the account field, prefixed for searchParamsFromFilters to decode', () => {
    const groups = [{ id: 3, name: 'Visa Group' }]
    const handler = vi.fn()
    renderFilters({
      accounts,
      groups,
      onFieldChange: (field) => (event) => handler(field, event.target.value),
    })

    fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'group-3' } })

    expect(handler).toHaveBeenCalledWith('account', 'group-3')
  })
})
