import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Amount from '../components/Amount.jsx'
import Badge from '../components/Badge.jsx'
import Card from '../components/Card.jsx'
import CategoryQuickAdd from '../components/CategoryQuickAdd.jsx'
import CsvFormatMapper from '../components/CsvFormatMapper.jsx'
import ErrorState from '../components/ErrorState.jsx'
import LedgerFilters from '../components/LedgerFilters.jsx'
import LoadingState from '../components/LoadingState.jsx'
import Pagination from '../components/Pagination.jsx'
import SplitEditor from '../components/SplitEditor.jsx'
import TransactionGroups from '../components/TransactionGroups.jsx'
import {
  EMPTY_FILTERS,
  filtersFromSearchParams,
  groupsQueryFromSearchParams,
  pageSizeFromSearchParams,
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
  const [splitEditorTransaction, setSplitEditorTransaction] = useState(null)
  const [mappingPanel, setMappingPanel] = useState(null)
  const navigate = useNavigate()

  // Read straight from the URL, like the page number already is - see
  // ledgerFilterParams.pageSizeFromSearchParams / groupsQueryFromSearchParams.
  const pageSize = pageSizeFromSearchParams(searchParams)
  const groupsQuery = groupsQueryFromSearchParams(searchParams)

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
    setSearchParams(searchParamsFromFilters(filterForm, pageSize))
  }

  const handleClearFilters = () => {
    setSelectedIds([])
    setFilterForm(EMPTY_FILTERS)
    setSearchParams(searchParamsFromFilters(EMPTY_FILTERS, pageSize))
  }

  const handlePageChange = (newPage) => {
    setSelectedIds([])
    const next = new URLSearchParams(searchParams)
    next.set('page', String(newPage))
    setSearchParams(next)
  }

  // Resets to page 1 - page 7 at 50/page doesn't exist at 200/page.
  const handlePageSizeChange = (newSize) => {
    setSelectedIds([])
    const next = new URLSearchParams(searchParams)
    next.set('page_size', String(newSize))
    next.set('page', '1')
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

      if (detail && typeof detail === 'object' && detail.needs_mapping) {
        // Kept as its own File object (not just the input's value, which
        // gets cleared below regardless of outcome) so the mapper can
        // re-submit the SAME bytes for preview and, once mapped, the real
        // import - without asking the user to re-select the file.
        setMappingPanel({ file, header: detail.header, sampleRows: detail.sample_rows })
      } else if (detail && typeof detail === 'object' && Array.isArray(detail.errors)) {
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

  const handleMappingImported = async (result) => {
    setMappingPanel(null)
    setUploadResult(result)
    await refresh({ withLookups: true })
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

  // Commits on blur rather than per keystroke - the same "apply on an
  // explicit action" philosophy LedgerFilters follows, and it avoids a
  // request per character typed. No-ops when nothing actually changed, so
  // clicking into a note and back out without editing it doesn't refetch
  // the whole page for nothing.
  const handleNoteChange = async (transaction, note) => {
    const trimmed = note.trim()
    if (trimmed === (transaction.note || '')) {
      return
    }
    setActionError('')
    try {
      await api.patch(`/transactions/${transaction.id}/note`, { note: trimmed || null })
      await refresh()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Note update failed'
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

  // Shared by every place on this page a category can be created inline
  // (the bulk-assign toolbar and the similar-transactions groups card) -
  // every select on the page sees the new category immediately, and the
  // caller's own selection (bulk or per-group) adopts it right away.
  const handleCategoryCreated = (category, selectAfter) => {
    setCategories((prev) => [...prev, category].sort((a, b) => a.name.localeCompare(b.name)))
    if (selectAfter) {
      selectAfter(String(category.id))
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

      <Card id="transactions-import" title="Import CSV">
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
      </Card>

      <Card id="transactions-import-history" title="Import History">
        <button type="button" className="button-danger" onClick={handleWipeAll} disabled={loading}>
          Wipe all
        </button>

        <table>
          <caption className="visually-hidden">Import history</caption>
          <thead>
            <tr>
              <th scope="col">Filename</th>
              <th scope="col">Imported At</th>
              <th scope="col">Imported</th>
              <th scope="col">Skipped Duplicates</th>
              <th scope="col"></th>
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
      </Card>

      <LedgerFilters
        values={filterForm}
        onFieldChange={handleFilterFieldChange}
        onApply={handleApplyFilters}
        onClear={handleClearFilters}
        categories={categories}
        transactionTypes={transactionTypes}
        accounts={accounts}
      />

      <TransactionGroups
        groupsQuery={groupsQuery}
        categories={categories}
        onCategoryCreated={handleCategoryCreated}
        onAssigned={refresh}
      />

      <Card id="transactions-ledger" title="Ledger">
        {loading && <LoadingState message="Loading transactions..." />}
        {!loading && error && <ErrorState label="Failed to load transactions:" message={error} />}

        {!loading && !error && (
          <>
            <div className="ledger-toolbar">
              <CategoryQuickAdd
                categories={categories}
                value={bulkCategoryId}
                onChange={setBulkCategoryId}
                onCategoryCreated={(category) => handleCategoryCreated(category, setBulkCategoryId)}
                label="Bulk category"
              />
              <button type="button" className="button-primary" onClick={handleBulkAssign} disabled={selectedIds.length === 0}>
                Set category for selected ({selectedIds.length})
              </button>
              <button type="button" onClick={handleApplyRules} disabled={applying}>
                Apply rules now
              </button>
              {applyMessage && <span>{applyMessage}</span>}
            </div>

            <div className="table-scroll">
              <table>
                <caption className="visually-hidden">Ledger</caption>
                <thead>
                  <tr>
                    <th scope="col">
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
                    <th scope="col">Date</th>
                    <th scope="col">Account</th>
                    <th scope="col">Narration</th>
                    <th scope="col">Debit</th>
                    <th scope="col">Credit</th>
                    <th scope="col">Balance</th>
                    <th scope="col">Type</th>
                    <th scope="col">Category</th>
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
                        {transaction.is_split ? (
                          <div className="split-summary">
                            <Badge tone="info" title="This transaction is split across categories">split</Badge>
                            <ul>
                              {transaction.splits.map((split) => (
                                <li key={split.id}>
                                  {split.category_name || 'Uncategorized'}: <Amount value={split.amount} />
                                </li>
                              ))}
                            </ul>
                            <button
                              type="button"
                              className="button-ghost"
                              onClick={() => setSplitEditorTransaction(transaction)}
                            >
                              Edit split
                            </button>
                          </div>
                        ) : (
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
                        )}
                        {/* Import filename and row actions live here rather
                            than as their own columns - both are low-frequency
                            and text-heavy, and were what pushed the table
                            into horizontal scroll on every viewport. */}
                        <div className="ledger-row-meta">
                          {transaction.categorized_by_rule_id && (
                            <Badge tone="info" title="Set automatically by a rule">auto</Badge>
                          )}
                          <span className="text-muted">{batchFilename(transaction.import_batch_id)}</span>
                          <input
                            type="text"
                            className="ledger-note-input"
                            placeholder="Add a note..."
                            defaultValue={transaction.note || ''}
                            onBlur={(e) => handleNoteChange(transaction, e.target.value)}
                            aria-label={`Note for ${transaction.narration}`}
                          />
                          {!transaction.is_split && (
                            <button
                              type="button"
                              className="button-ghost"
                              onClick={() => setSplitEditorTransaction(transaction)}
                            >
                              Split
                            </button>
                          )}
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
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              pageInfo={pageInfo}
              onPageChange={handlePageChange}
              pageSize={pageSize}
              onPageSizeChange={handlePageSizeChange}
            />
          </>
        )}
      </Card>

      {splitEditorTransaction && (
        <SplitEditor
          transaction={splitEditorTransaction}
          categories={categories}
          onCategoryCreated={handleCategoryCreated}
          onClose={() => setSplitEditorTransaction(null)}
          onSaved={() => {
            setSplitEditorTransaction(null)
            refresh()
          }}
        />
      )}

      {mappingPanel && (
        <CsvFormatMapper
          file={mappingPanel.file}
          header={mappingPanel.header}
          sampleRows={mappingPanel.sampleRows}
          onClose={() => setMappingPanel(null)}
          onImported={handleMappingImported}
        />
      )}
    </section>
  )
}
