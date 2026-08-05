import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RuleEditor from './RuleEditor.jsx'
import { api } from '../services/api'

vi.mock('../services/api', () => ({
  api: {
    post: vi.fn(),
  },
}))

const categories = [
  { id: 1, name: 'Groceries', parent_id: null },
  { id: 2, name: 'Dining', parent_id: null },
]

const transaction = {
  id: 42,
  narration: 'LS Taquiza               Newport      AU',
  merchant_label: 'LS Taquiza',
  transaction_type: 'WDL',
  category_id: 2,
  debit: '-45.00',
  credit: null,
}

function renderEditor(props = {}) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  const onCategoryCreated = vi.fn()
  const utils = render(
    <RuleEditor
      transaction={transaction}
      categories={categories}
      transactionTypes={['WDL', 'DEP']}
      onClose={onClose}
      onSaved={onSaved}
      onCategoryCreated={onCategoryCreated}
      {...props}
    />
  )
  return { ...utils, onClose, onSaved, onCategoryCreated }
}

describe('RuleEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.post.mockImplementation((path) => {
      if (path === '/category-rules/preview') {
        return Promise.resolve({ data: { match_count: 5, would_categorize_count: 4 } })
      }
      if (path === '/category-rules') {
        return Promise.resolve({ data: { id: 9 } })
      }
      if (path === '/category-rules/apply') {
        return Promise.resolve({ data: { categorized_count: 4 } })
      }
      return Promise.reject(new Error(`unexpected post ${path}`))
    })
  })

  it('prefills the merchant label, the row type and its category', () => {
    renderEditor()

    expect(screen.getByLabelText('Narration contains')).toHaveValue('LS Taquiza')
    expect(screen.getByLabelText('Transaction type')).toHaveValue('WDL')
    expect(screen.getByLabelText('Category')).toHaveValue('2')
    expect(screen.getByLabelText('Min amount')).toHaveValue(null)
    expect(screen.getByLabelText('Max amount')).toHaveValue(null)
  })

  it('shows the live preview match count on open', async () => {
    renderEditor()

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/category-rules/preview', expect.objectContaining({
        narration_pattern: 'LS Taquiza',
      }))
    })

    expect(await screen.findByText('Matches 5 transaction(s); 4 would be categorized now.')).toBeInTheDocument()
  })

  it('refreshes the preview when a discrete field changes', async () => {
    renderEditor()

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/category-rules/preview', expect.anything()))
    api.post.mockClear()

    fireEvent.change(screen.getByLabelText('Transaction type'), { target: { value: 'DEP' } })

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/category-rules/preview', expect.objectContaining({
        transaction_type: 'DEP',
      }))
    })
  })

  it('saves by creating the rule then applying it, without leaving the page', async () => {
    const { onSaved } = renderEditor()

    fireEvent.click(screen.getByRole('button', { name: 'Save and apply' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/category-rules', {
        narration_pattern: 'LS Taquiza',
        transaction_type: 'WDL',
        min_amount: null,
        max_amount: null,
        category_id: 2,
      })
    })
    expect(api.post).toHaveBeenCalledWith('/category-rules/apply')
    expect(onSaved).toHaveBeenCalled()
  })

  it('enables Save and apply on selecting the FIRST category, with none prefilled', async () => {
    // The reported bug's exact shape: a group's synthetic transaction has
    // no category_id (see ruleEditorTransactionFromGroup in
    // TransactionsPage.jsx), and the category a user wants happens to be
    // the first in the list.
    renderEditor({ transaction: { ...transaction, category_id: null } })

    const saveButton = screen.getByRole('button', { name: 'Save and apply' })
    expect(saveButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Category'), { target: { value: '1' } })

    expect(saveButton).not.toBeDisabled()
  })

  it('closes on Escape and on Cancel', () => {
    const { onClose } = renderEditor()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
