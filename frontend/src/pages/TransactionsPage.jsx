import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Amount from '../components/Amount.jsx'
import Badge from '../components/Badge.jsx'
import ErrorState from '../components/ErrorState.jsx'
import LedgerFilters from '../components/LedgerFilters.jsx'
import LoadingState from '../components/LoadingState.jsx'
import Pagination from '../components/Pagination.jsx'
import {
  EMPTY_FILTERS,
  filtersFromSearchParams,
  searchParamsFromFilters,
} from '../components/ledgerFilterParams.js'
import { api } from '../services/api'

function formatAccount(transaction) {
  if (transaction.bsb_number) {
    return `${transaction.bsb_number} / ${transaction.account_number}`
  }
  return transaction.account_number
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

  // The lookups that populate the filter dropdowns and the import history.
  // None of them depend on the current filters, so they are deliberately NOT
  // refetched when a filter changes - only when something that can actually
  // change them happens (an import can create both accounts and batches).
  const fetchLookups = async (cancelledRef) => {
    const [batchesRes, categoriesRes, accountsRes, typesRes] = await Promise.all([
      api.get('/import-batches'),
      api.get('/categories'),
      api.get('/accounts'),
      api.get('/transactions/types'),
    ])

    if (!cancelledRef?.current) {
      setBatches(batchesRes.data)
      setCategories(categoriesRes.data)
      setAccounts(accountsRes.data)
      setTransactionTypes(typesRes.data)
    }
  }

  const fetchTransactions = async (cancelledRef) => {
    const response = await api.get(`/transactions?${searchParams.toString()}`)

    if (!cancelledRef?.current) {
      setTransactions(response.data.items)
      setPageInfo({
        total: response.data.total,
        page: response.data.page,
        page_size: response.data.page_size,
        total_pages: response.data.total_pages,
      })
    }
  }

  // Refreshes after a mutation without dropping back to the loading state, so
  // the tables don't flicker away mid-action. `withLookups` is for mutations
  // that can change accounts/batches (import, wipe, batch delete); row-level
  // edits leave the lookups untouched and skip them.
  const refresh = async ({ withLookups = false } = {}) => {
    try {
      await Promise.all([fetchTransactions(), withLookups ? fetchLookups() : null])
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Unknown error'
      setError(String(message))
    }
  }

  useEffect(() => {
    const cancelledRef = { current: false }

    fetchLookups(cancelledRef).catch((err) => {
      if (!cancelledRef.current) {
        const message = err?.response?.data?.detail || err?.message || 'Unknown error'
        setError(String(message))
      }
    })

    return () => {
      cancelledRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

    fetchTransactions(cancelledRef)
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
      // An import adds a batch and can auto-create accounts.
      await refresh({ withLookups: true })
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

  // Selects exactly the rows on this page - which is all selection can mean
  // here, since it already clears whenever the page changes. A cross-page
  // "select all" would act on rows the user can't see.
  const allOnPageSelected = transactions.length > 0 && selectedIds.length === transactions.length

  const toggleSelectAllOnPage = () => {
    setSelectedIds(allOnPageSelected ? [] : transactions.map((transaction) => transaction.id))
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
      await refresh({ withLookups: true })
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
      await refresh({ withLookups: true })
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

      {actionError && <ErrorState label="Action failed:" message={actionError} />}

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
        <button type="button" className="button-danger" onClick={handleWipeAll} disabled={loading}>
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
                  <button type="button" className="button-danger" onClick={() => handleDeleteBatch(batch.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <LedgerFilters
        values={filterForm}
        onFieldChange={handleFilterFieldChange}
        onApply={handleApplyFilters}
        onClear={handleClearFilters}
        categories={categories}
        transactionTypes={transactionTypes}
        accounts={accounts}
      />

      <div className="card">
        <h3>Ledger</h3>

        {loading && <LoadingState message="Loading transactions..." />}
        {!loading && error && <ErrorState label="Failed to load transactions:" message={error} />}

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
              <button type="button" className="button-primary" onClick={handleBulkAssign} disabled={selectedIds.length === 0}>
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
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Select all on this page"
                      checked={allOnPageSelected}
                      ref={(node) => {
                        if (node) {
                          node.indeterminate =
                            selectedIds.length > 0 && selectedIds.length < transactions.length
                        }
                      }}
                      onChange={toggleSelectAllOnPage}
                      disabled={transactions.length === 0}
                    />
                  </th>
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
                    <td><Amount value={transaction.debit} /></td>
                    <td><Amount value={transaction.credit} /></td>
                    <td><Amount value={transaction.balance} neutral /></td>
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
                        <Badge tone="info" title="Set automatically by a rule">auto</Badge>
                      )}
                    </td>
                    <td>{batchFilename(transaction.import_batch_id)}</td>
                    <td>
                      <button
                        type="button"
                        className="button-ghost"
                        aria-label={`Make rule from ${transaction.narration}`}
                        onClick={() => handleMakeRule(transaction.narration)}
                      >
                        Make rule
                      </button>
                      <button type="button" className="button-danger" onClick={() => handleDeleteTransaction(transaction.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <Pagination pageInfo={pageInfo} onPageChange={handlePageChange} />
          </>
        )}
      </div>
    </section>
  )
}
