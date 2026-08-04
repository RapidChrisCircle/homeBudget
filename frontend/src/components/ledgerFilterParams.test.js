import { describe, expect, it } from 'vitest'
import {
  EMPTY_FILTERS,
  filtersFromSearchParams,
  groupsQueryFromSearchParams,
  searchParamsFromFilters,
} from './ledgerFilterParams.js'

// The account field maps to EITHER account_id or account_group_id - the
// same single-field-stands-for-two-params shape `category` already uses
// for uncategorized/category_id. Covered directly since a bug here would
// silently scope the ledger to the wrong rows.
describe('ledgerFilterParams account/account_group_id encoding', () => {
  it('encodes a plain account selection as account_id', () => {
    const params = searchParamsFromFilters({ ...EMPTY_FILTERS, account: '7' })

    expect(params.get('account_id')).toBe('7')
    expect(params.get('account_group_id')).toBeNull()
  })

  it('encodes a group-<id> selection as account_group_id, not account_id', () => {
    const params = searchParamsFromFilters({ ...EMPTY_FILTERS, account: 'group-3' })

    expect(params.get('account_group_id')).toBe('3')
    expect(params.get('account_id')).toBeNull()
  })

  it('omits both when no account is selected', () => {
    const params = searchParamsFromFilters(EMPTY_FILTERS)

    expect(params.get('account_id')).toBeNull()
    expect(params.get('account_group_id')).toBeNull()
  })

  it('decodes account_id back to a plain account value', () => {
    const params = new URLSearchParams({ account_id: '7' })

    expect(filtersFromSearchParams(params).account).toBe('7')
  })

  it('decodes account_group_id back to a group-<id> value', () => {
    const params = new URLSearchParams({ account_group_id: '3' })

    expect(filtersFromSearchParams(params).account).toBe('group-3')
  })

  it('round-trips a group selection through encode then decode', () => {
    const encoded = searchParamsFromFilters({ ...EMPTY_FILTERS, account: 'group-3' })
    const decoded = filtersFromSearchParams(encoded)

    expect(decoded.account).toBe('group-3')
  })
})

// The merchant-grouping view (Group by merchant, TransactionsPage.jsx) reads
// this query too - without carrying category_id/uncategorized/
// account_group_id through, "Uncategorized only" + grouping showed groups
// spanning rows the ledger itself was hiding, and an account-group filter
// was silently ignored by the grouped view.
describe('groupsQueryFromSearchParams', () => {
  it('carries uncategorized through to the groups query', () => {
    const query = groupsQueryFromSearchParams(new URLSearchParams({ uncategorized: 'true' }))

    expect(query).toContain('uncategorized=true')
  })

  it('carries category_id through to the groups query', () => {
    const query = groupsQueryFromSearchParams(new URLSearchParams({ category_id: '5' }))

    expect(query).toContain('category_id=5')
  })

  it('carries account_group_id through to the groups query', () => {
    const query = groupsQueryFromSearchParams(new URLSearchParams({ account_group_id: '3' }))

    expect(query).toContain('account_group_id=3')
  })

  it('still omits page and page_size - groups are not paginated', () => {
    const query = groupsQueryFromSearchParams(new URLSearchParams({ page: '2', page_size: '50', search: 'coffee' }))

    expect(query).not.toContain('page=')
    expect(query).not.toContain('page_size=')
    expect(query).toContain('search=coffee')
  })
})
