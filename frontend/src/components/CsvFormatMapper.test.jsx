import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CsvFormatMapper from './CsvFormatMapper.jsx'
import { api } from '../services/api'

vi.mock('../services/api', () => ({
  api: {
    post: vi.fn(),
  },
}))

const header = ['BSB', 'Account', 'Value Date', 'Description', 'Debit Amount', 'Credit Amount', 'Running Balance']
const sampleRows = [['304-559', '9999', '2026-07-24', 'Coffee', '5.00', '', '95.00']]
const file = new File(['a,b'], 'other_bank.csv', { type: 'text/csv' })

function renderMapper(props = {}) {
  const onClose = vi.fn()
  const onImported = vi.fn()
  const utils = render(
    <CsvFormatMapper
      file={file}
      header={header}
      sampleRows={sampleRows}
      onClose={onClose}
      onImported={onImported}
      {...props}
    />
  )
  return { ...utils, onClose, onImported }
}

// Fills in every field required for Preview/Save to become enabled -
// individual tests override just what they need to test. "Format name" is
// a plain HTML `required` input (not part of the component's own canPreview
// gate, but the backend's CsvColumnMappingInput schema requires it too, so
// the native browser-level validation blocking an empty submit is correct
// behaviour, not a bug to work around).
function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText('Format name'), { target: { value: 'Other Bank' } })
  fireEvent.change(screen.getByLabelText('Account Number'), { target: { value: '1' } })
  fireEvent.change(screen.getByLabelText('Transaction Date'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('Narration'), { target: { value: '3' } })
  fireEvent.change(screen.getByLabelText('Balance'), { target: { value: '6' } })
  fireEvent.change(screen.getByLabelText('Date format'), { target: { value: '%Y-%m-%d' } })
  fireEvent.change(screen.getByLabelText('Debit'), { target: { value: '4' } })
  fireEvent.change(screen.getByLabelText('Credit'), { target: { value: '5' } })
}

describe('CsvFormatMapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('populates every column dropdown from the uploaded file\'s own header', () => {
    renderMapper()

    const options = Array.from(screen.getByLabelText('Account Number').options).map((o) => o.textContent)
    expect(options).toEqual(['Select a column...', 'BSB', 'Account', 'Value Date', 'Description', 'Debit Amount', 'Credit Amount', 'Running Balance'])
  })

  it('shows a few raw sample rows before any preview has run', () => {
    renderMapper()

    expect(screen.getByText('A few raw rows from this file')).toBeInTheDocument()
    expect(screen.getByText('Coffee')).toBeInTheDocument()
  })

  it('disables Preview until the required fields are filled', () => {
    renderMapper()

    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled()

    fillRequiredFields()

    expect(screen.getByRole('button', { name: 'Preview' })).not.toBeDisabled()
  })

  it('previews with the built mapping and shows the parsed rows', async () => {
    api.post.mockResolvedValue({
      data: {
        rows: [{
          bsb_number: '304-559', account_number: '9999', transaction_date: '2026-07-24',
          narration: 'Coffee', cheque_number: null, debit: '5.00', credit: null, balance: '95.00',
          transaction_type: '',
        }],
        errors: [],
      },
    })
    renderMapper()
    fillRequiredFields()

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => {
      expect(screen.getByText('Preview - parsed correctly')).toBeInTheDocument()
    })

    const [url, formData] = api.post.mock.calls[0]
    expect(url).toBe('/transactions/import/preview')
    const mapping = JSON.parse(formData.get('mapping_json'))
    expect(mapping).toMatchObject({
      account_number_index: 1,
      transaction_date_index: 2,
      narration_index: 3,
      debit_index: 4,
      credit_index: 5,
      balance_index: 6,
      amount_index: null,
      date_format: '%Y-%m-%d',
      amount_mode: 'debit_credit',
    })
  })

  it('shows preview errors instead of a parsed table', async () => {
    api.post.mockResolvedValue({ data: { rows: [], errors: [{ row_number: 2, message: 'invalid date' }] } })
    renderMapper()
    fillRequiredFields()

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => {
      expect(screen.getByText(/invalid date/)).toBeInTheDocument()
    })
    expect(screen.queryByText('Preview - parsed correctly')).not.toBeInTheDocument()
  })

  it('keeps Save mapping and import disabled until a clean preview exists', async () => {
    api.post.mockResolvedValue({ data: { rows: [], errors: [{ row_number: 2, message: 'bad' }] } })
    renderMapper()
    fillRequiredFields()

    expect(screen.getByRole('button', { name: 'Save mapping and import' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => expect(screen.getByText(/bad/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Save mapping and import' })).toBeDisabled()
  })

  it('enables Save mapping and import once the preview is clean, then saves and imports', async () => {
    api.post
      .mockResolvedValueOnce({ data: { rows: [{ bsb_number: null, account_number: '9999', transaction_date: '2026-07-24', narration: 'Coffee', cheque_number: null, debit: '5.00', credit: null, balance: '95.00', transaction_type: '' }], errors: [] } })
      .mockResolvedValueOnce({ data: { id: 1, name: 'Other Bank' } })
      .mockResolvedValueOnce({ data: { imported_count: 1, skipped_duplicate_count: 0, new_account_count: 1, auto_categorized_count: 0, batch: {} } })

    const { onImported } = renderMapper()
    fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => expect(screen.getByText('Preview - parsed correctly')).toBeInTheDocument())

    const saveButton = screen.getByRole('button', { name: 'Save mapping and import' })
    expect(saveButton).not.toBeDisabled()
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(api.post).toHaveBeenNthCalledWith(2, '/csv-formats', expect.objectContaining({ header }))
    })
    await waitFor(() => {
      expect(api.post).toHaveBeenNthCalledWith(3, '/transactions/import', expect.anything())
    })
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ imported_count: 1 }))
  })

  it('switches between debit/credit columns and a single amount column', () => {
    renderMapper()

    expect(screen.getByLabelText('Debit')).toBeInTheDocument()
    expect(screen.getByLabelText('Credit')).toBeInTheDocument()
    expect(screen.queryByLabelText('Amount')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Amount columns'), { target: { value: 'single_amount' } })

    expect(screen.queryByLabelText('Debit')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Credit')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Amount')).toBeInTheDocument()
  })

  it('closes on Cancel', () => {
    const { onClose } = renderMapper()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalled()
  })

  it('fills the date format from a clicked example', () => {
    renderMapper()

    fireEvent.click(screen.getByRole('button', { name: '%d/%m/%Y' }))

    expect(screen.getByLabelText('Date format')).toHaveValue('%d/%m/%Y')
  })
})
