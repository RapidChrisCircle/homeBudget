// Translation between the ledger filter form's values and the query params
// GET /transactions actually understands. Shared by the ledger and the
// account detail page so the two can't drift apart on what "uncategorized"
// or an empty field means.
//
// The form has a single `category` field standing in for THREE distinct
// query params: 'uncategorized' maps to uncategorized=true, 'kind-<kind>'
// maps to kind=<kind> (the Category header popover's Income/Expenses/
// Transfers options - the same choice /trends' drill-down and the
// Dashboard's Cash Flow chart land on), and anything else non-empty maps to
// category_id. The API rejects uncategorized from being combined with
// either of the other two, so this field can never express a contradiction.

import { categoryPathLabel } from '../utils/categories.js'
import { formatAmount, formatDate } from '../utils/format.js'

// Mirrors services/ledger.py's DEFAULT_PAGE_SIZE/MAX_PAGE_SIZE - kept as a
// small, fixed set of choices rather than free entry, so a value can never
// slip past the backend's 1-200 bound.
export const DEFAULT_PAGE_SIZE = 10
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200]

// Page size lives in the URL alongside the filters, so a resized view is
// reloadable and shareable the same way a filtered one already is. Read
// straight from the URL (like the page number already is) rather than kept
// in its own state, so there is exactly one source of truth for it.
export function pageSizeFromSearchParams(searchParams) {
  const raw = Number(searchParams.get('page_size'))
  return PAGE_SIZE_OPTIONS.includes(raw) ? raw : DEFAULT_PAGE_SIZE
}

export const EMPTY_FILTERS = {
  // '' = all, 'group-<id>' = an account group, else a plain account id -
  // the same single-field-stands-for-two-params shape `category` below
  // already uses for uncategorized/category_id.
  account: '',
  // '' = all, 'uncategorized' = uncategorized only, 'kind-income' /
  // 'kind-expense' / 'kind-transfer' = that kind regardless of category,
  // else a category id.
  category: '',
  date_from: '',
  date_to: '',
  search: '',
  transaction_type: '',
  min_amount: '',
  max_amount: '',
}

export function filtersFromSearchParams(searchParams) {
  const accountGroupId = searchParams.get('account_group_id')
  const kind = searchParams.get('kind')

  return {
    account: accountGroupId ? `group-${accountGroupId}` : (searchParams.get('account_id') || ''),
    category: searchParams.get('uncategorized') === 'true'
      ? 'uncategorized'
      : kind
        ? `kind-${kind}`
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
//
// `pageSize` is optional and orthogonal to the filters themselves - passing
// the caller's current choice through is what makes it survive Apply/Clear
// instead of silently dropping back to the default. Omitted from the URL
// when it's the default, so an unsized view's URL stays exactly as clean as
// it already was.
export function searchParamsFromFilters(filters, pageSize) {
  const params = new URLSearchParams()

  if (filters.account?.startsWith('group-')) {
    params.set('account_group_id', filters.account.slice('group-'.length))
  } else if (filters.account) {
    params.set('account_id', filters.account)
  }

  if (filters.category === 'uncategorized') {
    params.set('uncategorized', 'true')
  } else if (filters.category?.startsWith('kind-')) {
    params.set('kind', filters.category.slice('kind-'.length))
  } else if (filters.category) {
    params.set('category_id', filters.category)
  }

  if (filters.date_from) params.set('date_from', filters.date_from)
  if (filters.date_to) params.set('date_to', filters.date_to)
  if (filters.search) params.set('search', filters.search)
  if (filters.transaction_type) params.set('transaction_type', filters.transaction_type)
  if (filters.min_amount) params.set('min_amount', filters.min_amount)
  if (filters.max_amount) params.set('max_amount', filters.max_amount)

  if (pageSize && pageSize !== DEFAULT_PAGE_SIZE) params.set('page_size', String(pageSize))

  return params
}

// The subset of ledger filters GET /transactions/groups accepts - every
// filter except page/page_size (groups aren't paginated). category_id/
// uncategorized and account_id/account_group_id ARE included despite the
// default (include_categorized=false) request forcing uncategorized-only
// server-side regardless of what's asked for - the ledger's own Group by
// merchant toggle passes include_categorized=true, and once it does, these
// matter: without forwarding them, "Uncategorized only" + grouping would
// show groups spanning rows the ledger itself is hiding, and an account-
// group filter would be silently ignored by the grouped view. Kept
// separate from searchParamsFromFilters so changing pages doesn't
// needlessly refetch the groups view.
const GROUPS_FILTER_KEYS = [
  'account_id', 'account_group_id', 'category_id', 'uncategorized', 'kind',
  'date_from', 'date_to', 'search', 'transaction_type', 'min_amount', 'max_amount',
]

export function groupsQueryFromSearchParams(searchParams) {
  const params = new URLSearchParams()

  for (const key of GROUPS_FILTER_KEYS) {
    const value = searchParams.get(key)
    if (value) params.set(key, value)
  }

  return params.toString()
}

// Mirrors services/ledger.py's SORTABLE_COLUMNS exactly, the same
// "can never slip past what the backend accepts" reasoning
// PAGE_SIZE_OPTIONS already follows for DEFAULT_PAGE_SIZE/MAX_PAGE_SIZE.
export const LEDGER_SORT_COLUMNS = ['date', 'narration', 'amount', 'account', 'category', 'balance', 'type']

// Sort state lives in the URL beside the filters - reloadable/shareable the
// same way a filtered view already is - but is READ directly off
// searchParams (like page/page_size) rather than folded into the filter
// form object: sorting reorders results, it doesn't narrow them, so it
// should survive Apply/Clear exactly like page size already does.
export function sortFromSearchParams(searchParams) {
  const sort = searchParams.get('sort')

  if (!LEDGER_SORT_COLUMNS.includes(sort)) {
    return { sort: null, direction: null }
  }

  return { sort, direction: searchParams.get('direction') === 'desc' ? 'desc' : 'asc' }
}

// The next URLSearchParams after clicking a sortable ledger header -
// cycles asc -> desc -> none, the same cycle utils/tableSort.useTableSort
// uses for client-side tables, so every sortable header in the app behaves
// identically regardless of which flavour is actually driving it. Clicking
// a DIFFERENT column starts that column fresh at asc, same reasoning.
// Resets to page 1, the same as applying a filter does - staying on a page
// a changed sort has made meaningless shows an arbitrary slice for no
// visible reason.
export function nextSortParams(searchParams, key) {
  const { sort: currentSort, direction: currentDirection } = sortFromSearchParams(searchParams)
  const next = new URLSearchParams(searchParams)

  if (currentSort !== key) {
    next.set('sort', key)
    next.set('direction', 'asc')
  } else if (currentDirection === 'asc') {
    next.set('direction', 'desc')
  } else if (currentDirection === 'desc') {
    next.delete('sort')
    next.delete('direction')
  } else {
    next.set('sort', key)
    next.set('direction', 'asc')
  }

  next.set('page', '1')
  return next
}

// Which of the ledger's filters are actually narrowing anything. The
// eight fields collapse to SIX user-facing filters (the ledger's own
// toolbar shows one control per pair): date_from/date_to are one Date
// filter, min_amount/max_amount one Amount filter. Counting the raw
// fields instead would report "2 filters" for one date range, which is
// not what the person who set it did.
export const LEDGER_FILTER_GROUPS = [
  ['date_from', 'date_to'],
  ['account'],
  ['search'],
  ['min_amount', 'max_amount'],
  ['category'],
  ['transaction_type'],
]

export function activeFilterCount(filters) {
  return LEDGER_FILTER_GROUPS.filter((fields) => fields.some((field) => filters[field])).length
}

// Human-readable summaries of what each filter is currently narrowing to,
// for the toolbar's filter chips. A chip that says "Narration: coles"
// answers "what is this view showing?" without opening anything, which a
// bare active-dot never could.
//
// Needs the accounts/groups/categories lists because three of the filters
// store an ID: the component holding those lists passes them in rather
// than this module fetching anything of its own. An id with no match (an
// account since deleted, a stale URL) falls back to showing the raw value
// rather than an empty chip that reads as "no filter".
export function describeFilters(filters, { accounts = [], accountGroups = [], categories = [] } = {}) {
  const range = (from, to, format) => {
    if (from && to) return `${format(from)} – ${format(to)}`
    if (from) return `From ${format(from)}`
    if (to) return `To ${format(to)}`
    return null
  }

  const accountLabel = () => {
    if (!filters.account) return null

    if (String(filters.account).startsWith('group-')) {
      const id = String(filters.account).slice('group-'.length)
      return accountGroups.find((group) => String(group.id) === id)?.name || filters.account
    }

    return accounts.find((account) => String(account.id) === String(filters.account))?.name || filters.account
  }

  const categoryLabel = () => {
    if (!filters.category) return null
    if (filters.category === 'uncategorized') return 'Uncategorized'

    const kinds = { 'kind-income': 'Income', 'kind-expense': 'Expenses', 'kind-transfer': 'Transfers' }
    if (kinds[filters.category]) return kinds[filters.category]

    const category = categories.find((c) => String(c.id) === String(filters.category))
    return category ? categoryPathLabel(category) : filters.category
  }

  return {
    date: range(filters.date_from, filters.date_to, formatDate),
    account: accountLabel(),
    search: filters.search || null,
    amount: range(filters.min_amount, filters.max_amount, formatAmount),
    category: categoryLabel(),
    transaction_type: filters.transaction_type || null,
  }
}
