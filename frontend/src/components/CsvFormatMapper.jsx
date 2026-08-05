import { useEffect, useRef, useState } from 'react'
import Amount from './Amount.jsx'
import ErrorState from './ErrorState.jsx'
import { api } from '../services/api'
import { formatDate, transactionAmount } from '../utils/format.js'

const EMPTY_FORM = {
  name: '',
  institution: '',
  dateFormat: '',
  amountMode: 'debit_credit',
  bsbIndex: '',
  accountNumberIndex: '',
  transactionDateIndex: '',
  narrationIndex: '',
  chequeNumberIndex: '',
  debitIndex: '',
  creditIndex: '',
  amountIndex: '',
  balanceIndex: '',
  transactionTypeIndex: '',
}

// Common strptime patterns - a starting guess, not a constraint. Shown as
// clickable examples rather than a closed dropdown, since a bank export
// can genuinely use anything strptime supports.
const DATE_FORMAT_EXAMPLES = [
  { format: '%d/%m/%Y', example: '24/07/2026' },
  { format: '%Y-%m-%d', example: '2026-07-24' },
  { format: '%m/%d/%Y', example: '07/24/2026' },
]

function buildMappingPayload(form) {
  const optional = (value) => (value === '' ? null : Number(value))

  return {
    name: form.name,
    institution: form.institution || null,
    date_format: form.dateFormat,
    amount_mode: form.amountMode,
    bsb_index: optional(form.bsbIndex),
    account_number_index: Number(form.accountNumberIndex),
    transaction_date_index: Number(form.transactionDateIndex),
    narration_index: Number(form.narrationIndex),
    cheque_number_index: optional(form.chequeNumberIndex),
    debit_index: form.amountMode === 'debit_credit' ? optional(form.debitIndex) : null,
    credit_index: form.amountMode === 'debit_credit' ? optional(form.creditIndex) : null,
    amount_index: form.amountMode === 'single_amount' ? optional(form.amountIndex) : null,
    balance_index: Number(form.balanceIndex),
    transaction_type_index: optional(form.transactionTypeIndex),
  }
}

// One <select> of the uploaded file's own header columns - every logical
// field (Account Number, Balance, ...) picks from the SAME list, since the
// whole point of mapping is "which of THIS file's columns is this".
function ColumnSelect({ label, header, value, onChange, required = false }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} required={required}>
        <option value="">{required ? 'Select a column...' : 'Not present in this file'}</option>
        {header.map((name, index) => (
          <option key={index} value={index}>
            {name.trim() || `Column ${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  )
}

// Shown after an upload's header doesn't match any known bank format (the
// backend's needs_mapping response - see api/transactions.py's import
// endpoint). Maps this file's own columns to the fields the app needs,
// previews the result against a REAL parse (writing nothing), then saves
// the mapping and re-runs the import - which auto-detects the just-saved
// mapping by header signature exactly like any other format, no special
// casing needed on the import side at all.
export default function CsvFormatMapper({ file, header, sampleRows, onClose, onImported }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [previewRows, setPreviewRows] = useState(null)
  const [previewErrors, setPreviewErrors] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef(null)

  // Same modal contract as SplitEditor - focus the dialog on open, close on
  // Esc, so a keyboard user is never trapped in either of this app's two
  // modals.
  useEffect(() => {
    dialogRef.current?.focus()

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const setField = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }))
    // A field changing invalidates whatever the last preview showed -
    // clearer than leaving a stale preview attached to a mapping that's no
    // longer the one on screen.
    setPreviewRows(null)
    setPreviewErrors(null)
  }

  const handlePreview = async (event) => {
    event.preventDefault()
    setPreviewing(true)
    setError('')
    setPreviewRows(null)
    setPreviewErrors(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('mapping_json', JSON.stringify(buildMappingPayload(form)))

    try {
      const response = await api.post('/transactions/import/preview', formData)
      setPreviewRows(response.data.rows)
      setPreviewErrors(response.data.errors)
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Preview failed'
      setError(String(message))
    } finally {
      setPreviewing(false)
    }
  }

  const handleSaveAndImport = async () => {
    setSaving(true)
    setError('')

    try {
      await api.post('/csv-formats', { mapping: buildMappingPayload(form), header })

      const formData = new FormData()
      formData.append('file', file)
      const response = await api.post('/transactions/import', formData)

      onImported(response.data)
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Save and import failed'
      setError(String(message))
    } finally {
      setSaving(false)
    }
  }

  const canPreview = form.accountNumberIndex !== '' && form.transactionDateIndex !== ''
    && form.narrationIndex !== '' && form.balanceIndex !== '' && form.dateFormat !== ''
  const canImport = canPreview && previewRows !== null && previewErrors !== null && previewErrors.length === 0

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="csv-mapper-title"
        tabIndex={-1}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="csv-mapper-title">Map this file&apos;s columns</h3>
        <p>
          This file&apos;s header doesn&apos;t match a known bank format. Map its columns below, preview the
          result, then save and import. The mapping is remembered, so future files with this same header
          import automatically.
        </p>

        {error && <ErrorState label="Error:" message={error} />}

        <form onSubmit={handlePreview}>
          <div>
            <label>
              Format name
              <input type="text" value={form.name} onChange={setField('name')} required placeholder="e.g. My Bank" />
            </label>
          </div>
          <div>
            <label>
              Institution (optional)
              <input type="text" value={form.institution} onChange={setField('institution')} />
            </label>
          </div>
          <div>
            <label>
              Date format
              <input
                type="text"
                value={form.dateFormat}
                onChange={setField('dateFormat')}
                required
                placeholder="%Y-%m-%d"
              />
            </label>
            <p className="text-muted">
              {DATE_FORMAT_EXAMPLES.map(({ format, example }) => (
                <span key={format}>
                  <button
                    type="button"
                    className="button-ghost"
                    onClick={() => setForm((prev) => ({ ...prev, dateFormat: format }))}
                  >
                    {format}
                  </button>
                  {' '}({example}){'  '}
                </span>
              ))}
            </p>
          </div>

          <ColumnSelect label="Account Number" header={header} value={form.accountNumberIndex} onChange={(v) => setField('accountNumberIndex')({ target: { value: v } })} required />
          <ColumnSelect label="Transaction Date" header={header} value={form.transactionDateIndex} onChange={(v) => setField('transactionDateIndex')({ target: { value: v } })} required />
          <ColumnSelect label="Narration" header={header} value={form.narrationIndex} onChange={(v) => setField('narrationIndex')({ target: { value: v } })} required />
          <ColumnSelect label="Balance" header={header} value={form.balanceIndex} onChange={(v) => setField('balanceIndex')({ target: { value: v } })} required />
          <ColumnSelect label="BSB Number" header={header} value={form.bsbIndex} onChange={(v) => setField('bsbIndex')({ target: { value: v } })} />
          <ColumnSelect label="Cheque Number" header={header} value={form.chequeNumberIndex} onChange={(v) => setField('chequeNumberIndex')({ target: { value: v } })} />
          <ColumnSelect label="Transaction Type" header={header} value={form.transactionTypeIndex} onChange={(v) => setField('transactionTypeIndex')({ target: { value: v } })} />

          <div>
            <label>
              Amount columns
              <select value={form.amountMode} onChange={setField('amountMode')}>
                <option value="debit_credit">Separate Debit and Credit columns</option>
                <option value="single_amount">One signed Amount column</option>
              </select>
            </label>
          </div>

          {form.amountMode === 'debit_credit' ? (
            <>
              <ColumnSelect label="Debit" header={header} value={form.debitIndex} onChange={(v) => setField('debitIndex')({ target: { value: v } })} required />
              <ColumnSelect label="Credit" header={header} value={form.creditIndex} onChange={(v) => setField('creditIndex')({ target: { value: v } })} required />
            </>
          ) : (
            <ColumnSelect label="Amount" header={header} value={form.amountIndex} onChange={(v) => setField('amountIndex')({ target: { value: v } })} required />
          )}

          <div className="modal-actions">
            <button type="submit" disabled={!canPreview || previewing}>
              {previewing ? 'Previewing...' : 'Preview'}
            </button>
            <button
              type="button"
              className="button-primary"
              onClick={handleSaveAndImport}
              disabled={!canImport || saving}
            >
              {saving ? 'Importing...' : 'Save mapping and import'}
            </button>
            <button type="button" onClick={onClose} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>

        {sampleRows.length > 0 && previewRows === null && (
          <div className="card">
            <h4>A few raw rows from this file</h4>
            <div className="table-scroll">
              <table>
                <caption className="visually-hidden">Raw sample rows from the uploaded file</caption>
                <thead>
                  <tr>
                    {header.map((name, index) => (
                      <th scope="col" key={index}>{name.trim() || `Column ${index + 1}`}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sampleRows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {previewErrors && previewErrors.length > 0 && (
          <div className="card">
            <h4>Preview found problems</h4>
            <ul>
              {previewErrors.map((e, index) => (
                <li key={index}>
                  {e.row_number ? `Row ${e.row_number}: ` : ''}
                  {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {previewRows && previewRows.length > 0 && (
          <div className="card">
            <h4>Preview - parsed correctly</h4>
            <div className="table-scroll">
              <table>
                <caption className="visually-hidden">Preview of transactions parsed with this mapping</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Narration</th>
                    <th scope="col" className="numeric">Amount</th>
                    <th scope="col" className="numeric">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, index) => (
                    <tr key={index}>
                      <td>{formatDate(row.transaction_date)}</td>
                      <td className="cell-wrap">{row.narration}</td>
                      <td><Amount value={transactionAmount(row)} /></td>
                      <td><Amount value={row.balance} neutral /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
