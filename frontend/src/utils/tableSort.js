import { useMemo, useState } from 'react'

function isEmpty(value) {
  return value === null || value === undefined || value === ''
}

function rawCompare(a, b, type) {
  if (type === 'numeric') return Number(a) - Number(b)
  if (type === 'date') return new Date(a) - new Date(b)
  // Plain string compare, case-insensitive - matches the backend's own
  // sort-by-narration convention (services/ledger.py sorts on
  // func.lower(Transaction.narration)) so client- and server-side sorting
  // never disagree about what "alphabetical" means.
  return String(a).toLowerCase().localeCompare(String(b).toLowerCase())
}

// Nulls/empties always sort last, in EITHER direction - an absent value
// isn't "smallest", it's not there. The same rule services/ledger.py's
// SQL sort applies (.nulls_last()), so a client-sorted table and the
// server-sorted ledger never disagree about where a blank belongs.
// Exported directly so it can be unit-tested without a component around it.
export function compareForSort(a, b, type, direction) {
  const aEmpty = isEmpty(a)
  const bEmpty = isEmpty(b)

  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1

  const cmp = rawCompare(a, b, type)
  return direction === 'desc' ? -cmp : cmp
}

// `columns` is a map of { [key]: { getValue(row), type } } - `type` is
// 'numeric' | 'date' | 'string' (the default). A no-op (returns `rows`
// as-is, same reference) when sortKey/sortDirection is null or unrecognized.
//
// Exported standalone (not just via the hook below) for a table rendered
// in independent SECTIONS - CategoriesPage's parent/child groups,
// AccountsPage's account-group sections - where one shared sort state
// (from useTableSort) still needs to sort each section's own subset
// separately, rather than merging every section into one list.
export function sortRowsBy(rows, sortKey, sortDirection, columns) {
  if (!sortKey || !sortDirection || !columns[sortKey]) {
    return rows
  }

  const { getValue, type } = columns[sortKey]
  return [...rows].sort((a, b) => compareForSort(getValue(a), getValue(b), type, sortDirection))
}

// Sorts rows already fully in state (client-side) - NOT for a paginated
// table, where sorting only the rows on the current page would silently
// lie about the full set. The ledger and account-detail ledger sort in
// SQL instead (services/ledger.py's `sort`/`direction` params) for exactly
// that reason; every other table in the app has all its rows in memory
// already, which is what makes sorting them here safe.
//
// Clicking a column cycles asc -> desc -> none; clicking a DIFFERENT
// column starts that column fresh at asc rather than continuing the
// previous column's cycle.
//
// `initial` seeds the starting sortKey/direction (defaults to unsorted -
// the rows' own fetched order) - for a table whose fetched order already
// IS a meaningful sort (the ledger's merchant groups arrive count-desc/
// total-desc from the server), this makes that ordering an active,
// visible sort state (the header shows it) rather than an invisible
// implicit one nothing points at.
export function useTableSort(rows, columns, initial = {}) {
  const [sortKey, setSortKey] = useState(initial.sortKey ?? null)
  const [sortDirection, setSortDirection] = useState(initial.sortDirection ?? null) // 'asc' | 'desc' | null

  const toggleSort = (key) => {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDirection('asc')
      return
    }

    if (sortDirection === 'asc') {
      setSortDirection('desc')
    } else if (sortDirection === 'desc') {
      setSortKey(null)
      setSortDirection(null)
    } else {
      setSortDirection('asc')
    }
  }

  const sortedRows = useMemo(
    () => sortRowsBy(rows, sortKey, sortDirection, columns),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, sortKey, sortDirection]
  )

  return { sortedRows, sortKey, sortDirection, toggleSort }
}
