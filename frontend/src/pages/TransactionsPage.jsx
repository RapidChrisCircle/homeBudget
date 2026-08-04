import { Fragment, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Amount from '../components/Amount.jsx'
import Badge from '../components/Badge.jsx'
import Card from '../components/Card.jsx'
import CategoryQuickAdd from '../components/CategoryQuickAdd.jsx'
import CategorySelect from '../components/CategorySelect.jsx'
import CsvFormatMapper from '../components/CsvFormatMapper.jsx'
import EmptyState from '../components/EmptyState.jsx'
import ErrorState from '../components/ErrorState.jsx'
import LedgerFilters from '../components/LedgerFilters.jsx'
import LoadingState from '../components/LoadingState.jsx'
import Pagination from '../components/Pagination.jsx'
import RuleEditor from '../components/RuleEditor.jsx'
import SplitEditor from '../components/SplitEditor.jsx'
import {
  DEFAULT_PAGE_SIZE,
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
  const [accountGroups, setAccountGroups] = useState([])
  const [transactionTypes, setTransactionTypes] = useState([])
  const [pageInfo, setPageInfo] = useState({ total: 0, page: 1, page_size: DEFAULT_PAGE_SIZE, total_pages: 1 })
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
  const [ruleEditorTransaction, setRuleEditorTransaction] = useState(null)
  const [mappingPanel, setMappingPanel] = useState(null)
  // Per-row disclosure state for the low-frequency actions (filename, note,
  // Split/Make rule/Delete) - a Set of transaction ids rather than a single
  // "expanded row", since more than one row can be open at once. Cleared
  // whenever the page's own contents change (a new page, a changed filter)
  // so an id from a row that's no longer on screen never lingers.
  const [expandedIds, setExpandedIds] = useState(new Set())
  // The ledger's Group by merchant toggle - an in-table view over the SAME
  // filtered set (see services/ledger.transaction_groups' include_categorized
  // flag), replacing the old "Similar Uncategorized" card rather than living
  // alongside it. Server-side over the whole filtered set, not paginated -
  // grouping within a page would be arbitrary.
  const [groupByMerchant, setGroupByMerchant] = useState(false)
  const [groups, setGroups] = useState([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [groupsError, setGroupsError] = useState('')
  const [expandedGroupKeys, setExpandedGroupKeys] = useState(new Set())
  // Keyed on narration_key, same reasoning TransactionGroups (the card this
  // replaces) used: cleared for a key once its group is successfully
  // assigned, so a later, unrelated group reusing the same key never
  // inherits a stale selection.
  const [groupCategorySelections, setGroupCategorySelections] = useState({})
  const [assigningGroupKey, setAssigningGroupKey] = useState(null)

  // Read straight from the URL, like the page number already is - see
  // ledgerFilterParams.pageSizeFromSearchParams / groupsQueryFromSearchParams.
  const pageSize = pageSizeFromSearchParams(searchParams)
  const groupsQuery = groupsQueryFromSearchParams(searchParams)
  const groupedLedgerQuery = groupsQuery ? `${groupsQuery}&include_categorized=true` : 'include_categorized=true'

  // The lookups that populate the filter dropdowns and the import history.
  // None of them depend on the current filters, so they are deliberately NOT
  // refetched when a filter changes - only when something that can actually
  // change them happens (an import can create both accounts and batches).
  const fetchLookups = async (cancelledRef) => {
    const [batchesRes, categoriesRes, accountsRes, groupsRes, typesRes] = await Promise.all([
      api.get('/import-batches'),
      api.get('/categories'),
      api.get('/accounts'),
      api.get('/account-groups'),
      api.get('/transactions/types'),
    ])

    if (!cancelledRef?.current) {
      setBatches(batchesRes.data)
      setCategories(categoriesRes.data)
      setAccounts(accountsRes.data)
      setAccountGroups(groupsRes.data)
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

  const fetchGroups = async (cancelledRef) => {
    const response = await api.get(`/transactions/groups?${groupedLedgerQuery}`)

    if (!cancelledRef?.current) {
      setGroups(response.data.groups)
    }
  }

  // Refreshes after a mutation without dropping back to the loading state, so
  // the tables don't flicker away mid-action. `withLookups` is for mutations
  // that can change accounts/batches (import, wipe, batch delete); row-level
  // edits leave the lookups untouched and skip them.
  const refresh = async ({ withLookups = false } = {}) => {
    try {
      await Promise.all([
        fetchTransactions(),
        withLookups ? fetchLookups() : null,
        groupByMerchant ? fetchGroups() : null,
      ])
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

  // Only fetches while the toggle is on - switching it off leaves the last
  // fetched groups in state, unused, rather than paying for a request the
  // view no longer shows.
  useEffect(() => {
    if (!groupByMerchant) {
      return undefined
    }

    const cancelledRef = { current: false }

    setGroupsLoading(true)
    setGroupsError('')

    fetchGroups(cancelledRef)
      .catch((err) => {
        if (!cancelledRef.current) {
          const message = err?.response?.data?.detail || err?.message || 'Unknown error'
          setGroupsError(String(message))
        }
      })
      .finally(() => {
        if (!cancelledRef.current) {
          setGroupsLoading(false)
        }
      })

    return () => {
      cancelledRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupByMerchant, groupedLedgerQuery])

  const handleFilterFieldChange = (field) => (event) => {
    setFilterForm((prev) => ({ ...prev, [field]: event.target.value }))
  }

  const handleApplyFilters = (event) => {
    event.preventDefault()
    setSelectedIds([])
    setExpandedIds(new Set())
    setExpandedGroupKeys(new Set())
    setSearchParams(searchParamsFromFilters(filterForm, pageSize))
  }

  const handleClearFilters = () => {
    setSelectedIds([])
    setExpandedIds(new Set())
    setExpandedGroupKeys(new Set())
    setFilterForm(EMPTY_FILTERS)
    setSearchParams(searchParamsFromFilters(EMPTY_FILTERS, pageSize))
  }

  const handlePageChange = (newPage) => {
    setSelectedIds([])
    setExpandedIds(new Set())
    const next = new URLSearchParams(searchParams)
    next.set('page', String(newPage))
    setSearchParams(next)
  }

  // Resets to page 1 - page 7 at 50/page doesn't exist at 200/page.
  const handlePageSizeChange = (newSize) => {
    setSelectedIds([])
    setExpandedIds(new Set())
    const next = new URLSearchParams(searchParams)
    next.set('page_size', String(newSize))
    next.set('page', '1')
    setSearchParams(next)
  }

  const toggleExpanded = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleGroupExpanded = (key) => {
    setExpandedGroupKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const groupCategorySelection = (key) => groupCategorySelections[key] ?? ''

  const setGroupCategorySelection = (key, value) => {
    setGroupCategorySelections((prev) => ({ ...prev, [key]: value }))
  }

  const forgetGroupSelection = (key) => {
    setGroupCategorySelections((prev) => {
      const { [key]: _discard, ...rest } = prev
      return rest
    })
  }

  const handleGroupSetCategory = async (group) => {
    const categoryId = groupCategorySelection(group.narration_key)

    if (!categoryId) {
      return
    }

    setActionError('')
    setAssigningGroupKey(group.narration_key)

    try {
      await api.post('/transactions/bulk-category', {
        transaction_ids: group.transaction_ids,
        category_id: Number(categoryId),
      })
      forgetGroupSelection(group.narration_key)
      await Promise.all([refresh(), fetchGroups()])
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Categorize failed'
      setActionError(String(message))
    } finally {
      setAssigningGroupKey(null)
    }
  }

  // A group has no single transaction_type or category_id (it can span
  // both), so RuleEditor's prefill is scoped to what a group actually has:
  // the merchant name, Any type, and no category. RuleEditor doesn't care
  // whether it's fed a real transaction or this - only that the shape
  // matches.
  const ruleEditorTransactionFromGroup = (group) => ({
    narration: group.sample_narration,
    merchant_label: group.merchant,
    transaction_type: '',
    category_id: null,
  })

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
        groups={accountGroups}
      />

      <Card id="transactions-ledger" title="Ledger">
        {loading && <LoadingState message="Loading transactions..." />}
        {!loading && error && <ErrorState label="Failed to load transactions:" message={error} />}

        {!loading && !error && (
          <>
            <div className="ledger-toolbar">
              {!groupByMerchant && (
                <>
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
                </>
              )}
              <button type="button" onClick={handleApplyRules} disabled={applying}>
                Apply rules now
              </button>
              {applyMessage && <span>{applyMessage}</span>}
              <label>
                <input
                  type="checkbox"
                  checked={groupByMerchant}
                  onChange={(e) => setGroupByMerchant(e.target.checked)}
                />
                {' '}Group by merchant
              </label>
            </div>

            {groupByMerchant && groupsLoading && <LoadingState message="Loading merchant groups..." />}
            {groupByMerchant && !groupsLoading && groupsError && (
              <ErrorState label="Failed to load merchant groups:" message={groupsError} />
            )}

            {groupByMerchant && !groupsLoading && !groupsError && groups.length === 0 && (
              <EmptyState message="No merchant groups in the current view." />
            )}

            {groupByMerchant && !groupsLoading && !groupsError && groups.length > 0 && (
              <div className="table-scroll">
                <table>
                  <caption className="visually-hidden">Ledger grouped by merchant</caption>
                  <thead>
                    <tr>
                      <th scope="col">Merchant</th>
                      <th scope="col">Count</th>
                      <th scope="col">Total</th>
                      <th scope="col">Date range</th>
                      <th scope="col">Category</th>
                      <th scope="col"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((group) => {
                      const isExpanded = expandedGroupKeys.has(group.narration_key)
                      const detailId = `group-detail-${group.narration_key}`
                      const signedTotal = group.direction === 'outflow' ? -Number(group.total_amount) : Number(group.total_amount)

                      return (
                        <Fragment key={group.narration_key}>
                          <tr>
                            <td>{group.merchant}</td>
                            <td>{group.transaction_count}</td>
                            <td><Amount value={signedTotal} /></td>
                            <td>{group.first_date} to {group.last_date}</td>
                            <td>
                              <CategoryQuickAdd
                                categories={categories}
                                value={groupCategorySelection(group.narration_key)}
                                onChange={(value) => setGroupCategorySelection(group.narration_key, value)}
                                onCategoryCreated={(category) => {
                                  handleCategoryCreated(category)
                                  setGroupCategorySelection(group.narration_key, String(category.id))
                                }}
                                label={`Category for ${group.merchant}`}
                                includeUncategorized={false}
                              />
                              <button
                                type="button"
                                className="button-primary"
                                onClick={() => handleGroupSetCategory(group)}
                                disabled={!groupCategorySelection(group.narration_key) || assigningGroupKey === group.narration_key}
                              >
                                Set category
                              </button>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="button-ghost"
                                aria-label={`Make rule from ${group.merchant}`}
                                onClick={() => setRuleEditorTransaction(ruleEditorTransactionFromGroup(group))}
                              >
                                Make rule
                              </button>
                              <button
                                type="button"
                                className="button-ghost"
                                aria-expanded={isExpanded}
                                aria-controls={detailId}
                                onClick={() => toggleGroupExpanded(group.narration_key)}
                              >
                                {isExpanded ? 'Hide' : 'Details'}
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr id={detailId} className="ledger-detail-row">
                              <td colSpan={6}>
                                <div className="ledger-row-meta">
                                  <span>{group.sample_narration}</span>
                                  <span className="text-muted">Accounts: {group.account_names.join(', ')}</span>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {!groupByMerchant && (
            <>
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
                    <th scope="col">Category</th>
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((transaction) => {
                    const isExpanded = expandedIds.has(transaction.id)
                    const detailId = `transaction-detail-${transaction.id}`

                    return (
                      <Fragment key={transaction.id}>
                        <tr>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(transaction.id)}
                              onChange={() => toggleSelected(transaction.id)}
                            />
                          </td>
                          <td>{transaction.transaction_date}</td>
                          <td>{transaction.account_name || formatAccount(transaction)}</td>
                          <td className="ledger-narration">{transaction.narration}</td>
                          <td><Amount value={transaction.debit} /></td>
                          <td><Amount value={transaction.credit} /></td>
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
                          <td>
                            {/* Import filename, the note field, and Split/
                                Make rule/Delete live in a detail row instead
                                of their own columns - all four are low-
                                frequency and text-heavy, and were what
                                pushed the table into horizontal scroll on
                                every viewport, and what made every row three
                                lines tall for the common case of just
                                picking a category. */}
                            <button
                              type="button"
                              className="button-ghost"
                              aria-expanded={isExpanded}
                              aria-controls={detailId}
                              onClick={() => toggleExpanded(transaction.id)}
                            >
                              {isExpanded ? 'Hide' : 'Details'}
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr id={detailId} className="ledger-detail-row">
                            <td colSpan={7}>
                              <div className="ledger-row-meta">
                                <span>
                                  Balance: <Amount value={transaction.balance} neutral />
                                </span>
                                <span>Type: {transaction.transaction_type}</span>
                                <span className="text-muted">{batchFilename(transaction.import_batch_id)}</span>
                                <input
                                  type="text"
                                  className="ledger-note-input"
                                  placeholder="Add a note..."
                                  defaultValue={transaction.note || ''}
                                  onBlur={(e) => handleNoteChange(transaction, e.target.value)}
                                  aria-label={`Note for ${transaction.narration}`}
                                />
                                <button
                                  type="button"
                                  className="button-ghost"
                                  onClick={() => setSplitEditorTransaction(transaction)}
                                >
                                  {transaction.is_split ? 'Edit split' : 'Split'}
                                </button>
                                <button
                                  type="button"
                                  className="button-ghost"
                                  aria-label={`Make rule from ${transaction.narration}`}
                                  onClick={() => setRuleEditorTransaction(transaction)}
                                >
                                  Make rule
                                </button>
                                <button
                                  type="button"
                                  className="button-danger"
                                  onClick={() => handleDeleteTransaction(transaction.id)}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
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

      {ruleEditorTransaction && (
        <RuleEditor
          transaction={ruleEditorTransaction}
          categories={categories}
          transactionTypes={transactionTypes}
          onCategoryCreated={handleCategoryCreated}
          onClose={() => setRuleEditorTransaction(null)}
          onSaved={() => {
            setRuleEditorTransaction(null)
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
