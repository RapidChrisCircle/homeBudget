import { Link } from 'react-router-dom'
import Amount from '../Amount.jsx'
import SortableHeader from '../SortableHeader.jsx'
import { formatDate, transactionAmount } from '../../utils/format.js'
import { useTableSort } from '../../utils/tableSort.js'

const RECENT_ACTIVITY_SORT_COLUMNS = {
  date: { getValue: (t) => t.transaction_date, type: 'date' },
  account: { getValue: (t) => t.account_name || t.account_number, type: 'string' },
  narration: { getValue: (t) => t.narration, type: 'string' },
  // Magnitude, not signed value - matches services/ledger.py's _AMOUNT_EXPR
  // (abs(coalesce(debit,0) + coalesce(credit,0))), the definition the
  // ledger's own min/max amount filter already uses. Sorting by the raw
  // signed value here would put a small debit and a small credit at
  // opposite ends instead of together, and disagree with what "Amount"
  // sorts by on the ledger pages.
  amount: { getValue: (t) => Math.abs(transactionAmount(t)), type: 'numeric' },
  category: { getValue: (t) => (t.is_split ? 'Split' : (t.category_name || 'Uncategorized')), type: 'string' },
}

// The Dashboard's Recent Activity table, unchanged - re-hosted as a
// widget. `recent` is the same GET /transactions?page_size=N response the
// page has always fetched.
export default function RecentActivityWidget({ recent }) {
  const recentActivitySort = useTableSort(recent, RECENT_ACTIVITY_SORT_COLUMNS)

  return (
    <>
      <table>
        <caption className="visually-hidden">Recent transactions</caption>
        <thead>
          <tr>
            <SortableHeader label="Date" sortKey="date" activeSortKey={recentActivitySort.sortKey} activeDirection={recentActivitySort.sortDirection} onSort={recentActivitySort.toggleSort} />
            <SortableHeader label="Account" sortKey="account" activeSortKey={recentActivitySort.sortKey} activeDirection={recentActivitySort.sortDirection} onSort={recentActivitySort.toggleSort} />
            <SortableHeader label="Narration" sortKey="narration" activeSortKey={recentActivitySort.sortKey} activeDirection={recentActivitySort.sortDirection} onSort={recentActivitySort.toggleSort} />
            <SortableHeader label="Amount" sortKey="amount" activeSortKey={recentActivitySort.sortKey} activeDirection={recentActivitySort.sortDirection} onSort={recentActivitySort.toggleSort} numeric />
            <SortableHeader label="Category" sortKey="category" activeSortKey={recentActivitySort.sortKey} activeDirection={recentActivitySort.sortDirection} onSort={recentActivitySort.toggleSort} />
          </tr>
        </thead>
        <tbody>
          {recentActivitySort.sortedRows.map((transaction) => (
            <tr key={transaction.id}>
              <td>{formatDate(transaction.transaction_date)}</td>
              <td>{transaction.account_name || transaction.account_number}</td>
              <td className="cell-wrap">{transaction.narration}</td>
              <td><Amount value={transactionAmount(transaction)} /></td>
              {/* A split transaction's own category_name is always null
                  (see TransactionSplit's docstring in models.py) but it
                  is not uncategorized - it has one or more allocations
                  instead, just not a single direct category. */}
              <td>{transaction.is_split ? 'Split' : (transaction.category_name || 'Uncategorized')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Link to="/transactions">Go to the full ledger</Link>
    </>
  )
}
