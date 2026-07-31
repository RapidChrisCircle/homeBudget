import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../services/api'

function formatAccount(transaction) {
  if (transaction.bsb_number) {
    return `${transaction.bsb_number} / ${transaction.account_number}`
  }
  return transaction.account_number
}

function formatAmount(value) {
  if (value === null || value === undefined) {
    return ''
  }
  return Number(value).toFixed(2)
}

const EMPTY_FILTERS = {
  account_id: '',
  category: '', // '' = all, 'uncategorized' = uncategorized only, else a category id
  date_from: '',
  date_to: '',
  search: '',
  transaction_type: '',
  min_amount: '',
  max_amount: '',
}

// Reads the filter values a search-params object carries, in the shape the
// filter form uses (a single "category" field standing in for the two
// distinct query params category_id / uncategorized).
function filtersFromSearchParams(searchParams) {
  return {
    account_id: searchParams.get('account_id') || '',
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

// The inverse: turns filter form values into the query params /transactions
// actually understands. Resets to page 1 - a new filter invalidates whatever
// page you were on.
function searchParamsFromFilters(filters) {
  const params = new URLSearchParams()

  if (filters.account_id) params.set('account_id', filters.account_id)

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

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState([])
  const [batches, setBatches] = useState([])
  const [categories, setCategories] = useState([])
  const [accounts, setAccounts] = useState([])
  const [transactionTypes, setTransactionTypes] = useState([])
  const [pageInfo, setPageInfo] = useState({ total: 0, page: 1, page_size: 50, total_pages: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const [uploadErrors, setUploadErrors] = useState(null)
  const [actionError, setActionError] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [bulkCategoryId, setBulkCategoryId] = useState('')
  const [applyMessage, setApplyMessage] = useState('')
  const [applying, setApplying] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const [filterForm, setFilterForm] = useState(() => filtersFromSearchParams(searchParams))
  const navigate = useNavigate()

  const fetchData = async (cancelledRef) => {
    const [transactionsRes, batchesRes, categoriesRes, accountsRes, typesRes] = await Promise.all([
      api.get(`/transactions?${searchParams.toString()}`),
      api.get('/import-batches'),
      api.get('/categories'),
      api.get('/accounts'),
      api.get('/transactions/types'),
    ])

    if (!cancelledRef?.current) {
      setTransactions(transactionsRes.data.items)
      setPageInfo({
        total: transactionsRes.data.total,
        page: transactionsRes.data.page,
        page_size: transactionsRes.data.page_size,
        total_pages: transactionsRes.data.total_pages,
      })
      setBatches(batchesRes.data)
      setCategories(categoriesRes.data)
      setAccounts(accountsRes.data)
      setTransactionTypes(typesRes.data)
    }
  }

  // Refreshes data after a mutation (delete/wipe/import) without dropping
  // back to the loading state, so the tables don't flicker away mid-action.
  const refresh = async () => {
    try {
      await fetchData()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Unknown error'
      setError(String(message))
    }
  }

  // Filters (and the current page) live in the URL - this is what makes a
  // filtered view reloadable, shareable, and lets other pages (e.g. Reports'
  // "review uncategorized" link) deep-link straight into a filtered ledger.
  // Re-fetches whenever the URL's query string changes, from any source:
  // Apply/Clear, a page-change click, or an external deep link on mount.
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
  }, [searchParams.toString()])

  const handleFilterFieldChange = (field) => (event) => {
    setFilterForm((prev) => ({ ...prev, [field]: event.target.value }))
  }

  const handleApplyFilters = (event) => {
    event.preventDefault()
    setSelectedIds([])
    setSearchParams(searchParamsFromFilters(filterForm))
  }

  const handleClearFilters = () => {
    setSelectedIds([])
    setFilterForm(EMPTY_FILTERS)
    setSearchParams({})
  }

  const handlePageChange = (newPage) => {
    setSelectedIds([])
    const next = new URLSearchParams(searchParams)
    next.set('page', String(newPage))
    setSearchParams(next)
  }

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    setUploading(true)
    setUploadResult(null)
    setUploadErrors(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await api.post('/transactions/import', formData)
      setUploadResult(response.data)
      await refresh()
    } catch (err) {
      const detail = err?.response?.data?.detail

      if (detail && typeof detail === 'object' && Array.isArray(detail.errors)) {
        setUploadErrors(detail.errors)
      } else {
        const message = detail || err?.message || 'Import failed'
        setUploadErrors([{ row_number: null, message: String(message) }])
      }
    } finally {
      setUploading(false)
      event.target.value = ''
    }
  }

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

  const toggleSelected = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((selectedId) => selectedId !== id) : [...prev, id]
    )
  }

  const handleBulkAssign = async () => {
    if (selectedIds.length === 0) {
      return
    }
    setActionError('')
    try {
      await api.post('/transactions/bulk-category', {
        transaction_ids: selectedIds,
        category_id: bulkCategoryId ? Number(bulkCategoryId) : null,
      })
      setSelectedIds([])
      setBulkCategoryId('')
      await refresh()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Bulk category update failed'
      setActionError(String(message))
    }
  }

  const handleApplyRules = async () => {
    setActionError('')
    setApplying(true)
    try {
      const response = await api.post('/category-rules/apply')
      setApplyMessage(`Categorized ${response.data.categorized_count} transaction(s).`)
      await refresh()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Apply rules failed'
      setActionError(String(message))
    } finally {
      setApplying(false)
    }
  }

  const handleMakeRule = (narration) => {
    navigate(`/rules?narration=${encodeURIComponent(narration)}`)
  }

  const handleDeleteTransaction = async (id) => {
    setActionError('')
    try {
      await api.delete(`/transactions/${id}`)
      await refresh()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Delete failed'
      setActionError(String(message))
    }
  }

  const handleDeleteBatch = async (id) => {
    if (!window.confirm('Delete this import and all its transactions?')) {
      return
    }
    setActionError('')
    try {
      await api.delete(`/import-batches/${id}`)
      await refresh()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Delete failed'
      setActionError(String(message))
    }
  }

  const handleWipeAll = async () => {
    if (!window.confirm('Delete ALL transactions and import history? This cannot be undone.')) {
      return
    }
    setActionError('')
    try {
      await api.delete('/transactions')
      setUploadResult(null)
      setUploadErrors(null)
      await refresh()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Wipe failed'
      setActionError(String(message))
    }
  }

  const batchFilename = (importBatchId) => {
    const batch = batches.find((b) => b.id === importBatchId)
    return batch ? batch.filename : `#${importBatchId}`
  }

  return (
    <section className="card">
      <h2>Transactions</h2>

      {actionError && (
        <p>
          <strong>Action failed:</strong> {actionError}
        </p>
      )}

      <div className="card">
        <h3>Import CSV</h3>
        <input type="file" accept=".csv" onChange={handleFileChange} disabled={uploading} />

        {uploading && <p>Importing...</p>}

        {!uploading && uploadResult && (
          <p>
            Imported {uploadResult.imported_count} transaction(s), skipped{' '}
            {uploadResult.skipped_duplicate_count} duplicate(s), created{' '}
            {uploadResult.new_account_count} new account(s), auto-categorized{' '}
            {uploadResult.auto_categorized_count} transaction(s).
          </p>
        )}

        {!uploading && uploadErrors && (
          <div>
            <p>
              <strong>Import rejected:</strong>
            </p>
            <ul>
              {uploadErrors.map((e, index) => (
                <li key={index}>
                  {e.row_number ? `Row ${e.row_number}: ` : ''}
                  {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Import History</h3>
        <button type="button" onClick={handleWipeAll} disabled={loading}>
          Wipe all
        </button>

        <table>
          <thead>
            <tr>
              <th>Filename</th>
              <th>Imported At</th>
              <th>Imported</th>
              <th>Skipped Duplicates</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {batches.map((batch) => (
              <tr key={batch.id}>
                <td>{batch.filename}</td>
                <td>{new Date(batch.imported_at).toLocaleString()}</td>
                <td>{batch.row_count}</td>
                <td>{batch.skipped_duplicate_count}</td>
                <td>
                  <button type="button" onClick={() => handleDeleteBatch(batch.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Filters</h3>
        <form onSubmit={handleApplyFilters}>
          <div>
            <label>
              Account
              <select value={filterForm.account_id} onChange={handleFilterFieldChange('account_id')}>
                <option value="">All accounts</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
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
        <h3>Ledger</h3>

        {loading && <p>Loading transactions...</p>}
        {!loading && error && (
          <p>
            <strong>Failed to load transactions:</strong> {error}
          </p>
        )}

        {!loading && !error && (
          <>
            <div>
              <select value={bulkCategoryId} onChange={(e) => setBulkCategoryId(e.target.value)}>
                <option value="">Uncategorized</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <button type="button" onClick={handleBulkAssign} disabled={selectedIds.length === 0}>
                Set category for selected ({selectedIds.length})
              </button>
              <button type="button" onClick={handleApplyRules} disabled={applying}>
                Apply rules now
              </button>
              {applyMessage && <span>{applyMessage}</span>}
            </div>

            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Date</th>
                  <th>Account</th>
                  <th>Narration</th>
                  <th>Debit</th>
                  <th>Credit</th>
                  <th>Balance</th>
                  <th>Type</th>
                  <th>Category</th>
                  <th>Import</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(transaction.id)}
                        onChange={() => toggleSelected(transaction.id)}
                      />
                    </td>
                    <td>{transaction.transaction_date}</td>
                    <td>{transaction.account_name || formatAccount(transaction)}</td>
                    <td>{transaction.narration}</td>
                    <td>{formatAmount(transaction.debit)}</td>
                    <td>{formatAmount(transaction.credit)}</td>
                    <td>{formatAmount(transaction.balance)}</td>
                    <td>{transaction.transaction_type}</td>
                    <td>
                      <select
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
                    <td>{batchFilename(transaction.import_batch_id)}</td>
                    <td>
                      <button
                        type="button"
                        aria-label={`Make rule from ${transaction.narration}`}
                        onClick={() => handleMakeRule(transaction.narration)}
                      >
                        Make rule
                      </button>
                      <button type="button" onClick={() => handleDeleteTransaction(transaction.id)}>
                        Delete
                      </button>
                    </td>
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
