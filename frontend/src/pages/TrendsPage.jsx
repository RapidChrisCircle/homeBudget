import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Amount from '../components/Amount.jsx'
import BarChart from '../components/charts/BarChart.jsx'
import LineChart from '../components/charts/LineChart.jsx'
import Card from '../components/Card.jsx'
import EmptyState from '../components/EmptyState.jsx'
import ErrorState from '../components/ErrorState.jsx'
import LoadingState from '../components/LoadingState.jsx'
import PageHeader from '../components/PageHeader.jsx'
import SortableHeader from '../components/SortableHeader.jsx'
import { api } from '../services/api'
import { formatAmount, formatDate, transactionIdsLedgerLink } from '../utils/format.js'
import { useTableSort } from '../utils/tableSort.js'
import { buildLevel, buildSeries, drilledCategory, drilledGroupName, monthBounds } from '../utils/trendsSeries.js'

const MONTH_OPTIONS = [6, 12, 24]
const DEFAULT_MONTHS = 6

const CATEGORY_SORT_COLUMNS = {
  category: { getValue: (r) => r.label, type: 'string' },
  count: { getValue: (r) => r.transaction_count, type: 'numeric' },
  date_range: { getValue: (r) => r.first_date, type: 'date' },
  average: { getValue: (r) => r.average_spend, type: 'numeric' },
  total: { getValue: (r) => r.total, type: 'numeric' },
}

const MERCHANT_SORT_COLUMNS = {
  merchant: { getValue: (m) => m.nickname || m.merchant, type: 'string' },
  count: { getValue: (m) => m.transaction_count, type: 'numeric' },
  date_range: { getValue: (m) => m.first_date, type: 'date' },
  average: { getValue: (m) => m.average_spend, type: 'numeric' },
  total: { getValue: (m) => m.total_spent, type: 'numeric' },
}

export default function TrendsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const months = Number(searchParams.get('months')) || DEFAULT_MONTHS
  const year = searchParams.get('year')
  const month = searchParams.get('month')
  // Which group the category chart is drilled into, in the URL beside
  // `months` for the same reason every other view state in this app is: a
  // drilled-in chart is reloadable and shareable, not a state that
  // evaporates on refresh.
  const groupId = searchParams.get('group') || ''
  const categoryId = searchParams.get('category') || ''

  const [trends, setTrends] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [merchantData, setMerchantData] = useState(null)
  const [merchantLoading, setMerchantLoading] = useState(false)
  const [merchantError, setMerchantError] = useState('')
  const [editingMerchantKey, setEditingMerchantKey] = useState(null)
  const [nicknameInput, setNicknameInput] = useState('')
  const [savingNickname, setSavingNickname] = useState(false)
  const [averageMode, setAverageMode] = useState('transaction')

  const activeCategory = trends ? drilledCategory(trends.categories, categoryId) : null
  const activeCategoryId = activeCategory ? String(activeCategory.category_id) : ''
  const groupName = trends ? drilledGroupName(trends.categories, groupId) : null
  const activeGroupId = groupName ? groupId : ''
  const levelRows = trends ? buildLevel(trends.periods, trends.categories, activeGroupId) : []
  const monthCount = trends?.periods?.length || months || 1

  const categorySortColumns = {
    ...CATEGORY_SORT_COLUMNS,
    average: {
      getValue: (r) =>
        averageMode === 'month'
          ? (r.average_monthly_spend ?? Number((r.total / monthCount).toFixed(2)))
          : r.average_spend,
      type: 'numeric',
    },
  }

  const merchantSortColumns = {
    ...MERCHANT_SORT_COLUMNS,
    average: {
      getValue: (m) =>
        averageMode === 'month'
          ? Number((Number(m.total_spent) / monthCount).toFixed(2))
          : m.average_spend,
      type: 'numeric',
    },
  }

  useEffect(() => {
    let cancelled = false

    setLoading(true)
    setError('')

    const query = year && month
      ? `/trends?year=${year}&month=${month}&months=${months}`
      : `/trends?months=${months}`

    api.get(query)
      .then((response) => {
        if (!cancelled) {
          setTrends(response.data)
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
  }, [months, year, month])

  useEffect(() => {
    if (!activeCategoryId) {
      setMerchantData(null)
      setMerchantLoading(false)
      setMerchantError('')
      return undefined
    }

    let cancelled = false
    setMerchantLoading(true)
    setMerchantError('')

    const query = year && month
      ? `/trends/merchants?category_id=${activeCategoryId}&year=${year}&month=${month}&months=${months}`
      : `/trends/merchants?category_id=${activeCategoryId}&months=${months}`

    api.get(query)
      .then((response) => {
        if (!cancelled) {
          setMerchantData(response.data)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const message = err?.response?.data?.detail || err?.message || 'Unknown error'
          setMerchantError(String(message))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setMerchantLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeCategoryId, months, year, month])

  const {
    sortedRows: sortedCategories,
    sortKey: categorySortKey,
    sortDirection: categorySortDirection,
    toggleSort: onCategorySort,
  } = useTableSort(levelRows, categorySortColumns, {
    sortKey: 'total',
    sortDirection: 'desc',
  })

  const {
    sortedRows: sortedMerchants,
    sortKey: merchantSortKey,
    sortDirection: merchantSortDirection,
    toggleSort: onMerchantSort,
  } = useTableSort(merchantData?.merchants ?? [], merchantSortColumns, {
    sortKey: 'total',
    sortDirection: 'desc',
  })

  const handleMonthsChange = (event) => {
    const next = new URLSearchParams(searchParams)
    next.set('months', event.target.value)
    // The window changing can retire the drilled-into group entirely (a
    // group with no activity in the new window isn't in the data at all),
    // so drilling resets rather than leaving an empty chart.
    next.delete('group')
    next.delete('category')
    setSearchParams(next)
  }

  const handleEndMonthChange = (event) => {
    const value = event.target.value
    const next = new URLSearchParams(searchParams)
    if (!value) {
      next.delete('year')
      next.delete('month')
    } else {
      const [nextYear, nextMonth] = value.split('-')
      next.set('year', nextYear)
      next.set('month', String(Number(nextMonth)))
    }
    next.delete('group')
    next.delete('category')
    setSearchParams(next)
  }

  const drillIntoGroup = (id) => {
    const next = new URLSearchParams(searchParams)
    next.set('group', String(id))
    next.delete('category')
    setSearchParams(next)
  }

  const drillIntoCategory = (id) => {
    const next = new URLSearchParams(searchParams)
    next.set('category', String(id))
    setSearchParams(next)
  }

  const clearCategoryDrill = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('category')
    setSearchParams(next)
  }

  const clearDrill = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('group')
    next.delete('category')
    setSearchParams(next)
  }

  const startEditingNickname = (merchantRow) => {
    setEditingMerchantKey(merchantRow.narration_key)
    setNicknameInput(merchantRow.nickname || '')
  }

  const cancelEditingNickname = () => {
    setEditingMerchantKey(null)
    setNicknameInput('')
  }

  const saveNickname = async (merchantRow) => {
    setSavingNickname(true)
    setMerchantError('')
    try {
      const response = await api.put('/trends/merchants/nickname', {
        narration_key: merchantRow.narration_key,
        nickname: nicknameInput.trim() || null,
      })
      setMerchantData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          merchants: prev.merchants.map((item) =>
            item.narration_key === merchantRow.narration_key
              ? { ...item, nickname: response.data.nickname }
              : item
          ),
        }
      })
      setEditingMerchantKey(null)
      setNicknameInput('')
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Failed to save nickname'
      setMerchantError(String(message))
    } finally {
      setSavingNickname(false)
    }
  }

  if (loading) {
    return (
      <section className="page">
        <PageHeader title="Trends" />
        <LoadingState message="Loading trends..." />
      </section>
    )
  }

  if (error) {
    return (
      <section className="page">
        <PageHeader title="Trends" />
        <ErrorState label="Failed to load trends:" message={error} />
      </section>
    )
  }

  const { periods, monthly, budget } = trends
  const periodLabels = periods.map((p) => p.label)
  const activeEndMonth = year && month
    ? `${year}-${String(month).padStart(2, '0')}`
    : (periodLabels[periodLabels.length - 1] || '')

  // Deliberately NOT `categories.length > 0`: category_grid() outer-joins so
  // a budgeted-but-idle category appears even on a completely empty ledger
  // (see reporting.category_grid's docstring) - keying off it here would
  // show three flat-zero charts captioned as trends on a fresh install with
  // nothing imported yet. Real monthly activity is the only honest signal.
  const hasHistory = monthly.some((m) => Number(m.total_income) !== 0 || Number(m.total_spending) !== 0)

  const monthLabel = (
    <div className="filter-bar">
      <label>
        Months
        <select value={months} onChange={handleMonthsChange}>
          {MONTH_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label>
        Ending month
        <input type="month" value={activeEndMonth} onChange={handleEndMonthChange} />
      </label>
      <label>
        Average spend
        <select
          value={averageMode}
          onChange={(event) => setAverageMode(event.target.value)}
        >
          <option value="transaction">Avg / Transaction</option>
          <option value="month">Avg / Month</option>
        </select>
      </label>
    </div>
  )

  if (!hasHistory) {
    return (
      <section className="page">
        <PageHeader title="Trends" />
        {monthLabel}
        <EmptyState message="Not enough history yet - import a few months of statements and check back." />
      </section>
    )
  }

  const categorySeries = buildSeries(periods, levelRows)
  // Income/Spending and Actual each carry which `kind` their own bar
  // stands for, so one handler (openKindMonth below) can drill any of them
  // into the ledger. Net saved and Budgeted opt out with `selectable:
  // false` - a difference and a projection respectively, neither is
  // something any transaction ever "is", so neither has a bar's worth of
  // transactions to show.
  const incomeSpendingSeries = [
    { label: 'Income', values: monthly.map((m) => Number(m.total_income)), drill: { kind: 'income' } },
    { label: 'Spending', values: monthly.map((m) => Number(m.total_spending)), drill: { kind: 'expense' } },
    { label: 'Net saved', values: monthly.map((m) => Number(m.net_saved)), selectable: false },
  ]
  const budgetSeries = [
    { label: 'Budgeted', values: budget.map((b) => Number(b.budgeted)), selectable: false },
    // Budget vs actual is scoped to expense categories only (see /reports'
    // own budget-vs-actual table), so "Actual" here always means expense
    // spending.
    { label: 'Actual', values: budget.map((b) => Number(b.actual)), drill: { kind: 'expense' } },
  ]
  const hasBudget = budget.some((b) => Number(b.budgeted) !== 0)

  // A bar drills into the transactions behind it: the ledger, filtered to
  // that bar's kind and that month.
  const openKindMonth = ({ series, period }) => {
    const { from, to } = monthBounds(period)
    navigate(`/transactions?kind=${series.drill.kind}&date_from=${from}&date_to=${to}`)
  }

  // A category drills into the transactions behind that one point: the
  // ledger, filtered to that category and that month. Nothing about the
  // chart can show WHICH transactions made a month expensive, which is
  // invariably the next question.
  const openCategoryMonth = ({ series, period }) => {
    if (series.drill?.kind === 'group') {
      drillIntoGroup(series.drill.id)
      return
    }

    const { from, to } = monthBounds(period)
    navigate(`/transactions?category_id=${series.drill.id}&date_from=${from}&date_to=${to}`)
  }

  const selectCategorySeries = ({ series }) => {
    if (series.drill?.kind === 'group') {
      drillIntoGroup(series.drill.id)
    } else if (series.drill?.kind === 'category') {
      drillIntoCategory(series.drill.id)
    }
  }

  return (
    <section className="page">
      <PageHeader title="Trends" />
      {monthLabel}

      <Card
        id="trends-category-over-time"
        title={
          groupName
            ? `Spending in ${groupName} Over Time`
            : 'Spending by Category Over Time'
        }
      >
        {groupName ? (
          <p>
            Showing the sub-categories of <strong>{groupName}</strong>. Click a sub-category in the
            legend to see its merchants, or click a point to see that month&apos;s transactions.{' '}
            <button type="button" onClick={clearDrill}>Back to all categories</button>
          </p>
        ) : (
          <p>
            Sub-categories are rolled up into their group. Click a group (a point, or its name in
            the legend) to see what it is made of; click a category in the legend to see its
            merchants, or click a point on an ungrouped category to see that month&apos;s
            transactions.
          </p>
        )}

        {categorySeries.length === 0 ? (
          <EmptyState message="No categorized spending in this window yet." />
        ) : (
          <>
            <LineChart
              periods={periodLabels}
              series={categorySeries}
              formatValue={formatAmount}
              title="Spending by category over time"
              onSelectPoint={openCategoryMonth}
              onSelectSeries={selectCategorySeries}
            />

            <div className="trends-categories-table">
              <table>
                <caption className="visually-hidden">
                  {groupName ? `Sub-categories in ${groupName}` : 'Spending by category'}
                </caption>
                <thead>
                  <tr>
                    <SortableHeader
                      label={groupName ? 'Sub-category' : 'Category'}
                      sortKey="category"
                      activeSortKey={categorySortKey}
                      activeDirection={categorySortDirection}
                      onSort={onCategorySort}
                    />
                    <SortableHeader
                      label="Transactions"
                      sortKey="count"
                      activeSortKey={categorySortKey}
                      activeDirection={categorySortDirection}
                      onSort={onCategorySort}
                      numeric
                    />
                    <SortableHeader
                      label="Date Range"
                      sortKey="date_range"
                      activeSortKey={categorySortKey}
                      activeDirection={categorySortDirection}
                      onSort={onCategorySort}
                    />
                    <SortableHeader
                      label={averageMode === 'month' ? 'Average Spend (per month)' : 'Average Spend (per transaction)'}
                      sortKey="average"
                      activeSortKey={categorySortKey}
                      activeDirection={categorySortDirection}
                      onSort={onCategorySort}
                      numeric
                    />
                    <SortableHeader
                      label="Total Spent"
                      sortKey="total"
                      activeSortKey={categorySortKey}
                      activeDirection={categorySortDirection}
                      onSort={onCategorySort}
                      numeric
                    />
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCategories.map((row) => (
                    <tr key={`${row.drill.kind}-${row.drill.id}`}>
                      <td>{row.label}</td>
                      <td className="numeric">{row.transaction_count}</td>
                      <td>
                        {!row.first_date
                          ? '—'
                          : row.first_date === row.last_date
                            ? formatDate(row.first_date)
                            : `${formatDate(row.first_date)} – ${formatDate(row.last_date)}`}
                      </td>
                      <td className="numeric">
                        <Amount
                          value={
                            averageMode === 'month'
                              ? (row.average_monthly_spend ?? Number((row.total / monthCount).toFixed(2)))
                              : row.average_spend
                          }
                          neutral
                        />
                      </td>
                      <td className="numeric">
                        <Amount value={row.total} neutral />
                      </td>
                      <td>
                        <button
                          type="button"
                          aria-label={
                            row.drill.kind === 'group'
                              ? `Sub-categories in ${row.label}`
                              : `Merchants in ${row.label}`
                          }
                          onClick={() => selectCategorySeries({ series: row })}
                        >
                          {row.drill.kind === 'group' ? 'Sub-categories' : 'Merchants'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {activeCategory && (
          <div className="trends-merchants-drilldown">
            <div className="filter-bar">
              <h4>
                Merchants in {activeCategory.category_name} ({periodLabels[0]} &ndash;{' '}
                {periodLabels[periodLabels.length - 1]})
              </h4>
              <button type="button" onClick={clearCategoryDrill}>
                Hide merchants
              </button>
            </div>

            {merchantLoading && (
              <LoadingState message={`Loading merchants for ${activeCategory.category_name}...`} />
            )}
            {!merchantLoading && merchantError && (
              <ErrorState label="Failed to load merchants:" message={merchantError} />
            )}
            {!merchantLoading && !merchantError && merchantData && (
              sortedMerchants.length === 0 ? (
                <EmptyState message="No merchant spending in this category for the selected window." />
              ) : (
                <table>
                  <caption className="visually-hidden">
                    Merchants in {activeCategory.category_name}
                  </caption>
                  <thead>
                    <tr>
                      <SortableHeader
                        label="Merchant"
                        sortKey="merchant"
                        activeSortKey={merchantSortKey}
                        activeDirection={merchantSortDirection}
                        onSort={onMerchantSort}
                      />
                      <SortableHeader
                        label="Transactions"
                        sortKey="count"
                        activeSortKey={merchantSortKey}
                        activeDirection={merchantSortDirection}
                        onSort={onMerchantSort}
                        numeric
                      />
                      <SortableHeader
                        label="Date Range"
                        sortKey="date_range"
                        activeSortKey={merchantSortKey}
                        activeDirection={merchantSortDirection}
                        onSort={onMerchantSort}
                      />
                      <SortableHeader
                        label={averageMode === 'month' ? 'Average Spend (per month)' : 'Average Spend (per transaction)'}
                        sortKey="average"
                        activeSortKey={merchantSortKey}
                        activeDirection={merchantSortDirection}
                        onSort={onMerchantSort}
                        numeric
                      />
                      <SortableHeader
                        label="Total Spent"
                        sortKey="total"
                        activeSortKey={merchantSortKey}
                        activeDirection={merchantSortDirection}
                        onSort={onMerchantSort}
                        numeric
                      />
                      <th scope="col"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedMerchants.map((m) => (
                      <tr key={m.narration_key}>
                        <td>
                          {editingMerchantKey === m.narration_key ? (
                            <div className="filter-bar">
                              <input
                                type="text"
                                aria-label={`Nickname for ${m.merchant}`}
                                placeholder={m.merchant}
                                value={nicknameInput}
                                onChange={(e) => setNicknameInput(e.target.value)}
                              />
                              <button
                                type="button"
                                onClick={() => saveNickname(m)}
                                disabled={savingNickname}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditingNickname}
                                disabled={savingNickname}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <>
                              {m.nickname || m.merchant}
                              {m.nickname && <span className="muted"> ({m.merchant})</span>}
                            </>
                          )}
                        </td>
                        <td className="numeric">{m.transaction_count}</td>
                        <td>
                          {m.first_date === m.last_date
                            ? formatDate(m.first_date)
                            : `${formatDate(m.first_date)} – ${formatDate(m.last_date)}`}
                        </td>
                        <td className="numeric">
                          <Amount
                            value={
                              averageMode === 'month'
                                ? Number((Number(m.total_spent) / monthCount).toFixed(2))
                                : m.average_spend
                            }
                            neutral
                          />
                        </td>
                        <td className="numeric">
                          <Amount value={m.total_spent} neutral />
                        </td>
                        <td>
                          <div className="filter-bar">
                            {editingMerchantKey !== m.narration_key && (
                              <button
                                type="button"
                                aria-label={`Nickname ${m.merchant}`}
                                onClick={() => startEditingNickname(m)}
                              >
                                {m.nickname ? 'Edit nickname' : 'Nickname'}
                              </button>
                            )}
                            <Link to={transactionIdsLedgerLink(m.transaction_ids)}>
                              View in ledger
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}
          </div>
        )}
      </Card>

      <Card id="trends-income-vs-spending" title="Income vs Spending vs Net">
        <p>Click the Income or Spending bar for a month to see the transactions behind it.</p>
        <BarChart
          periods={periodLabels}
          series={incomeSpendingSeries}
          formatValue={formatAmount}
          title="Income vs spending vs net"
          onSelectBar={openKindMonth}
        />
      </Card>

      <Card id="trends-budget-vs-actual" title="Budget vs Actual">
        {hasBudget ? (
          <>
            <p>Click the Actual bar for a month to see the transactions behind it.</p>
            <BarChart
              periods={periodLabels}
              series={budgetSeries}
              formatValue={formatAmount}
              title="Budget vs actual"
              onSelectBar={openKindMonth}
            />
          </>
        ) : (
          <EmptyState message="No categories have a budget set yet." />
        )}
      </Card>
    </section>
  )
}
