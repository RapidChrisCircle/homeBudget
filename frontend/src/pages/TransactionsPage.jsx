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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const [uploadErrors, setUploadErrors] = useState(null)

  const fetchData = async (cancelledRef) => {
    const [transactionsRes, batchesRes] = await Promise.all([
      api.get('/transactions'),
      api.get('/import-batches'),
    ])

    if (!cancelledRef?.current) {
      setTransactions(transactionsRes.data)
      setBatches(batchesRes.data)
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

  const handleDeleteTransaction = async (id) => {
    await api.delete(`/transactions/${id}`)
    await refresh()
  }

  const handleDeleteBatch = async (id) => {
    if (!window.confirm('Delete this import and all its transactions?')) {
      return
    }
    await api.delete(`/import-batches/${id}`)
    await refresh()
  }

  const handleWipeAll = async () => {
    if (!window.confirm('Delete ALL transactions and import history? This cannot be undone.')) {
      return
    }
    await api.delete('/transactions')
    setUploadResult(null)
    setUploadErrors(null)
    await refresh()
  }

  const batchFilename = (importBatchId) => {
    const batch = batches.find((b) => b.id === importBatchId)
    return batch ? batch.filename : `#${importBatchId}`
  }

  return (
    <section className="card">
      <h2>Transactions</h2>

      <div className="card">
        <h3>Import CSV</h3>
        <input type="file" accept=".csv" onChange={handleFileChange} disabled={uploading} />

        {uploading && <p>Importing...</p>}

        {!uploading && uploadResult && (
          <p>
            Imported {uploadResult.imported_count} transaction(s), skipped{' '}
            {uploadResult.skipped_duplicate_count} duplicate(s).
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
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Account</th>
                <th>Narration</th>
                <th>Debit</th>
                <th>Credit</th>
                <th>Balance</th>
                <th>Type</th>
                <th>Import</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{transaction.transaction_date}</td>
                  <td>{formatAccount(transaction)}</td>
                  <td>{transaction.narration}</td>
                  <td>{formatAmount(transaction.debit)}</td>
                  <td>{formatAmount(transaction.credit)}</td>
                  <td>{formatAmount(transaction.balance)}</td>
                  <td>{transaction.transaction_type}</td>
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
        )}
      </div>
    </section>
  )
}
