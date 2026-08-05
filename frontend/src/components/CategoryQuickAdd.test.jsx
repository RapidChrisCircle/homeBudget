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

  it('replaces Uncategorized with a "Select a category" placeholder when includeUncategorized is false', () => {
    renderQuickAdd({ includeUncategorized: false })

    const select = screen.getByLabelText('Category')
    const options = Array.from(select.options).map((o) => o.textContent)
    expect(options).toEqual(['Select a category', 'Groceries'])
    // The regression this guards: a controlled select with no option
    // matching value="" falls back to displaying the browser's default
    // (the first REAL option) while React state stays empty - so the
    // guarded "Set category"/"Save and apply" button at every call site
    // never enables until something else is picked first, then picked
    // back. An option must always exist for the current value.
    expect(select).toHaveValue('')
  })

  it('fires onChange even when the FIRST real option is chosen, with no option already selected', () => {
    // The exact shape of the reported bug: multiple categories, and the
    // one a user wants ("Childrens Activities") happens to sort first.
    const manyCategories = [{ id: 1, name: 'Childrens Activities' }, { id: 2, name: 'Groceries' }]
    const { onChange } = renderQuickAdd({ includeUncategorized: false, categories: manyCategories })

    const select = screen.getByLabelText('Category')
    expect(select).toHaveValue('')

    fireEvent.change(select, { target: { value: '1' } })

    expect(onChange).toHaveBeenCalledWith('1')
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

  it('hideSelect renders only the + New category affordance, no select of its own', () => {
    // For the one caller (the ledger toolbar while grouped by merchant)
    // with no single action a toolbar-level pick could apply to across
    // every group row - value/onChange are not even passed here.
    render(
      <CategoryQuickAdd
        categories={categories}
        onCategoryCreated={vi.fn()}
        hideSelect
      />
    )

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ New category' })).toBeInTheDocument()
  })
})
