import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Amount from '../components/Amount.jsx'
import Badge from '../components/Badge.jsx'
import Card from '../components/Card.jsx'
import EmptyState from '../components/EmptyState.jsx'
import ErrorState from '../components/ErrorState.jsx'
import LoadingState from '../components/LoadingState.jsx'
import SortableHeader from '../components/SortableHeader.jsx'
import { api } from '../services/api'
import { categoryPathLabel } from '../utils/categories.js'
import { uncategorizedLedgerLink } from '../utils/format.js'
import { useTableSort } from '../utils/tableSort.js'

// Sorted by the hierarchical label the table itself renders, the same
// reasoning CategoriesPage's own sort columns follow.
const BUDGET_VS_ACTUAL_SORT_COLUMNS = {
  category: { getValue: (l) => categoryPathLabel(l), type: 'string' },
  budget: { getValue: (l) => l.budget_amount, type: 'numeric' },
  actual: { getValue: (l) => l.actual, type: 'numeric' },
  difference: { getValue: (l) => l.difference, type: 'numeric' },
}

// Only Category/Total are sortable, not each individual period column - a
// per-period sort key would be a different comparator per rendered column,
// generated dynamically from `grid.periods`, for a use case ("rank
// categories by March specifically") thin enough not to earn that
// complexity. Category Totals' own row order otherwise still reads
// top-to-bottom by total, same as before.
const CATEGORY_TOTALS_SORT_COLUMNS = {
  category: { getValue: (r) => categoryPathLabel(r), type: 'string' },
  total: { getValue: (r) => r.total, type: 'numeric' },
}

export default function ReportsPage() {
  // The month lives in the URL (?year=&month=), so a report is reloadable
  // and shareable the way a filtered ledger already is - and so /trends can
  // drill straight into one month's report from a bar in its charts. No
  // params at all means "whatever the backend's default period is", which
  // is the most recent month with transactions (services/reporting.
  // default_period) - deliberately NOT resolved to explicit params here,
  // since that would be a second implementation of the same choice.
  const [searchParams, setSearchParams] = useSearchParams()
  const year = searchParams.get('year')
  const month = searchParams.get('month')

  const [report, setReport] = useState(null)
  const [periods, setPeriods] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    setLoading(true)
    setError('')

    const query = year && month ? `?year=${year}&month=${month}` : ''

    Promise.all([api.get(`/reports/monthly${query}`), api.get('/reports/periods')])
      .then(([reportRes, periodsRes]) => {
        if (!cancelled) {
          setReport(reportRes.data)
          setPeriods(periodsRes.data)
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
  }, [year, month])

  // Changing month changes the URL and nothing else - the effect above is
  // what fetches, so a month picked here and a month arrived at by link
  // load through exactly the same path.
  const handlePeriodChange = (event) => {
    const [nextYear, nextMonth] = event.target.value.split('-')

    const next = new URLSearchParams(searchParams)
    next.set('year', nextYear)
    next.set('month', nextMonth)
    setSearchParams(next)
  }

  // Called unconditionally, before the loading/error/empty early returns
  // below - React requires hooks to run in the same order every render, so
  // they can't live after a conditional return the way this page's other
  // derived values do. `report` is null until the fetch resolves, hence
  // the optional chaining.
  const budgetVsActualSort = useTableSort(report?.budgets ?? [], BUDGET_VS_ACTUAL_SORT_COLUMNS)
  const categoryTotalsSort = useTableSort(report?.grid?.rows ?? [], CATEGORY_TOTALS_SORT_COLUMNS)

  if (loading) {
    return (
      <section className="page">
        <h2>Reports</h2>
        <LoadingState message="Loading report..." />
      </section>
    )
  }

  if (error) {
    return (
      <section className="page">
        <h2>Reports</h2>
        <ErrorState label="Failed to load report:" message={error} />
      </section>
    )
  }

  if (periods.length === 0) {
    return (
      <section className="page">
        <h2>Reports</h2>
        <EmptyState message="No transactions imported yet." />
      </section>
    )
  }

  const { summary, budgets, grid, uncategorized } = report

  return (
    <section className="page">
      <h2>Reports</h2>

      <p>
        Budgets apply to every month. Transfer categories are excluded from these totals &mdash; if
        a transfer's narration appears on both sides (e.g. a "CCTrueUp" style entry), make sure your
        transfer rule matches the narration rather than the transaction type, or only one leg will
        be excluded.
      </p>

      <Card id="reports-month" title="Month">
        <label>
          Select month
          <select value={`${report.year}-${report.month}`} onChange={handlePeriodChange}>
            {periods.map((period) => (
              <option key={period.label} value={`${period.year}-${period.month}`}>
                {period.label} ({period.transaction_count})
              </option>
            ))}
          </select>
        </label>
      </Card>

      {/* id is fixed rather than derived from the title, since the title
          text itself changes every month. */}
      <Card id="reports-monthly-summary" title={<>Monthly Summary &mdash; {report.label}</>}>
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
      </Card>

      <Card id="reports-uncategorized" title="Uncategorized Review">
        <p>
          {uncategorized.uncategorized_count} of {uncategorized.transaction_count} transaction(s) this
          month are uncategorized (net <Amount value={uncategorized.net_total} />). The summary above only
          covers categorized, non-transfer transactions.
        </p>
        <Link to={uncategorizedLedgerLink(report.start_date, report.end_date)}>
          Review uncategorized transactions
        </Link>
      </Card>

      <Card id="reports-budget-vs-actual" title="Budget vs Actual">
        {budgets.length === 0 && <p>No activity in this month.</p>}
        {budgets.length > 0 && (
          <table>
            <caption className="visually-hidden">Budget vs actual by category</caption>
            <thead>
              <tr>
                <SortableHeader label="Category" sortKey="category" activeSortKey={budgetVsActualSort.sortKey} activeDirection={budgetVsActualSort.sortDirection} onSort={budgetVsActualSort.toggleSort} />
                <SortableHeader label="Budget" sortKey="budget" activeSortKey={budgetVsActualSort.sortKey} activeDirection={budgetVsActualSort.sortDirection} onSort={budgetVsActualSort.toggleSort} numeric />
                <SortableHeader label="Actual" sortKey="actual" activeSortKey={budgetVsActualSort.sortKey} activeDirection={budgetVsActualSort.sortDirection} onSort={budgetVsActualSort.toggleSort} numeric />
                <SortableHeader label="Difference" sortKey="difference" activeSortKey={budgetVsActualSort.sortKey} activeDirection={budgetVsActualSort.sortDirection} onSort={budgetVsActualSort.toggleSort} numeric />
              </tr>
            </thead>
            <tbody>
              {budgetVsActualSort.sortedRows.map((line) => (
                <tr key={line.category_id}>
                  <td>{categoryPathLabel(line)}</td>
                  <td><Amount value={line.budget_amount} neutral /></td>
                  <td>
                    <Amount value={line.actual} neutral />
                    {Number(line.actual) < 0 && (
                      <Badge tone="warning" title="Net refund — refunds exceeded spending this month"> (refund)</Badge>
                    )}
                  </td>
                  <td>
                    <Amount value={line.difference} />
                    {line.difference !== null && Number(line.difference) < 0 && (
                      <Badge tone="danger" title="Over budget"> (over)</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card id="reports-category-totals" title="Category Totals Over Time">
        {grid.rows.length === 0 && <p>No activity in this period.</p>}
        {grid.rows.length > 0 && (
          <table>
            <caption className="visually-hidden">Category totals over time</caption>
            <thead>
              <tr>
                <SortableHeader label="Category" sortKey="category" activeSortKey={categoryTotalsSort.sortKey} activeDirection={categoryTotalsSort.sortDirection} onSort={categoryTotalsSort.toggleSort} />
                {grid.periods.map((period) => (
                  <th scope="col" className="numeric" key={period.label}>{period.label}</th>
                ))}
                <SortableHeader label="Total" sortKey="total" activeSortKey={categoryTotalsSort.sortKey} activeDirection={categoryTotalsSort.sortDirection} onSort={categoryTotalsSort.toggleSort} numeric />
              </tr>
            </thead>
            <tbody>
              {categoryTotalsSort.sortedRows.map((row) => (
                <tr key={row.category_id}>
                  <td>{categoryPathLabel(row)}</td>
                  {grid.periods.map((period) => (
                    <td key={period.label}><Amount value={row.amounts[period.label]} /></td>
                  ))}
                  <td><Amount value={row.total} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </section>
  )
}
