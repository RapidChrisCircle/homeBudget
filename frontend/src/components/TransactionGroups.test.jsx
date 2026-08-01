import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TransactionGroups from './TransactionGroups.jsx'
import { api } from '../services/api'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

const categories = [{ id: 1, name: 'Groceries' }]

const sampleGroup = {
  narration_key: 'IGA NEWPORT',
  merchant: 'IGA Newport',
  sample_narration: 'IGA NEWPORT              NEWPORT',
  transaction_count: 3,
  total_amount: '45.00',
  direction: 'outflow',
  first_date: '2026-07-01',
  last_date: '2026-07-20',
  account_names: ['Joint Everyday'],
  transaction_ids: [1, 2, 3],
}

function mockLoad(groups = [sampleGroup]) {
  api.get.mockResolvedValue({ data: { groups } })
}

function renderGroups(props = {}) {
  const onCategoryCreated = vi.fn()
  const onAssigned = vi.fn().mockResolvedValue()
  const utils = render(
    <TransactionGroups
      groupsQuery=""
      categories={categories}
      onCategoryCreated={onCategoryCreated}
      onAssigned={onAssigned}
      {...props}
    />
  )
  return { ...utils, onCategoryCreated, onAssigned }
}

describe('TransactionGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading then renders a group', async () => {
    mockLoad()

    renderGroups()

    expect(screen.getByText('Loading similar transactions...')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('IGA Newport')).toBeInTheDocument()
    })
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('45.00')).toBeInTheDocument()
  })

  it('shows an empty state when there are no groups', async () => {
    mockLoad([])

    renderGroups()

    await waitFor(() => {
      expect(screen.getByText(/No groups of similar/)).toBeInTheDocument()
    })
  })

  it('shows an error message when the request fails', async () => {
    api.get.mockRejectedValue({ response: { data: { detail: 'database unavailable' } } })

    renderGroups()

    await waitFor(() => {
      expect(screen.getByText(/database unavailable/)).toBeInTheDocument()
    })
  })

  it('disables Categorize all until a category is chosen', async () => {
    mockLoad()

    renderGroups()

    await waitFor(() => expect(screen.getByText('IGA Newport')).toBeInTheDocument())

    expect(screen.getByRole('button', { name: /Categorize all 3/ })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Category for IGA Newport'), { target: { value: '1' } })

    expect(screen.getByRole('button', { name: /Categorize all 3/ })).not.toBeDisabled()
  })

  it('assigns the group via bulk-category with exactly its transaction ids, without a rule by default', async () => {
    mockLoad()
    api.post.mockResolvedValue({ data: { updated_count: 3 } })
    const { onAssigned } = renderGroups()

    await waitFor(() => expect(screen.getByText('IGA Newport')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Category for IGA Newport'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: /Categorize all 3/ }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/transactions/bulk-category', {
        transaction_ids: [1, 2, 3],
        category_id: 1,
      })
    })
    expect(api.post).not.toHaveBeenCalledWith('/category-rules', expect.anything())
    expect(onAssigned).toHaveBeenCalled()
  })

  it('also creates a rule from the merchant label when the checkbox is ticked', async () => {
    mockLoad()
    api.post.mockResolvedValue({ data: {} })
    renderGroups()

    await waitFor(() => expect(screen.getByText('IGA Newport')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Category for IGA Newport'), { target: { value: '1' } })
    fireEvent.click(screen.getByLabelText('Also create a rule'))
    fireEvent.click(screen.getByRole('button', { name: /Categorize all 3/ }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/category-rules', {
        // The merchant LABEL, not the narration_key - the key strips
        // digits/padding and would often not substring-match the raw
        // narration a rule needs to match against future imports.
        narration_pattern: 'IGA Newport',
        category_id: 1,
      })
    })
  })

  it('does not offer Uncategorized as a target category for a group', async () => {
    mockLoad()

    renderGroups()

    await waitFor(() => expect(screen.getByText('IGA Newport')).toBeInTheDocument())

    const options = Array.from(screen.getByLabelText('Category for IGA Newport').options).map((o) => o.textContent)
    expect(options).not.toContain('Uncategorized')
  })

  it('surfaces an assignment error without losing the group', async () => {
    mockLoad()
    api.post.mockRejectedValue({ response: { data: { detail: 'Category not found' } } })
    renderGroups()

    await waitFor(() => expect(screen.getByText('IGA Newport')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Category for IGA Newport'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: /Categorize all 3/ }))

    await waitFor(() => {
      expect(screen.getByText(/Category not found/)).toBeInTheDocument()
    })
    expect(screen.getByText('IGA Newport')).toBeInTheDocument()
  })

  it('refetches when groupsQuery changes', async () => {
    mockLoad()
    const { rerender } = renderGroups({ groupsQuery: 'account_id=1' })

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/transactions/groups?account_id=1')
    })

    rerender(
      <TransactionGroups
        groupsQuery="account_id=2"
        categories={categories}
        onCategoryCreated={() => {}}
        onAssigned={vi.fn().mockResolvedValue()}
      />
    )

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/transactions/groups?account_id=2')
    })
  })
})
