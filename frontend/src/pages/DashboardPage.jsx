import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Amount from '../components/Amount.jsx'
import Card from '../components/Card.jsx'
import BarChart from '../components/charts/BarChart.jsx'
import LineChart from '../components/charts/LineChart.jsx'
import EmptyState from '../components/EmptyState.jsx'
import ErrorState from '../components/ErrorState.jsx'
import LoadingState from '../components/LoadingState.jsx'
import { api } from '../services/api'
import { formatAmount, formatBalance, uncategorizedLedgerLink } from '../utils/format.js'

const RECENT_LIMIT = 5
// A simple in/out picture, not the full multi-month analysis /trends
// already gives a whole page to - 6 months is enough to see a trend at a
// glance without turning the dashboard into a second Trends page.
const CHART_MONTHS = 6

export default function DashboardPage() {
  const [accounts, setAccounts] = useState([])
  const [report, setReport] = useState(null)
  const [trends, setTrends] = useState(null)
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
      api.get(`/trends?months=${CHART_MONTHS}`),
      api.get(`/transactions?page_size=${RECENT_LIMIT}`),
      api.get('/recurring'),
    ])
      .then(([accountsRes, reportRes, trendsRes, transactionsRes, recurringRes]) => {
        if (!cancelled) {
          setAccounts(accountsRes.data)
          setReport(reportRes.data)
          setTrends(trendsRes.data)
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

  // Deliberately NOT monthly.length > 0 - /trends outer-joins its grid (see
  // reporting.category_grid's docstring), so a budgeted-but-idle category
  // can make an otherwise-empty window look like it has data. Real activity
  // in at least one of the charted months is the only honest signal, same
  // check TrendsPage itself uses.
  const monthlyTrend = trends?.monthly || []
  const hasChartHistory = monthlyTrend.some(
    (m) => Number(m.total_income) !== 0 || Number(m.total_spending) !== 0
  )

  // Independent of hasChartHistory above - a household can have balance
  // history (an account with an opening balance) through a month with no
  // categorized income/spending activity at all, and the reverse. Gated on
  // the same "is there anything real to plot" principle, just against its
  // own data: at least one period in the window has a known combined
  // balance (see services/trends.combined_balance_history - null means
  // NO account has any history that far back yet, a real gap, not $0).
  const balanceHistory = trends?.balances || []
  const hasBalanceHistory = balanceHistory.some((b) => b.balance !== null)
  const dueSoon = recurringSeries
    .filter((item) => item.status === 'due_soon')
    .sort((a, b) => a.next_due_date.localeCompare(b.next_due_date))
    .slice(0, RECENT_LIMIT)

  return (
    <section className="card">
      <h2>Dashboard</h2>

      <Card id="dashboard-accounts" title="Accounts">
        {accounts.length === 0 && <p>No accounts yet.</p>}
        {accounts.length > 0 && (
          <table>
            <caption className="visually-hidden">Account balances</caption>
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Balance</th>
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
      </Card>

      {/* Two charts sharing the same months, never one dual-axis chart -
          cash flow (a few thousand dollars a month) and the combined
          balance (tens of thousands) are different scales, and plotting
          both on one axis would invent a correlation from an arbitrary
          scale alignment rather than show a real one. Reading down a
          month answers both "did I come out ahead" and "what am I
          sitting on" honestly, each on its own axis. */}
      {hasChartHistory && (
        <Card id="dashboard-cash-flow" title="Cash Flow">
          <BarChart
            periods={trends.periods.map((p) => p.label)}
            series={[
              { label: 'Income', values: monthlyTrend.map((m) => Number(m.total_income)) },
              // Negated: total_spending is a positive "amount spent" figure
              // (see reporting.py's presentation-signing docstring) - drawn
              // as a NEGATIVE value here so it falls below the zero line,
              // opposite Income, and the month's net reads as the visible
              // imbalance between the two bars.
              { label: 'Spending', values: monthlyTrend.map((m) => -Number(m.total_spending)) },
            ]}
            formatValue={formatAmount}
            title="Cash flow: income and spending"
          />
        </Card>
      )}

      {hasBalanceHistory && (
        <Card id="dashboard-net-balance" title="Net Balance">
          <LineChart
            periods={balanceHistory.map((b) => b.label)}
            series={[{
              label: 'Combined balance',
              values: balanceHistory.map((b) => (b.balance === null ? null : Number(b.balance))),
            }]}
            formatValue={formatAmount}
            title="Combined balance over time"
          />
          <p className="text-muted">
            A straight sum of each account&apos;s balance each month &mdash; an everyday account
            and a credit card are added together as-is, so this is not net worth.
          </p>
        </Card>
      )}

      {/* The month shown is the most recent one WITH data, not necessarily
          the current calendar month - so the label is not optional. id is
          fixed rather than derived from the title, since the title text
          itself changes every month. */}
      <Card id="dashboard-summary" title={<>Summary &mdash; {report.label}</>}>
        <table>
          <caption className="visually-hidden">Monthly summary</caption>
          <tbody>
            <tr>
              <th scope="row">Total income</th>
              <td><Amount value={summary.total_income} neutral /></td>
            </tr>
            <tr>
              <th scope="row">Total spending</th>
              <td><Amount value={summary.total_spending} neutral /></td>
            </tr>
            <tr>
              <th scope="row">Net saved</th>
              <td><Amount value={summary.net_saved} /></td>
            </tr>
          </tbody>
        </table>
        <Link to="/reports">See full report</Link>
      </Card>

      <Card id="dashboard-needs-attention" title="Needs Attention">
        {overBudget.length === 0 && <p>Nothing over budget this month.</p>}
        {overBudget.length > 0 && (
          <table>
            <caption className="visually-hidden">Categories over budget this month</caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Budget</th>
                <th scope="col">Actual</th>
                <th scope="col">Over by</th>
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
      </Card>

      {recurringSummary && recurringSummary.series_count > 0 && (
        <Card id="dashboard-recurring" title="Recurring">
          {/* "Due in the next 14 days" is measured from the ledger's own
              latest transaction, not today - see services/recurring.py. This
              caption is what stops that being misread as "14 days from now"
              once imports have fallen behind. */}
          {recurringAsOf && <p>Based on transactions imported up to {recurringAsOf}.</p>}
          {dueSoon.length > 0 && (
            <>
              <table>
                <caption className="visually-hidden">Recurring payments due soon</caption>
                <thead>
                  <tr>
                    <th scope="col">Merchant</th>
                    <th scope="col">Due</th>
                    <th scope="col">Amount</th>
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
        </Card>
      )}

      <Card id="dashboard-uncategorized" title="Uncategorized">
        <p>
          {uncategorized.uncategorized_count} of {uncategorized.transaction_count} transaction(s) this
          month are uncategorized (net <Amount value={uncategorized.net_total} />). They are excluded from
          the summary above.
        </p>
        <Link to={uncategorizedLedgerLink(report.start_date, report.end_date)}>
          Review uncategorized transactions
        </Link>
      </Card>

      <Card id="dashboard-recent-activity" title="Recent Activity">
        <table>
          <caption className="visually-hidden">Recent transactions</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Account</th>
              <th scope="col">Narration</th>
              <th scope="col">Debit</th>
              <th scope="col">Credit</th>
              <th scope="col">Category</th>
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
      </Card>
    </section>
  )
}
