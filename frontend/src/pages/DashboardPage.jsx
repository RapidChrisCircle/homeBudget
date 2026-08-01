import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Amount from '../components/Amount.jsx'
import EmptyState from '../components/EmptyState.jsx'
import ErrorState from '../components/ErrorState.jsx'
import LoadingState from '../components/LoadingState.jsx'
import { api } from '../services/api'
import { formatBalance, uncategorizedLedgerLink } from '../utils/format.js'

const RECENT_LIMIT = 5

export default function DashboardPage() {
  const [accounts, setAccounts] = useState([])
  const [report, setReport] = useState(null)
  const [recent, setRecent] = useState([])
  const [transactionTotal, setTransactionTotal] = useState(0)
  const [recurringSeries, setRecurringSeries] = useState([])
  const [recurringSummary, setRecurringSummary] = useState(null)
  const [recurringAsOf, setRecurringAsOf] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    setLoading(true)
    setError('')

    // No dashboard-specific endpoint: everything here is already served by
    // the pages it summarizes. months=1 keeps the report from computing the
    // six-month category grid the dashboard doesn't show.
    Promise.all([
      api.get('/accounts'),
      api.get('/reports/monthly?months=1'),
      api.get(`/transactions?page_size=${RECENT_LIMIT}`),
      api.get('/recurring'),
    ])
      .then(([accountsRes, reportRes, transactionsRes, recurringRes]) => {
        if (!cancelled) {
          setAccounts(accountsRes.data)
          setReport(reportRes.data)
          setRecent(transactionsRes.data.items)
          setTransactionTotal(transactionsRes.data.total)
          setRecurringSeries(recurringRes.data.series)
          setRecurringSummary(recurringRes.data.summary)
          setRecurringAsOf(recurringRes.data.as_of)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const message = err?.response?.data?.detail || err?.message || 'Unknown error'
          setError(String(message))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <section className="card">
        <h2>Dashboard</h2>
        <LoadingState message="Loading dashboard..." />
      </section>
    )
  }

  if (error) {
    return (
      <section className="card">
        <h2>Dashboard</h2>
        <ErrorState label="Failed to load dashboard:" message={error} />
      </section>
    )
  }

  if (transactionTotal === 0) {
    return (
      <section className="card">
        <h2>Dashboard</h2>
        <EmptyState message="No transactions imported yet.">
          <Link to="/transactions">Import a bank statement to get started</Link>
        </EmptyState>
      </section>
    )
  }

  const { summary, budgets, uncategorized } = report
  const withBalances = accounts.filter((account) => account.balance !== null)
  const combined = withBalances.reduce((sum, account) => sum + Number(account.balance), 0)
  const overBudget = budgets.filter((line) => line.difference !== null && Number(line.difference) < 0)
  const dueSoon = recurringSeries
    .filter((item) => item.status === 'due_soon')
    .sort((a, b) => a.next_due_date.localeCompare(b.next_due_date))
    .slice(0, RECENT_LIMIT)

  return (
    <section className="card">
      <h2>Dashboard</h2>

      <div className="card">
        <h3>Accounts</h3>
        {accounts.length === 0 && <p>No accounts yet.</p>}
        {accounts.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td>
                    <Link to={`/accounts/${account.id}`}>{account.name}</Link>
                  </td>
                  <td>{formatBalance(account)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {withBalances.length > 0 && (
          <p>
            Combined balance: <Amount value={combined} />{' '}
            <span title="A straight sum of each account's latest bank balance — an everyday account and a credit card are added together as-is, so this is not net worth.">
              (sum of raw bank balances)
            </span>
          </p>
        )}
      </div>

      <div className="card">
        {/* The month shown is the most recent one WITH data, not necessarily
            the current calendar month - so the label is not optional. */}
        <h3>Summary &mdash; {report.label}</h3>
        <table>
          <tbody>
            <tr>
              <td>Total income</td>
              <td><Amount value={summary.total_income} neutral /></td>
            </tr>
            <tr>
              <td>Total spending</td>
              <td><Amount value={summary.total_spending} neutral /></td>
            </tr>
            <tr>
              <td>Net saved</td>
              <td><Amount value={summary.net_saved} /></td>
            </tr>
          </tbody>
        </table>
        <Link to="/reports">See full report</Link>
      </div>

      <div className="card">
        <h3>Needs Attention</h3>
        {overBudget.length === 0 && <p>Nothing over budget this month.</p>}
        {overBudget.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Budget</th>
                <th>Actual</th>
                <th>Over by</th>
              </tr>
            </thead>
            <tbody>
              {overBudget.map((line) => (
                <tr key={line.category_id}>
                  <td>{line.category_name}</td>
                  <td><Amount value={line.budget_amount} neutral /></td>
                  <td><Amount value={line.actual} neutral /></td>
                  <td><Amount value={Math.abs(Number(line.difference))} neutral className="amount-negative" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {recurringSummary && recurringSummary.series_count > 0 && (
        <div className="card">
          <h3>Recurring</h3>
          {/* "Due in the next 14 days" is measured from the ledger's own
              latest transaction, not today - see services/recurring.py. This
              caption is what stops that being misread as "14 days from now"
              once imports have fallen behind. */}
          {recurringAsOf && <p>Based on transactions imported up to {recurringAsOf}.</p>}
          {dueSoon.length > 0 && (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Merchant</th>
                    <th>Due</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {dueSoon.map((item) => (
                    <tr key={`${item.account_id}-${item.narration_key}`}>
                      <td>{item.merchant}</td>
                      <td>{item.next_due_date}</td>
                      <td><Amount value={item.typical_amount} neutral /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>Due in the next 14 days: <Amount value={recurringSummary.due_soon_total} neutral /></p>
            </>
          )}
          {dueSoon.length === 0 && <p>Nothing due in the next 14 days.</p>}
          {(recurringSummary.changed_count > 0 || recurringSummary.overdue_count > 0) && (
            <p>
              {recurringSummary.changed_count > 0 && `${recurringSummary.changed_count} price change(s)`}
              {recurringSummary.changed_count > 0 && recurringSummary.overdue_count > 0 && ', '}
              {recurringSummary.overdue_count > 0 && `${recurringSummary.overdue_count} missed or stopped`}
            </p>
          )}
          <Link to="/recurring">See all recurring payments</Link>
        </div>
      )}

      <div className="card">
        <h3>Uncategorized</h3>
        <p>
          {uncategorized.uncategorized_count} of {uncategorized.transaction_count} transaction(s) this
          month are uncategorized (net <Amount value={uncategorized.net_total} />). They are excluded from
          the summary above.
        </p>
        <Link to={uncategorizedLedgerLink(report.start_date, report.end_date)}>
          Review uncategorized transactions
        </Link>
      </div>

      <div className="card">
        <h3>Recent Activity</h3>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Account</th>
              <th>Narration</th>
              <th>Debit</th>
              <th>Credit</th>
              <th>Category</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((transaction) => (
              <tr key={transaction.id}>
                <td>{transaction.transaction_date}</td>
                <td>{transaction.account_name || transaction.account_number}</td>
                <td>{transaction.narration}</td>
                <td><Amount value={transaction.debit} /></td>
                <td><Amount value={transaction.credit} /></td>
                <td>{transaction.category_name || 'Uncategorized'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Link to="/transactions">Go to the full ledger</Link>
      </div>
    </section>
  )
}
