import { useEffect, useState } from 'react'
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

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState([])
  const [batches, setBatches] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const [uploadErrors, setUploadErrors] = useState(null)
  const [actionError, setActionError] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [bulkCategoryId, setBulkCategoryId] = useState('')

  const fetchData = async (cancelledRef) => {
    const [transactionsRes, batchesRes, categoriesRes] = await Promise.all([
      api.get('/transactions'),
      api.get('/import-batches'),
      api.get('/categories'),
    ])

    if (!cancelledRef?.current) {
      setTransactions(transactionsRes.data)
      setBatches(batchesRes.data)
      setCategories(categoriesRes.data)
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
  }, [])

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
            {uploadResult.new_account_count} new account(s).
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
                    </td>
                    <td>{batchFilename(transaction.import_batch_id)}</td>
                    <td>
                      <button type="button" onClick={() => handleDeleteTransaction(transaction.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </section>
  )
}
