// A sortable `<th>` - a button inside the header cell carrying `aria-sort`
// (the correct ARIA attribute for this, not aria-pressed/aria-expanded),
// consistent with the care every table in this app already takes
// (visually-hidden <caption>, `scope` on every header cell).
//
// Two flavours share this one component: client-side tables call it with
// their own utils/tableSort.useTableSort's sortKey/sortDirection/toggleSort;
// the ledger and account-detail ledger (both paginated, so sorting happens
// in SQL - see services/ledger.py) drive it from the `sort`/`direction` URL
// params instead. Either way this component only ever renders state and
// reports a click - it has no sorting logic of its own.
// `numeric` right-aligns the header (and, via .numeric in App.css, the
// column button/arrow it contains) so it sits over the right-aligned
// figures a money/count column actually renders - CSS has no way to infer
// this from content, so it's an explicit prop rather than a selector.
export default function SortableHeader({ label, sortKey, activeSortKey, activeDirection, onSort, numeric = false }) {
  const isActive = sortKey === activeSortKey
  const ariaSort = isActive ? (activeDirection === 'asc' ? 'ascending' : 'descending') : 'none'

  return (
    <th scope="col" aria-sort={ariaSort} className={numeric ? 'numeric' : undefined}>
      <button type="button" className="sortable-header" onClick={() => onSort(sortKey)}>
        {label}
        {isActive && (
          <span aria-hidden="true" className="sortable-header-arrow">
            {activeDirection === 'asc' ? ' ▲' : ' ▼'}
          </span>
        )}
      </button>
    </th>
  )
}
