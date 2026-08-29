import Amount from '../Amount.jsx'
import SortableHeader from '../SortableHeader.jsx'
import { categoryPathLabel } from '../../utils/categories.js'
import { useTableSort } from '../../utils/tableSort.js'

const OVER_BUDGET_SORT_COLUMNS = {
  category: { getValue: (l) => categoryPathLabel(l), type: 'string' },
  budget: { getValue: (l) => l.budget_amount, type: 'numeric' },
  actual: { getValue: (l) => l.actual, type: 'numeric' },
  over_by: { getValue: (l) => Math.abs(Number(l.difference)), type: 'numeric' },
}

// The Dashboard's Needs Attention card (over-budget categories this
// month), unchanged - re-hosted as a widget. `report` is the same
// GET /reports/monthly?months=1 response the page has always fetched; the
// over-budget filter itself lives here now instead of in DashboardPage.
export default function NeedsAttentionWidget({ report }) {
  const overBudget = (report?.budgets || []).filter(
    (line) => line.difference !== null && Number(line.difference) < 0
  )
  const overBudgetSort = useTableSort(overBudget, OVER_BUDGET_SORT_COLUMNS)

  if (overBudget.length === 0) {
    return <p>Nothing over budget this month.</p>
  }

  return (
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
            <td>{categoryPathLabel(line)}</td>
            <td><Amount value={line.budget_amount} neutral /></td>
            <td><Amount value={line.actual} neutral /></td>
            <td><Amount value={Math.abs(Number(line.difference))} neutral className="amount-negative" /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
