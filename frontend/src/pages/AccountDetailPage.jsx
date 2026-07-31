import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { api } from '../services/api'

function formatAmount(value) {
  if (value === null || value === undefined) {
    return ''
  }
  return Number(value).toFixed(2)
}

const EMPTY_FILTERS = {
  category: '', // '' = all, 'uncategorized' = uncategorized only, else a category id
  date_from: '',
  date_to: '',
  search: '',
  transaction_type: '',
  min_amount: '',
  max_amount: '',
}

function filtersFromSearchParams(searchParams) {
  return {
    category: searchParams.get('uncategorized') === 'true'
      ? 'uncategorized'
      : searchParams.get('category_id') || '',
    date_from: searchParams.get('date_from') || '',
    date_to: searchParams.get('date_to') || '',
    search: searchParams.get('search') || '',
    transaction_type: searchParams.get('transaction_type') || '',
    min_amount: searchParams.get('min_amount') || '',
    max_amount: searchParams.get('max_amount') || '',
  }
}

// account_id is implicit from the route, not a form field here.
function queryParamsFromFilters(accountId, filters) {
  const params = new URLSearchParams()
  params.set('account_id', accountId)

  if (filters.category === 'uncategorized') {
    params.set('uncategorized', 'true')
  } else if (filters.category) {
    params.set('category_id', filters.category)
  }

  if (filters.date_from) params.set('date_from', filters.date_from)
  if (filters.date_to) params.set('date_to', filters.date_to)
  if (filters.search) params.set('search', filters.search)
  if (filters.transaction_type) params.set('transaction_type', filters.transaction_type)
  if (filters.min_amount) params.set('min_amount', filters.min_amount)
  if (filters.max_amount) params.set('max_amount', filters.max_amount)

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
  const [searchParams, setSearchParams] = useSearchParams()
  const [filterForm, setFilterForm] = useState(() => filtersFromSearchParams(searchParams))

  useEffect(() => {
    let cancelled = false

    setLoading(true)
    setError('')
    setFilterForm(filtersFromSearchParams(searchParams))

    const query = queryParamsFromFilters(accountId, filtersFromSearchParams(searchParams))
    // Page carries over from the URL if present (pagination links set it).
    if (searchParams.get('page')) {
      query.set('page', searchParams.get('page'))
    }

    Promise.all([
      api.get(`/accounts/${accountId}`),
      api.get(`/transactions?${query.toString()}`),
      api.get('/categories'),
      api.get('/transactions/types'),
    ])
      .then(([accountRes, transactionsRes, categoriesRes, typesRes]) => {
        if (!cancelled) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, searchParams.toString()])

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
        <p>
          Balance:{' '}
          {account.balance === null
            ? 'No transactions yet'
            : `${formatAmount(account.balance)} (as of ${account.balance_as_of})`}
        </p>
      </div>

      <div className="card">
        <h3>Filters</h3>
        <form onSubmit={handleApplyFilters}>
          <div>
            <label>
              Category
              <select value={filterForm.category} onChange={handleFilterFieldChange('category')}>
                <option value="">All categories</option>
                <option value="uncategorized">Uncategorized only</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <label>
              From date
              <input type="date" value={filterForm.date_from} onChange={handleFilterFieldChange('date_from')} />
            </label>
          </div>
          <div>
            <label>
              To date
              <input type="date" value={filterForm.date_to} onChange={handleFilterFieldChange('date_to')} />
            </label>
          </div>
          <div>
            <label>
              Narration contains
              <input type="text" value={filterForm.search} onChange={handleFilterFieldChange('search')} />
            </label>
          </div>
          <div>
            <label>
              Type
              <select
                value={filterForm.transaction_type}
                onChange={handleFilterFieldChange('transaction_type')}
              >
                <option value="">Any type</option>
                {transactionTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <label>
              Min amount
              <input
                type="number"
                step="0.01"
                min="0"
                value={filterForm.min_amount}
                onChange={handleFilterFieldChange('min_amount')}
              />
            </label>
          </div>
          <div>
            <label>
              Max amount
              <input
                type="number"
                step="0.01"
                min="0"
                value={filterForm.max_amount}
                onChange={handleFilterFieldChange('max_amount')}
              />
            </label>
          </div>
          <button type="submit">Apply filters</button>
          <button type="button" onClick={handleClearFilters}>
            Clear filters
          </button>
        </form>
      </div>

      <div className="card">
        <h3>Transactions</h3>

        {transactions.length === 0 && <p>No transactions match these filters.</p>}

        {transactions.length > 0 && (
          <>
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
                    <td>{transaction.category_name || 'Uncategorized'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div>
              <button
                type="button"
                onClick={() => handlePageChange(pageInfo.page - 1)}
                disabled={pageInfo.page <= 1}
              >
                Previous
              </button>
              <span>
                {' '}Page {pageInfo.page} of {pageInfo.total_pages} ({pageInfo.total} total){' '}
              </span>
              <button
                type="button"
                onClick={() => handlePageChange(pageInfo.page + 1)}
                disabled={pageInfo.page >= pageInfo.total_pages}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
