import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SplitEditor from './SplitEditor.jsx'
import { api } from '../services/api'

vi.mock('../services/api', () => ({
  api: {
    put: vi.fn(),
    post: vi.fn(),
  },
}))

const categories = [
  { id: 1, name: 'Groceries', parent_id: null },
  { id: 2, name: 'Alcohol', parent_id: null },
  { id: 3, name: 'Housing', parent_id: null },
  { id: 4, name: 'Rent', parent_id: 3 },
]

const unsplitTransaction = {
  id: 10,
  narration: 'Coles Supermarket',
  debit: '-150.00',
  credit: null,
  category_id: 1,
  is_split: false,
  splits: [],
}

const splitTransaction = {
  id: 11,
  narration: 'Coles Supermarket',
  debit: '-150.00',
  credit: null,
  category_id: null,
  is_split: true,
  splits: [
    { id: 101, category_id: 1, category_name: 'Groceries', amount: '-100.00', note: null },
    { id: 102, category_id: 2, category_name: 'Alcohol', amount: '-50.00', note: null },
  ],
}

function splitRows() {
  return document.querySelectorAll('.split-row')
}

function renderEditor(props = {}) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  const onCategoryCreated = vi.fn()
  const utils = render(
    <SplitEditor
      transaction={unsplitTransaction}
      categories={categories}
      onClose={onClose}
      onSaved={onSaved}
      onCategoryCreated={onCategoryCreated}
      {...props}
    />
  )
  return { ...utils, onClose, onSaved, onCategoryCreated }
}

describe('SplitEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts with one row prefilled from the unsplit transaction, already balanced', () => {
    renderEditor()

    const rows = splitRows()
    expect(rows).toHaveLength(1)
    expect(within(rows[0]).getByLabelText('Amount')).toHaveValue(-150)
    expect(within(rows[0]).getByLabelText('Category')).toHaveValue('1')

    expect(screen.getByRole('button', { name: 'Save split' })).not.toBeDisabled()
  })

  it('starts with one row per existing split for an already-split transaction', () => {
    renderEditor({ transaction: splitTransaction })

    const rows = splitRows()
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByLabelText('Amount')).toHaveValue(-100)
    expect(within(rows[1]).getByLabelText('Amount')).toHaveValue(-50)
  })

  it('disables Save when the rows do not sum to the transaction amount, and re-enables once balanced', () => {
    renderEditor()

    const row = splitRows()[0]
    fireEvent.change(within(row).getByLabelText('Amount'), { target: { value: '-100.00' } })

    expect(screen.getByRole('button', { name: 'Save split' })).toBeDisabled()
    expect(screen.getByText(/Remainder/)).toBeInTheDocument()

    fireEvent.change(within(row).getByLabelText('Amount'), { target: { value: '-150.00' } })

    expect(screen.getByRole('button', { name: 'Save split' })).not.toBeDisabled()
  })

  it('adding a row lets the total be split further while staying balanced', () => {
    renderEditor()

    fireEvent.change(within(splitRows()[0]).getByLabelText('Amount'), { target: { value: '-100.00' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add split' }))

    expect(splitRows()).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Save split' })).toBeDisabled()

    fireEvent.change(within(splitRows()[1]).getByLabelText('Amount'), { target: { value: '-50.00' } })

    expect(screen.getByRole('button', { name: 'Save split' })).not.toBeDisabled()
  })

  it('excludes categories that have children from the row select', () => {
    renderEditor()

    const options = Array.from(within(splitRows()[0]).getByLabelText('Category').options).map((o) => o.textContent)
    expect(options).not.toContain('Housing')
    expect(options).toContain('Rent')
  })

  it('removing a row is disabled while only one remains', () => {
    renderEditor()

    expect(screen.getByRole('button', { name: 'Remove this split' })).toBeDisabled()
  })

  it('saves with the balanced rows and calls onSaved', async () => {
    api.put.mockResolvedValue({ data: { ...unsplitTransaction, is_split: true } })
    const { onSaved } = renderEditor()

    const row = splitRows()[0]
    fireEvent.change(within(row).getByLabelText('Amount'), { target: { value: '-100.00' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add split' }))
    fireEvent.change(within(splitRows()[1]).getByLabelText('Category'), { target: { value: '2' } })
    fireEvent.change(within(splitRows()[1]).getByLabelText('Amount'), { target: { value: '-50.00' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save split' }))

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/transactions/10/splits', {
        splits: [
          { category_id: 1, amount: '-100.00', note: null },
          { category_id: 2, amount: '-50.00', note: null },
        ],
      })
    })
    expect(onSaved).toHaveBeenCalled()
  })

  it('offers Un-split only for an already-split transaction, and it clears the splits', async () => {
    api.put.mockResolvedValue({ data: { ...splitTransaction, is_split: false, splits: [] } })
    const { onSaved } = renderEditor({ transaction: splitTransaction })

    expect(screen.getByRole('button', { name: 'Un-split' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Un-split' }))

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/transactions/11/splits', { splits: [] })
    })
    expect(onSaved).toHaveBeenCalled()
  })

  it('does not offer Un-split for an unsplit transaction', () => {
    renderEditor()

    expect(screen.queryByRole('button', { name: 'Un-split' })).not.toBeInTheDocument()
  })

  it('shows a save error without closing the editor', async () => {
    api.put.mockRejectedValue({ response: { data: { detail: 'category not found' } } })
    const { onSaved } = renderEditor()

    fireEvent.click(screen.getByRole('button', { name: 'Save split' }))

    await waitFor(() => {
      expect(screen.getByText(/category not found/)).toBeInTheDocument()
    })
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('closes on Escape', () => {
    const { onClose } = renderEditor()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })

  it('closes when the overlay is clicked but not when the dialog itself is clicked', () => {
    const { onClose } = renderEditor()

    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('dialog').parentElement)
    expect(onClose).toHaveBeenCalled()
  })

  it('focuses the dialog on open', () => {
    renderEditor()

    expect(screen.getByRole('dialog')).toHaveFocus()
  })
})
