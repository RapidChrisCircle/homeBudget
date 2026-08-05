import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Amount from '../components/Amount.jsx'
import Badge from '../components/Badge.jsx'
import Card from '../components/Card.jsx'
import BarChart from '../components/charts/BarChart.jsx'
import LineChart from '../components/charts/LineChart.jsx'
import EmptyState from '../components/EmptyState.jsx'
import ErrorState from '../components/ErrorState.jsx'
import LoadingState from '../components/LoadingState.jsx'
import SortableHeader from '../components/SortableHeader.jsx'
import { api } from '../services/api'
import { formatAmount, formatBalance, uncategorizedLedgerLink } from '../utils/format.js'
import { useTableSort } from '../utils/tableSort.js'

const RECENT_LIMIT = 5

const ACCOUNTS_SORT_COLUMNS = {
  name: { getValue: (a) => a.name, type: 'string' },
  balance: { getValue: (a) => a.balance, type: 'numeric' },
}

const OVER_BUDGET_SORT_COLUMNS = {
  category: { getValue: (l) => l.category_name, type: 'string' },
  budget: { getValue: (l) => l.budget_amount, type: 'numeric' },
  actual: { getValue: (l) => l.actual, type: 'numeric' },
  over_by: { getValue: (l) => Math.abs(Number(l.difference)), type: 'numeric' },
}

const DUE_SOON_SORT_COLUMNS = {
  merchant: { getValue: (i) => i.merchant, type: 'string' },
  due: { getValue: (i) => i.next_due_date, type: 'date' },
  amount: { getValue: (i) => i.typical_amount, type: 'numeric' },
}

const RECENT_ACTIVITY_SORT_COLUMNS = {
  date: { getValue: (t) => t.transaction_date, type: 'date' },
  account: { getValue: (t) => t.account_name || t.account_number, type: 'string' },
  narration: { getValue: (t) => t.narration, type: 'string' },
  debit: { getValue: (t) => t.debit, type: 'numeric' },
  credit: { getValue: (t) => t.credit, type: 'numeric' },
  category: { getValue: (t) => (t.is_split ? 'Split' : (t.category_name || 'Uncategorized')), type: 'string' },
}
// A simple in/out picture, not the full multi-month analysis /trends
// already gives a whole page to - 6 months is enough to see a trend at a
// glance without turning the dashboard into a second Trends page.
const CHART_MONTHS = 6

export default function DashboardPage() {
  const [accounts, setAccounts] = useState([])
  const [report, setReport] = useState(null)
  const [trends, setTrends] = useState(null)
  const [netWorth, setNetWorth] = useState(null)
  const [goals, setGoals] = useState([])
  const [overAllocatedAccounts, setOverAllocatedAccounts] = useState([])
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
    // six-month category grid the dashboard doesn't show. Net worth comes
    // from /net-worth (services/net_worth.py) rather than being summed
    // client-side here - that service is the ONE place any signed sum of
    // account balances happens, so this card and the Net Worth chart below
    // (whose /trends balances are sign-aware too) can never disagree.
    Promise.all([
      api.get('/accounts'),
      api.get('/reports/monthly?months=1'),
      api.get(`/trends?months=${CHART_MONTHS}`),
      api.get('/net-worth'),
      api.get('/goals'),
      api.get(`/transactions?page_size=${RECENT_LIMIT}`),
      api.get('/recurring'),
    ])
      .then(([accountsRes, reportRes, trendsRes, netWorthRes, goalsRes, transactionsRes, recurringRes]) => {
        if (!cancelled) {
          setAccounts(accountsRes.data)
          setReport(reportRes.data)
          setTrends(trendsRes.data)
          setNetWorth(netWorthRes.data)
          setGoals(goalsRes.data.goals)
          setOverAllocatedAccounts(goalsRes.data.account_envelope_summaries.filter((s) => s.over_allocated))
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

  // Computed here, unconditionally, and BEFORE the loading/error/empty
  // early returns below - the useTableSort calls that follow are hooks,
  // which React requires to run in the same order on every render, so
  // they (and the derived arrays they sort) can't live after a
  // conditional return the way the rest of this page's derived values do.
  const overBudget = (report?.budgets || []).filter(
    (line) => line.difference !== null && Number(line.difference) < 0
  )
  const dueSoon = recurringSeries
    .filter((item) => item.status === 'due_soon')
    .sort((a, b) => a.next_due_date.localeCompare(b.next_due_date))
    .slice(0, RECENT_LIMIT)

  const accountsSort = useTableSort(accounts, ACCOUNTS_SORT_COLUMNS)
  const overBudgetSort = useTableSort(overBudget, OVER_BUDGET_SORT_COLUMNS)
  const dueSoonSort = useTableSort(dueSoon, DUE_SOON_SORT_COLUMNS)
  const recentActivitySort = useTableSort(recent, RECENT_ACTIVITY_SORT_COLUMNS)

  if (loading) {
    return (
      <section className="page">
        <h2>Dashboard</h2>
        <LoadingState message="Loading dashboard..." />
      </section>
    )
  }

  if (error) {
    return (
      <section className="page">
        <h2>Dashboard</h2>
        <ErrorState label="Failed to load dashboard:" message={error} />
      </section>
    )
  }

  if (transactionTotal === 0) {
    return (
      <section className="page">
        <h2>Dashboard</h2>
        <EmptyState message="No transactions imported yet.">
          <Link to="/transactions">Import a bank statement to get started</Link>
        </EmptyState>
      </section>
    )
  }

  const { summary, uncategorized } = report

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
  // own data: at least one period in the window has a known net worth (see
  // services/net_worth.net_worth_history - null means NO classified
  // account has any history that far back yet, a real gap, not $0).
  const balanceHistory = trends?.balances || []
  const hasBalanceHistory = balanceHistory.some((b) => b.balance !== null)

  return (
    <section className="page">
      <h2>Dashboard</h2>

      <Card id="dashboard-accounts" title="Accounts">
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
        <Card id="dashboard-net-worth-chart" title="Net Worth">
          <LineChart
            periods={balanceHistory.map((b) => b.label)}
            series={[{
              label: 'Net worth',
              values: balanceHistory.map((b) => (b.balance === null ? null : Number(b.balance))),
            }]}
            formatValue={formatAmount}
            title="Net worth over time"
          />
        </Card>
      )}

      {goals.length > 0 && (
        <Card id="dashboard-goals" title="Goals">
          {overAllocatedAccounts.length > 0 && (
            <p>
              <Badge tone="warning" title="Envelope goals on this account add up to more than it holds">
                over-allocated
              </Badge>{' '}
              {overAllocatedAccounts.length} account{overAllocatedAccounts.length === 1 ? '' : 's'} committed
              more than {overAllocatedAccounts.length === 1 ? 'it holds' : 'they hold'} &mdash; see{' '}
              <Link to="/goals">Goals</Link> for details.
            </p>
          )}
          <ul>
            {goals.slice(0, RECENT_LIMIT).map((goal) => (
              <li key={goal.id}>
                {goal.name}: <Amount value={goal.current_amount} neutral /> of{' '}
                <Amount value={goal.target_amount} neutral /> ({Number(goal.percent).toFixed(0)}%)
              </li>
            ))}
          </ul>
          <Link to="/goals">See all goals</Link>
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
                <SortableHeader label="Category" sortKey="category" activeSortKey={overBudgetSort.sortKey} activeDirection={overBudgetSort.sortDirection} onSort={overBudgetSort.toggleSort} />
                <SortableHeader label="Budget" sortKey="budget" activeSortKey={overBudgetSort.sortKey} activeDirection={overBudgetSort.sortDirection} onSort={overBudgetSort.toggleSort} numeric />
                <SortableHeader label="Actual" sortKey="actual" activeSortKey={overBudgetSort.sortKey} activeDirection={overBudgetSort.sortDirection} onSort={overBudgetSort.toggleSort} numeric />
                <SortableHeader label="Over by" sortKey="over_by" activeSortKey={overBudgetSort.sortKey} activeDirection={overBudgetSort.sortDirection} onSort={overBudgetSort.toggleSort} numeric />
              </tr>
            </thead>
            <tbody>
              {overBudgetSort.sortedRows.map((line) => (
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
              <SortableHeader label="Date" sortKey="date" activeSortKey={recentActivitySort.sortKey} activeDirection={recentActivitySort.sortDirection} onSort={recentActivitySort.toggleSort} />
              <SortableHeader label="Account" sortKey="account" activeSortKey={recentActivitySort.sortKey} activeDirection={recentActivitySort.sortDirection} onSort={recentActivitySort.toggleSort} />
              <SortableHeader label="Narration" sortKey="narration" activeSortKey={recentActivitySort.sortKey} activeDirection={recentActivitySort.sortDirection} onSort={recentActivitySort.toggleSort} />
              <SortableHeader label="Debit" sortKey="debit" activeSortKey={recentActivitySort.sortKey} activeDirection={recentActivitySort.sortDirection} onSort={recentActivitySort.toggleSort} numeric />
              <SortableHeader label="Credit" sortKey="credit" activeSortKey={recentActivitySort.sortKey} activeDirection={recentActivitySort.sortDirection} onSort={recentActivitySort.toggleSort} numeric />
              <SortableHeader label="Category" sortKey="category" activeSortKey={recentActivitySort.sortKey} activeDirection={recentActivitySort.sortDirection} onSort={recentActivitySort.toggleSort} />
            </tr>
          </thead>
          <tbody>
            {recentActivitySort.sortedRows.map((transaction) => (
              <tr key={transaction.id}>
                <td>{transaction.transaction_date}</td>
                <td>{transaction.account_name || transaction.account_number}</td>
                <td className="cell-wrap">{transaction.narration}</td>
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
