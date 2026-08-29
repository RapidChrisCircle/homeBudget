import { Link } from 'react-router-dom'
import Amount from '../Amount.jsx'
import SortableHeader from '../SortableHeader.jsx'
import { useTableSort } from '../../utils/tableSort.js'

const RECENT_LIMIT = 5

const DUE_SOON_SORT_COLUMNS = {
  merchant: { getValue: (i) => i.merchant, type: 'string' },
  due: { getValue: (i) => i.next_due_date, type: 'date' },
  amount: { getValue: (i) => i.typical_amount, type: 'numeric' },
}

// The Dashboard's Recurring card, unchanged - re-hosted as a widget.
// `series`/`summary`/`asOf` are GET /recurring's own response, already
// fetched by DashboardPage. Renders an empty state (rather than nothing)
// when there is no recurring activity at all yet - see GoalsWidget's own
// docstring for why a widget the user explicitly added shows a message
// instead of silently disappearing.
export default function RecurringWidget({ series, summary, asOf }) {
  const dueSoon = series
    .filter((item) => item.status === 'due_soon')
    .sort((a, b) => a.next_due_date.localeCompare(b.next_due_date))
    .slice(0, RECENT_LIMIT)
  const dueSoonSort = useTableSort(dueSoon, DUE_SOON_SORT_COLUMNS)

  if (!summary || summary.series_count === 0) {
    return <p>No recurring payments detected yet.</p>
  }

  return (
    <>
      {/* "Due in the next 14 days" is measured from the ledger's own
          latest transaction, not today - see services/recurring.py. This
          caption is what stops that being misread as "14 days from now"
          once imports have fallen behind. */}
      {asOf && <p>Based on transactions imported up to {asOf}.</p>}
      {dueSoon.length > 0 && (
        <>
          <table>
            <caption className="visually-hidden">Recurring payments due soon</caption>
            <thead>
              <tr>
                <SortableHeader label="Merchant" sortKey="merchant" activeSortKey={dueSoonSort.sortKey} activeDirection={dueSoonSort.sortDirection} onSort={dueSoonSort.toggleSort} />
                <SortableHeader label="Due" sortKey="due" activeSortKey={dueSoonSort.sortKey} activeDirection={dueSoonSort.sortDirection} onSort={dueSoonSort.toggleSort} />
                <SortableHeader label="Amount" sortKey="amount" activeSortKey={dueSoonSort.sortKey} activeDirection={dueSoonSort.sortDirection} onSort={dueSoonSort.toggleSort} numeric />
              </tr>
            </thead>
            <tbody>
              {dueSoonSort.sortedRows.map((item) => (
                <tr key={`${item.account_id}-${item.narration_key}`}>
                  <td className="cell-wrap">{item.merchant}</td>
                  <td>{item.next_due_date}</td>
                  <td><Amount value={item.typical_amount} neutral /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>Due in the next 14 days: <Amount value={summary.due_soon_total} neutral /></p>
        </>
      )}
      {dueSoon.length === 0 && <p>Nothing due in the next 14 days.</p>}
      {(summary.changed_count > 0 || summary.overdue_count > 0) && (
        <p>
          {summary.changed_count > 0 && `${summary.changed_count} price change(s)`}
          {summary.changed_count > 0 && summary.overdue_count > 0 && ', '}
          {summary.overdue_count > 0 && `${summary.overdue_count} missed or stopped`}
        </p>
      )}
      <Link to="/recurring">See all recurring payments</Link>
    </>
  )
}
