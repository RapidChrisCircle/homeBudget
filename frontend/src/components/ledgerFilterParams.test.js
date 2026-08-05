import { describe, expect, it } from 'vitest'
import {
  EMPTY_FILTERS,
  filtersFromSearchParams,
  groupsQueryFromSearchParams,
  nextSortParams,
  searchParamsFromFilters,
  sortFromSearchParams,
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

// Sort state - server-side (the ledger is paginated), read directly off the
// URL like page/page_size rather than folded into the filter form object.
describe('sortFromSearchParams / nextSortParams', () => {
  it('returns null sort when nothing is set', () => {
    expect(sortFromSearchParams(new URLSearchParams())).toEqual({ sort: null, direction: null })
  })

  it('ignores an unrecognized sort column - never sends garbage to the API', () => {
    const params = new URLSearchParams({ sort: 'not-a-real-column' })

    expect(sortFromSearchParams(params)).toEqual({ sort: null, direction: null })
  })

  it('defaults direction to asc when only sort is set', () => {
    expect(sortFromSearchParams(new URLSearchParams({ sort: 'date' }))).toEqual({ sort: 'date', direction: 'asc' })
  })

  it('reads an explicit desc direction', () => {
    const params = new URLSearchParams({ sort: 'amount', direction: 'desc' })

    expect(sortFromSearchParams(params)).toEqual({ sort: 'amount', direction: 'desc' })
  })

  it('nextSortParams starts a fresh column at asc', () => {
    const next = nextSortParams(new URLSearchParams(), 'date')

    expect(next.get('sort')).toBe('date')
    expect(next.get('direction')).toBe('asc')
  })

  it('nextSortParams cycles the SAME column asc -> desc -> none', () => {
    let params = nextSortParams(new URLSearchParams(), 'date')
    expect(sortFromSearchParams(params)).toEqual({ sort: 'date', direction: 'asc' })

    params = nextSortParams(params, 'date')
    expect(sortFromSearchParams(params)).toEqual({ sort: 'date', direction: 'desc' })

    params = nextSortParams(params, 'date')
    expect(sortFromSearchParams(params)).toEqual({ sort: null, direction: null })
    expect(params.has('sort')).toBe(false)
    expect(params.has('direction')).toBe(false)
  })

  it('nextSortParams switching to a different column starts it fresh at asc', () => {
    const onDate = nextSortParams(new URLSearchParams({ sort: 'date', direction: 'desc' }), 'amount')

    expect(sortFromSearchParams(onDate)).toEqual({ sort: 'amount', direction: 'asc' })
  })

  it('nextSortParams resets to page 1', () => {
    const next = nextSortParams(new URLSearchParams({ page: '3' }), 'date')

    expect(next.get('page')).toBe('1')
  })
})
