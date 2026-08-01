import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CategoryQuickAdd from './CategoryQuickAdd.jsx'
import { api } from '../services/api'

vi.mock('../services/api', () => ({
  api: {
    post: vi.fn(),
  },
}))

const categories = [{ id: 1, name: 'Groceries' }]

function renderQuickAdd(props = {}) {
  const onChange = vi.fn()
  const onCategoryCreated = vi.fn()
  const utils = render(
    <CategoryQuickAdd
      categories={categories}
      value=""
      onChange={onChange}
      onCategoryCreated={onCategoryCreated}
      label="Category"
      {...props}
    />
  )
  return { ...utils, onChange, onCategoryCreated }
}

describe('CategoryQuickAdd', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the select with an Uncategorized option by default', () => {
    renderQuickAdd()

    const options = Array.from(screen.getByLabelText('Category').options).map((o) => o.textContent)
    expect(options).toEqual(['Uncategorized', 'Groceries'])
  })

  it('omits the Uncategorized option when includeUncategorized is false', () => {
    renderQuickAdd({ includeUncategorized: false })

    const options = Array.from(screen.getByLabelText('Category').options).map((o) => o.textContent)
    expect(options).toEqual(['Groceries'])
  })

  it('fires onChange when the select changes', () => {
    const { onChange } = renderQuickAdd()

    fireEvent.change(screen.getByLabelText('Category'), { target: { value: '1' } })

    expect(onChange).toHaveBeenCalledWith('1')
  })

  it('creates a category and hands it back via onCategoryCreated', async () => {
    api.post.mockResolvedValue({ data: { id: 2, name: 'Subscriptions', kind: 'expense' } })
    const { onCategoryCreated } = renderQuickAdd()

    fireEvent.click(screen.getByRole('button', { name: '+ New category' }))
    fireEvent.change(screen.getByLabelText('New category name'), { target: { value: 'Subscriptions' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/categories', {
        name: 'Subscriptions',
        kind: 'expense',
        budget_amount: null,
      })
    })
    expect(onCategoryCreated).toHaveBeenCalledWith({ id: 2, name: 'Subscriptions', kind: 'expense' })
    // The inline form closes again once the create succeeds.
    expect(screen.queryByLabelText('New category name')).not.toBeInTheDocument()
  })

  it('surfaces a duplicate-name error instead of silently failing', async () => {
    api.post.mockRejectedValue({ response: { data: { detail: 'A category with this name already exists' } } })
    renderQuickAdd()

    fireEvent.click(screen.getByRole('button', { name: '+ New category' }))
    fireEvent.change(screen.getByLabelText('New category name'), { target: { value: 'Groceries' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(screen.getByText(/already exists/)).toBeInTheDocument()
    })
    // The form stays open so the user can correct the name.
    expect(screen.getByLabelText('New category name')).toBeInTheDocument()
  })

  it('cancels back to the plain select without creating anything', () => {
    renderQuickAdd()

    fireEvent.click(screen.getByRole('button', { name: '+ New category' }))
    expect(screen.getByLabelText('New category name')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByLabelText('New category name')).not.toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
  })
})
