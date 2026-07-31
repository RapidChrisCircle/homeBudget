// Translation between the ledger filter form's values and the query params
// GET /transactions actually understands. Shared by the ledger and the
// account detail page so the two can't drift apart on what "uncategorized"
// or an empty field means.
//
// The form has a single `category` field standing in for two distinct query
// params: 'uncategorized' maps to uncategorized=true, anything else non-empty
// maps to category_id. The API rejects the two being sent together, so they
// can never both be set from here.

export const EMPTY_FILTERS = {
  account_id: '',
  category: '', // '' = all, 'uncategorized' = uncategorized only, else a category id
  date_from: '',
  date_to: '',
  search: '',
  transaction_type: '',
  min_amount: '',
  max_amount: '',
}

export function filtersFromSearchParams(searchParams) {
  return {
    account_id: searchParams.get('account_id') || '',
    category: searchParams.get('uncategorized') === 'true'
      ? 'uncategorized'
      : searchParams.get('category_id') || '',
    date_from: searchParams.get('date_from') || '',
    date_to: searchParams.get('date_to') || '',
    search: searchParams.get('search') || '',
    transaction_type: searchParams.get('transaction_type') || '',
    min_amount: searchParams.get('min_amount') || '',
    max_amount: searchParams.get('max_amount') || '',
  }
}

// Builds a fresh params object - deliberately without `page`, so applying a
// filter resets to page 1. Staying on page 7 of a result set you just
// replaced shows an empty table for no visible reason.
export function searchParamsFromFilters(filters) {
  const params = new URLSearchParams()

  if (filters.account_id) params.set('account_id', filters.account_id)

  if (filters.category === 'uncategorized') {
    params.set('uncategorized', 'true')
  } else if (filters.category) {
    params.set('category_id', filters.category)
  }

  if (filters.date_from) params.set('date_from', filters.date_from)
  if (filters.date_to) params.set('date_to', filters.date_to)
  if (filters.search) params.set('search', filters.search)
  if (filters.transaction_type) params.set('transaction_type', filters.transaction_type)
  if (filters.min_amount) params.set('min_amount', filters.min_amount)
  if (filters.max_amount) params.set('max_amount', filters.max_amount)

  return params
}
