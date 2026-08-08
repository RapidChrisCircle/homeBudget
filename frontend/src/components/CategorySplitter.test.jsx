import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../services/api'
import CategorySplitter from './CategorySplitter.jsx'

vi.mock('../services/api', () => ({
  api: {
    post: vi.fn(),
  },
}))

const categories = [
  { id: 1, name: 'Groceries', kind: 'expense', parent_id: null },
  { id: 2, name: 'Fuel', kind: 'expense', parent_id: null },
]

function renderSplitter(onDone = vi.fn()) {
  return render(<CategorySplitter categories={categories} onDone={onDone} />)
}

function fillPart({ name = 'Alcohol', pattern = 'bws' } = {}) {
  fireEvent.change(screen.getByLabelText('Category to split'), { target: { value: '1' } })
  fireEvent.change(screen.getByLabelText('Name for new category 1'), { target: { value: name } })
  fireEvent.change(screen.getByLabelText('Narration pattern for new category 1'), { target: { value: pattern } })
}

describe('CategorySplitter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('cannot preview or split until a source and a complete part are given', () => {
    renderSplitter()

    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Split' })).toBeDisabled()

    fillPart()

    expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Split' })).toBeEnabled()
  })

  it('shows what a split would move, and what would stay behind', async () => {
    api.post.mockResolvedValue({
      data: {
        category_id: 1,
        category_name: 'Groceries',
        parts: [{ name: 'Alcohol', pattern: 'bws', transaction_count: 4, total: '-120.00' }],
        remaining_count: 11,
        remaining_total: '-880.00',
      },
    })
    renderSplitter()

    fillPart()
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/categories/split/preview', {
      category_id: 1,
      parts: [{ name: 'Alcohol', pattern: 'bws', budget_amount: null, create_rule: false }],
    }))

    expect(await screen.findByText('4')).toBeInTheDocument()
    expect(screen.getByText('Stays in Groceries')).toBeInTheDocument()
    expect(screen.getByText('11')).toBeInTheDocument()
  })

  it('drops a stale preview the moment a pattern changes', async () => {
    api.post.mockResolvedValue({
      data: {
        category_id: 1,
        category_name: 'Groceries',
        parts: [{ name: 'Alcohol', pattern: 'bws', transaction_count: 4, total: '-120.00' }],
        remaining_count: 11,
        remaining_total: '-880.00',
      },
    })
    renderSplitter()

    fillPart()
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByText('Stays in Groceries')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Narration pattern for new category 1'), { target: { value: 'liquor' } })

    expect(screen.queryByText('Stays in Groceries')).not.toBeInTheDocument()
  })

  it('splits, reports what moved and refreshes the page', async () => {
    const onDone = vi.fn().mockResolvedValue()
    api.post.mockResolvedValue({
      data: {
        source: categories[0],
        created: [{ id: 9, name: 'Alcohol', kind: 'expense', parent_id: null }],
        transactions_moved: 4,
        splits_moved: 1,
        rules_created: 0,
      },
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderSplitter(onDone)

    fillPart()
    fireEvent.click(screen.getByRole('button', { name: 'Split' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/categories/split', {
      category_id: 1,
      parts: [{ name: 'Alcohol', pattern: 'bws', budget_amount: null, create_rule: false }],
    }))
    expect(await screen.findByText('Created 1 category, moved 5 transaction(s).')).toBeInTheDocument()
    expect(onDone).toHaveBeenCalled()
  })

  it('does not split when the confirmation is declined', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderSplitter()

    fillPart()
    fireEvent.click(screen.getByRole('button', { name: 'Split' }))

    expect(api.post).not.toHaveBeenCalled()
  })

  it('sends a part\'s own budget and rule choice through', async () => {
    api.post.mockResolvedValue({ data: { source: categories[0], created: [], transactions_moved: 0, splits_moved: 0, rules_created: 1 } })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderSplitter()

    fillPart()
    fireEvent.change(screen.getByLabelText('Standing budget for new category 1'), { target: { value: '120.00' } })
    fireEvent.click(screen.getByLabelText('Also create a rule for new category 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Split' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/categories/split', {
      category_id: 1,
      parts: [{ name: 'Alcohol', pattern: 'bws', budget_amount: '120.00', create_rule: true }],
    }))
  })

  it('splits into more than two at once', () => {
    renderSplitter()

    fireEvent.click(screen.getByRole('button', { name: 'Add another' }))

    expect(screen.getByLabelText('Name for new category 2')).toBeInTheDocument()
  })

  it('keeps at least one part - there is no split into nothing', () => {
    renderSplitter()

    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled()
  })

  it('surfaces the API refusal', async () => {
    api.post.mockRejectedValue({ response: { data: { detail: 'A category named "Alcohol" already exists' } } })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderSplitter()

    fillPart()
    fireEvent.click(screen.getByRole('button', { name: 'Split' }))

    expect(await screen.findByText('A category named "Alcohol" already exists')).toBeInTheDocument()
  })
})
