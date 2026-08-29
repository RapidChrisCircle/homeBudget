import { Link } from 'react-router-dom'
import Amount from '../Amount.jsx'
import SortableHeader from '../SortableHeader.jsx'
import { formatBalance } from '../../utils/format.js'
import { useTableSort } from '../../utils/tableSort.js'

const ACCOUNTS_SORT_COLUMNS = {
  name: { getValue: (a) => a.name, type: 'string' },
  balance: { getValue: (a) => a.balance, type: 'numeric' },
}

// The Dashboard's Accounts card, unchanged from before the dashboard became
// customisable - just re-hosted as a widget. Content only; the Card
// wrapper, title, and width all come from widgetRegistry.jsx/DashboardPage.
export default function AccountsWidget({ accounts, netWorth }) {
  const accountsSort = useTableSort(accounts, ACCOUNTS_SORT_COLUMNS)

  return (
    <>
      {accounts.length === 0 && <p>No accounts yet.</p>}
      {accounts.length > 0 && (
        <table>
          <caption className="visually-hidden">Account balances</caption>
          <thead>
            <tr>
              <SortableHeader label="Account" sortKey="name" activeSortKey={accountsSort.sortKey} activeDirection={accountsSort.sortDirection} onSort={accountsSort.toggleSort} />
              <SortableHeader label="Balance" sortKey="balance" activeSortKey={accountsSort.sortKey} activeDirection={accountsSort.sortDirection} onSort={accountsSort.toggleSort} numeric />
            </tr>
          </thead>
          <tbody>
            {accountsSort.sortedRows.map((account) => (
              <tr key={account.id}>
                <td>
                  <Link to={`/accounts/${account.id}`}>{account.name}</Link>
                </td>
                <td className="numeric">{formatBalance(account)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {netWorth && accounts.length > 0 && (
        <p>
          Net worth: <Amount value={netWorth.net} />{' '}
          <span className="text-muted">
            (assets <Amount value={netWorth.assets} neutral />, liabilities{' '}
            <Amount value={netWorth.liabilities} neutral />)
          </span>
          {netWorth.unclassified_count > 0 && (
            <>
              {' '}
              <span className="text-muted">
                Excludes {netWorth.unclassified_count} unclassified account
                {netWorth.unclassified_count === 1 ? '' : 's'} &mdash; set a type on{' '}
                <Link to="/accounts">Accounts</Link> to include {netWorth.unclassified_count === 1 ? 'it' : 'them'}.
              </span>
            </>
          )}
        </p>
      )}
    </>
  )
}
