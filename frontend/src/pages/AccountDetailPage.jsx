import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import Amount from '../components/Amount.jsx'
import Badge from '../components/Badge.jsx'
import LineChart from '../components/charts/LineChart.jsx'
import ErrorState from '../components/ErrorState.jsx'
import LedgerFilters from '../components/LedgerFilters.jsx'
import LoadingState from '../components/LoadingState.jsx'
import Pagination from '../components/Pagination.jsx'
import {
  EMPTY_FILTERS,
  filtersFromSearchParams,
  pageSizeFromSearchParams,
  searchParamsFromFilters,
} from '../components/ledgerFilterParams.js'
import { api } from '../services/api'
import { formatAmount, formatBalance } from '../utils/format.js'

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
  const [pageInfo, setPageInfo] = useState({ total: 0, page: 1, page_size: 50, total_pages: 1 })
  const [categories, setCategories] = useState([])
  const [transactionTypes, setTransactionTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const [filterForm, setFilterForm] = useState(() => filtersFromSearchParams(searchParams))
  const [balanceHistory, setBalanceHistory] = useState(null)

  // Read straight from the URL, like the page number already is - see
  // ledgerFilterParams.pageSizeFromSearchParams.
  const pageSize = pageSizeFromSearchParams(searchParams)

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
    setFilterForm(filtersFromSearchParams(searchParams))

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

  const handleFilterFieldChange = (field) => (event) => {
    setFilterForm((prev) => ({ ...prev, [field]: event.target.value }))
  }

  const handleApplyFilters = (event) => {
    event.preventDefault()
    const params = queryParamsFromFilters(accountId, filterForm, pageSize)
    params.delete('account_id') // implicit from the route, not carried in the URL here
    setSearchParams(params)
  }

  const handleClearFilters = () => {
    setFilterForm(EMPTY_FILTERS)
    setSearchParams(searchParamsFromFilters(EMPTY_FILTERS, pageSize))
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

  if (loading) {
    return (
      <section className="card">
        <h2>Account</h2>
        <LoadingState message="Loading account..." />
      </section>
    )
  }

  if (error) {
    return (
      <section className="card">
        <h2>Account</h2>
        <ErrorState label="Failed to load account:" message={error} />
      </section>
    )
  }

  return (
    <section className="card">
      <h2>{account.name}</h2>

      <div className="card">
        <p>Institution: {account.institution || '—'}</p>
        <p>Type: {account.account_type || '—'}</p>
        <p>Account Number: {account.account_number}</p>
        <p>Balance: {formatBalance(account)}</p>
      </div>

      {balanceHistory && (
        <div className="card">
          <h3>Balance History</h3>
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
        </div>
      )}

      <LedgerFilters
        values={filterForm}
        onFieldChange={handleFilterFieldChange}
        onApply={handleApplyFilters}
        onClear={handleClearFilters}
        categories={categories}
        transactionTypes={transactionTypes}
      />

      <div className="card">
        <h3>Transactions</h3>

        {actionError && <ErrorState label="Action failed:" message={actionError} />}

        {transactions.length === 0 && <p>No transactions match these filters.</p>}

        {transactions.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Narration</th>
                <th>Debit</th>
                <th>Credit</th>
                <th>Balance</th>
                <th>Type</th>
                <th>Category</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{transaction.transaction_date}</td>
                  <td>{transaction.narration}</td>
                  <td><Amount value={transaction.debit} /></td>
                  <td><Amount value={transaction.credit} /></td>
                  <td><Amount value={transaction.balance} neutral /></td>
                  <td>{transaction.transaction_type}</td>
                  <td>
                    <select
                      aria-label={`Category for ${transaction.narration}`}
                      value={transaction.category_id ?? ''}
                      onChange={(e) => handleCategoryChange(transaction.id, e.target.value)}
                    >
                      <option value="">Uncategorized</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
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
      </div>
    </section>
  )
}
