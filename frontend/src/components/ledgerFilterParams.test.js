import { describe, expect, it } from 'vitest'
import {
  EMPTY_FILTERS,
  filtersFromSearchParams,
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
