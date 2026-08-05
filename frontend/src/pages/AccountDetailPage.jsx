import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import Amount from '../components/Amount.jsx'
import Badge from '../components/Badge.jsx'
import Card from '../components/Card.jsx'
import CategorySelect from '../components/CategorySelect.jsx'
import LineChart from '../components/charts/LineChart.jsx'
import ErrorState from '../components/ErrorState.jsx'
import HeaderFilter from '../components/HeaderFilter.jsx'
import LoadingState from '../components/LoadingState.jsx'
import Pagination from '../components/Pagination.jsx'
import SortableHeader from '../components/SortableHeader.jsx'
import {
  DEFAULT_PAGE_SIZE,
  filtersFromSearchParams,
  nextSortParams,
  pageSizeFromSearchParams,
  searchParamsFromFilters,
  sortFromSearchParams,
} from '../components/ledgerFilterParams.js'
import { api } from '../services/api'
import { accountTypeLabel } from '../utils/accountTypes.js'
import { formatAmount, formatBalance, formatDate, transactionAmount } from '../utils/format.js'

// account_id is implicit from the route here, so it is never a form field and
// never carried in this page's own URL - it is added only when calling the API.
function queryParamsFromFilters(accountId, filters, pageSize) {
  const params = searchParamsFromFilters(filters, pageSize)
  params.set('account_id', accountId)
  return params
}

export default function AccountDetailPage() {
  const { accountId } = useParams()
  const [account, setAccount] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [pageInfo, setPageInfo] = useState({ total: 0, page: 1, page_size: DEFAULT_PAGE_SIZE, total_pages: 1 })
  const [categories, setCategories] = useState([])
  const [transactionTypes, setTransactionTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const [balanceHistory, setBalanceHistory] = useState(null)

  // Read straight from the URL, like the page number already is - see
  // ledgerFilterParams.pageSizeFromSearchParams.
  const pageSize = pageSizeFromSearchParams(searchParams)
  const { sort: activeSort, direction: activeDirection } = sortFromSearchParams(searchParams)
  // No staged form state - each header's own popover owns its draft (see
  // HeaderFilter) and this page just reflects whatever's committed to the
  // URL, the same as TransactionsPage now does. Account isn't among these
  // fields - it's implicit from the route here, never a filter a header
  // could even offer.
  const committedFilters = filtersFromSearchParams(searchParams)

  const applyFilterPatch = (patch) => {
    setSearchParams(searchParamsFromFilters({ ...committedFilters, ...patch }, pageSize))
  }

  // Independent of the ledger filters/page below - it only needs to refetch
  // when the account itself changes, not on every filter click.
  useEffect(() => {
    let cancelled = false

    api.get(`/accounts/${accountId}/balance-history`)
      .then((response) => {
        if (!cancelled) {
          setBalanceHistory(response.data)
        }
      })
      .catch(() => {
        // The chart is supplementary - a failed fetch just means it doesn't
        // render, it shouldn't take down the rest of the page.
      })

    return () => {
      cancelled = true
    }
  }, [accountId])

  const fetchData = async (cancelledRef) => {
    const query = queryParamsFromFilters(accountId, filtersFromSearchParams(searchParams), pageSize)
    // Page carries over from the URL if present (pagination links set it).
    if (searchParams.get('page')) {
      query.set('page', searchParams.get('page'))
    }
    // Sort likewise - this table is paginated, so sorting happens in SQL
    // (see services/ledger.py), not in the browser.
    if (activeSort) {
      query.set('sort', activeSort)
      query.set('direction', activeDirection)
    }

    const [accountRes, transactionsRes, categoriesRes, typesRes] = await Promise.all([
      api.get(`/accounts/${accountId}`),
      api.get(`/transactions?${query.toString()}`),
      api.get('/categories'),
      api.get('/transactions/types'),
    ])

    if (!cancelledRef?.current) {
      setAccount(accountRes.data)
      setTransactions(transactionsRes.data.items)
      setPageInfo({
        total: transactionsRes.data.total,
        page: transactionsRes.data.page,
        page_size: transactionsRes.data.page_size,
        total_pages: transactionsRes.data.total_pages,
      })
      setCategories(categoriesRes.data)
      setTransactionTypes(typesRes.data)
    }
  }

  // Refetches after a category change without dropping back to the loading
  // state, so the table doesn't flicker away mid-edit.
  const refresh = async () => {
    try {
      await fetchData()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Unknown error'
      setActionError(String(message))
    }
  }

  useEffect(() => {
    const cancelledRef = { current: false }

    setLoading(true)
    setError('')

    fetchData(cancelledRef)
      .catch((err) => {
        if (!cancelledRef.current) {
          const message = err?.response?.data?.detail || err?.message || 'Unknown error'
          setError(String(message))
        }
      })
      .finally(() => {
        if (!cancelledRef.current) {
          setLoading(false)
        }
      })

    return () => {
      cancelledRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, searchParams.toString()])

  // Categorizing from here uses the same endpoint as the main ledger. This
  // page stays review-oriented otherwise - no delete, make-rule or bulk bar -
  // but spotting a miscategorized row and being unable to fix it made the
  // page a dead end.
  const handleCategoryChange = async (transactionId, categoryId) => {
    setActionError('')
    try {
      await api.patch(`/transactions/${transactionId}/category`, {
        category_id: categoryId ? Number(categoryId) : null,
      })
      await refresh()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Category update failed'
      setActionError(String(message))
    }
  }

  const handlePageChange = (newPage) => {
    const next = new URLSearchParams(searchParams)
    next.set('page', String(newPage))
    setSearchParams(next)
  }

  // Resets to page 1 - page 7 at 50/page doesn't exist at 200/page.
  const handlePageSizeChange = (newSize) => {
    const next = new URLSearchParams(searchParams)
    next.set('page_size', String(newSize))
    next.set('page', '1')
    setSearchParams(next)
  }

  // Same server-side sort the main ledger uses - this table is paginated
  // too, so client-side sorting would silently sort only the current page.
  const handleSort = (key) => {
    setSearchParams(nextSortParams(searchParams, key))
  }

  if (loading) {
    return (
      <section className="page">
        <h2>Account</h2>
        <LoadingState message="Loading account..." />
      </section>
    )
  }

  if (error) {
    return (
      <section className="page">
        <h2>Account</h2>
        <ErrorState label="Failed to load account:" message={error} />
      </section>
    )
  }

  return (
    <section className="page">
      <h2>{account.name}</h2>

      <div className="card">
        <p>Institution: {account.institution || '—'}</p>
        <p>Type: {accountTypeLabel(account.account_type)}</p>
        <p>Account Number: {account.account_number}</p>
        <p>Balance: {formatBalance(account)}</p>
        {account.group_name && <p>Part of group: {account.group_name}</p>}
      </div>

      {balanceHistory && (
        <Card id="account-detail-balance-history" title="Balance History">
          {account.group_name && (
            <p className="text-muted">
              This account is part of the &quot;{account.group_name}&quot; group - the chart below
              is the group&apos;s stitched history, continuous across every member.
            </p>
          )}
          <LineChart
            periods={balanceHistory.periods.map((p) => p.label)}
            series={[{
              label: 'Balance',
              values: balanceHistory.periods.map((p) => {
                const value = balanceHistory.balances[p.label]
                return value === null || value === undefined ? null : Number(value)
              }),
            }]}
            formatValue={formatAmount}
            title="Balance history"
          />
        </Card>
      )}

      <Card id="account-detail-transactions" title="Transactions">
        {actionError && <ErrorState label="Action failed:" message={actionError} />}

        {transactions.length === 0 && <p>No transactions match these filters.</p>}

        {transactions.length > 0 && (
          <table>
            <caption className="visually-hidden">Transactions for this account</caption>
            <thead>
              <tr>
                <HeaderFilter
                  label="Date"
                  value={{ from: committedFilters.date_from, to: committedFilters.date_to }}
                  isActive={Boolean(committedFilters.date_from || committedFilters.date_to)}
                  onApply={(draft) => applyFilterPatch({ date_from: draft.from, date_to: draft.to })}
                  onClear={() => applyFilterPatch({ date_from: '', date_to: '' })}
                  sortKey="date"
                  activeSortKey={activeSort}
                  activeDirection={activeDirection}
                  onSort={handleSort}
                >
                  {(draft, setDraft) => (
                    <>
                      <label>
                        From date
                        <input
                          type="date"
                          value={draft.from}
                          onChange={(event) => setDraft({ ...draft, from: event.target.value })}
                        />
                      </label>
                      <label>
                        To date
                        <input
                          type="date"
                          value={draft.to}
                          onChange={(event) => setDraft({ ...draft, to: event.target.value })}
                        />
                      </label>
                    </>
                  )}
                </HeaderFilter>
                <HeaderFilter
                  label="Narration"
                  value={committedFilters.search}
                  isActive={Boolean(committedFilters.search)}
                  onApply={(draft) => applyFilterPatch({ search: draft })}
                  onClear={() => applyFilterPatch({ search: '' })}
                  sortKey="narration"
                  activeSortKey={activeSort}
                  activeDirection={activeDirection}
                  onSort={handleSort}
                >
                  {(draft, setDraft) => (
                    <label>
                      Narration contains
                      <input type="text" value={draft} onChange={(event) => setDraft(event.target.value)} />
                    </label>
                  )}
                </HeaderFilter>
                {/* Debit and Credit are shown as one Amount column - see
                    transactionAmount()'s own docstring in utils/format.js
                    for why merging them is lossless, not a display
                    compromise. One header now carries the filter and sort
                    that two headers used to share. */}
                <HeaderFilter
                  label="Amount"
                  value={{ min: committedFilters.min_amount, max: committedFilters.max_amount }}
                  isActive={Boolean(committedFilters.min_amount || committedFilters.max_amount)}
                  onApply={(draft) => applyFilterPatch({ min_amount: draft.min, max_amount: draft.max })}
                  onClear={() => applyFilterPatch({ min_amount: '', max_amount: '' })}
                  sortKey="amount"
                  activeSortKey={activeSort}
                  activeDirection={activeDirection}
                  onSort={handleSort}
                  numeric
                >
                  {(draft, setDraft) => (
                    <>
                      <label>
                        Min amount
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={draft.min}
                          onChange={(event) => setDraft({ ...draft, min: event.target.value })}
                        />
                      </label>
                      <label>
                        Max amount
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={draft.max}
                          onChange={(event) => setDraft({ ...draft, max: event.target.value })}
                        />
                      </label>
                    </>
                  )}
                </HeaderFilter>
                {/* Sortable only - there is no balance filter, and this
                    doesn't add one. */}
                <SortableHeader label="Balance" sortKey="balance" activeSortKey={activeSort} activeDirection={activeDirection} onSort={handleSort} numeric />
                <HeaderFilter
                  label="Type"
                  value={committedFilters.transaction_type}
                  isActive={Boolean(committedFilters.transaction_type)}
                  onApply={(draft) => applyFilterPatch({ transaction_type: draft })}
                  onClear={() => applyFilterPatch({ transaction_type: '' })}
                  sortKey="type"
                  activeSortKey={activeSort}
                  activeDirection={activeDirection}
                  onSort={handleSort}
                >
                  {(draft, setDraft) => (
                    <label>
                      Type
                      <select value={draft} onChange={(event) => setDraft(event.target.value)}>
                        <option value="">Any type</option>
                        {transactionTypes.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </HeaderFilter>
                <HeaderFilter
                  label="Category"
                  value={committedFilters.category}
                  isActive={Boolean(committedFilters.category)}
                  onApply={(draft) => applyFilterPatch({ category: draft })}
                  onClear={() => applyFilterPatch({ category: '' })}
                  sortKey="category"
                  activeSortKey={activeSort}
                  activeDirection={activeDirection}
                  onSort={handleSort}
                >
                  {(draft, setDraft) => (
                    <label>
                      Category
                      <CategorySelect categories={categories} value={draft} onChange={(event) => setDraft(event.target.value)}>
                        <option value="">All categories</option>
                        <option value="uncategorized">Uncategorized only</option>
                      </CategorySelect>
                    </label>
                  )}
                </HeaderFilter>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{formatDate(transaction.transaction_date)}</td>
                  <td className="cell-wrap">{transaction.narration}</td>
                  <td><Amount value={transactionAmount(transaction)} /></td>
                  <td><Amount value={transaction.balance} neutral /></td>
                  <td>{transaction.transaction_type}</td>
                  <td>
                    {transaction.is_split ? (
                      // Read-only here, deliberately - this page never
                      // offers the split editor, only /transactions does.
                      // A split transaction's own category_id is NULL by
                      // construction (see TransactionSplit's docstring in
                      // models.py), so it must NEVER render as the plain
                      // select below - that select's "Uncategorized"
                      // option would misrepresent an already-categorized
                      // transaction, and choosing it would silently wipe
                      // the split (PATCH .../category clears splits).
                      <div className="split-summary">
                        <Badge tone="info" title="This transaction is split across categories">split</Badge>
                        <ul>
                          {transaction.splits.map((split) => (
                            <li key={split.id}>
                              {split.category_name || 'Uncategorized'}: <Amount value={split.amount} />
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <CategorySelect
                        aria-label={`Category for ${transaction.narration}`}
                        categories={categories}
                        value={transaction.category_id ?? ''}
                        onChange={(e) => handleCategoryChange(transaction.id, e.target.value)}
                        fallbackOption={
                          transaction.category_id
                            ? { id: transaction.category_id, name: transaction.category_name }
                            : null
                        }
                      >
                        <option value="">Uncategorized</option>
                      </CategorySelect>
                    )}
                    {transaction.categorized_by_rule_id && (
                      <Badge tone="info" title="Set automatically by a rule">auto</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Rendered even with zero rows: a page that has gone out of range is
            exactly when you most need a way back. */}
        <Pagination
          pageInfo={pageInfo}
          onPageChange={handlePageChange}
          pageSize={pageSize}
          onPageSizeChange={handlePageSizeChange}
        />
      </Card>
    </section>
  )
}
