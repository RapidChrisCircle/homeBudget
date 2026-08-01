import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import LineChart from '../components/charts/LineChart.jsx'
import LedgerFilters from '../components/LedgerFilters.jsx'
import Pagination from '../components/Pagination.jsx'
import {
  EMPTY_FILTERS,
  filtersFromSearchParams,
  searchParamsFromFilters,
} from '../components/ledgerFilterParams.js'
import { api } from '../services/api'
import { formatAmount, formatBalance } from '../utils/format.js'

// account_id is implicit from the route here, so it is never a form field and
// never carried in this page's own URL - it is added only when calling the API.
function queryParamsFromFilters(accountId, filters) {
  const params = searchParamsFromFilters(filters)
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
    const query = queryParamsFromFilters(accountId, filtersFromSearchParams(searchParams))
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
    const params = queryParamsFromFilters(accountId, filterForm)
    params.delete('account_id') // implicit from the route, not carried in the URL here
    setSearchParams(params)
  }

  const handleClearFilters = () => {
    setFilterForm(EMPTY_FILTERS)
    setSearchParams({})
  }

  const handlePageChange = (newPage) => {
    const next = new URLSearchParams(searchParams)
    next.set('page', String(newPage))
    setSearchParams(next)
  }

  if (loading) {
    return (
      <section className="card">
        <h2>Account</h2>
        <p>Loading account...</p>
      </section>
    )
  }

  if (error) {
    return (
      <section className="card">
        <h2>Account</h2>
        <p>
          <strong>Failed to load account:</strong> {error}
        </p>
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

        {actionError && (
          <p>
            <strong>Action failed:</strong> {actionError}
          </p>
        )}

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
                  <td>{formatAmount(transaction.debit)}</td>
                  <td>{formatAmount(transaction.credit)}</td>
                  <td>{formatAmount(transaction.balance)}</td>
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
                      <span title="Set automatically by a rule"> auto</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Rendered even with zero rows: a page that has gone out of range is
            exactly when you most need a way back. */}
        <Pagination pageInfo={pageInfo} onPageChange={handlePageChange} />
      </div>
    </section>
  )
}
