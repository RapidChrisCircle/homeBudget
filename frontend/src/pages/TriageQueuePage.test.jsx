import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../services/api'
import { showToast } from '../services/toast'
import TriageQueuePage from './TriageQueuePage.jsx'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

vi.mock('../services/toast', () => ({ showToast: vi.fn() }))

const sampleGroups = [
  {
    narration_key: 'coles', merchant: 'Coles', sample_narration: 'COLES 1234 NEWPORT',
    transaction_count: 3, total_amount: '150.00', direction: 'outflow',
    first_date: '2026-07-01', last_date: '2026-07-20', account_names: ['Joint Everyday'],
    transaction_ids: [1, 2, 3], uncategorized_count: 3, category_names: [], split_count: 0,
  },
  {
    narration_key: 'red-energy', merchant: 'Red Energy', sample_narration: 'RED ENERGY DIRECT DEBIT',
    transaction_count: 2, total_amount: '90.00', direction: 'outflow',
    first_date: '2026-07-05', last_date: '2026-08-05', account_names: ['Joint Everyday'],
    transaction_ids: [4, 5], uncategorized_count: 2, category_names: [], split_count: 0,
  },
]

const sampleCategories = [
  { id: 1, name: 'Food', kind: 'expense', parent_id: null, parent_name: null, budget_amount: null, archived: false, rolls_over: false, rollover_start_year: null, rollover_start_month: null },
  { id: 2, name: 'Groceries', kind: 'expense', parent_id: 1, parent_name: 'Food', budget_amount: '400.00', archived: false, rolls_over: false, rollover_start_year: null, rollover_start_month: null },
  { id: 3, name: 'Utilities', kind: 'expense', parent_id: null, parent_name: null, budget_amount: '150.00', archived: false, rolls_over: false, rollover_start_year: null, rollover_start_month: null },
]

function mockLoad({ groups = sampleGroups, categories = sampleCategories } = {}) {
  api.get.mockImplementation((path) => {
    if (path === '/transactions/groups') {
      return Promise.resolve({ data: { groups, total_in: '0', total_out: '0', net_total: '0' } })
    }
    if (path === '/categories') {
      return Promise.resolve({ data: categories })
    }
    return Promise.reject(new Error(`unexpected path ${path}`))
  })
  api.post.mockResolvedValue({ data: {} })
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/transactions/review']}>
      <TriageQueuePage />
    </MemoryRouter>
  )
}

describe('TriageQueuePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading then the largest merchant first', async () => {
    mockLoad()

    renderPage()

    expect(screen.getByText('Loading uncategorised transactions...')).toBeInTheDocument()

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Coles', level: 3 })).toBeInTheDocument())
    expect(screen.getByText('2 merchants · 5 transactions left')).toBeInTheDocument()
  })

  it('shows an empty state when nothing needs review', async () => {
    mockLoad({ groups: [] })

    renderPage()

    await waitFor(() => expect(screen.getByText(/Nothing left to review/)).toBeInTheDocument())
  })

  it('shows an error state when the fetch fails', async () => {
    api.get.mockRejectedValue({ message: 'network error' })

    renderPage()

    await waitFor(() => expect(screen.getByText(/network error/)).toBeInTheDocument())
  })

  it('excludes a parent (grouping-only) category from the assignable list', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Coles', level: 3 })).toBeInTheDocument())

    expect(screen.queryByRole('option', { name: 'Food' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Food › Groceries' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Utilities' })).toBeInTheDocument()
  })

  it('j moves to the next merchant and k moves back, without assigning anything', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Coles', level: 3 })).toBeInTheDocument())

    const container = document.querySelector('.triage-queue')
    fireEvent.keyDown(container, { key: 'j' })
    expect(screen.getByRole('heading', { name: 'Red Energy', level: 3 })).toBeInTheDocument()

    fireEvent.keyDown(container, { key: 'k' })
    expect(screen.getByRole('heading', { name: 'Coles', level: 3 })).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('typing filters the category list, and Enter assigns the active one', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Coles', level: 3 })).toBeInTheDocument())

    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'grocer' } })

    expect(screen.getByRole('option', { name: 'Food › Groceries' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Utilities' })).not.toBeInTheDocument()

    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/transactions/bulk-category', {
        transaction_ids: [1, 2, 3],
        category_id: 2,
      })
    })
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Coles'))

    // Coles is gone; Red Energy is now current.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Red Energy', level: 3 })).toBeInTheDocument())
    expect(screen.getByText('1 merchant · 2 transactions left')).toBeInTheDocument()
  })

  it('clicking a category option assigns it directly', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Coles', level: 3 })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('option', { name: 'Utilities' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/transactions/bulk-category', {
        transaction_ids: [1, 2, 3],
        category_id: 3,
      })
    })
  })

  it('also creates a rule when the checkbox is checked', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Coles', level: 3 })).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('Also create a rule from this merchant'))
    fireEvent.click(screen.getByRole('option', { name: 'Utilities' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/category-rules', {
        narration_pattern: 'Coles',
        category_id: 3,
      })
    })
  })

  it('does not create a rule when the checkbox is left unchecked', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Coles', level: 3 })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('option', { name: 'Utilities' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/transactions/bulk-category', expect.anything()))
    expect(api.post).not.toHaveBeenCalledWith('/category-rules', expect.anything())
  })

  it('undo restores the merchant to the queue and re-nulls its category', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Coles', level: 3 })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('option', { name: 'Utilities' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Red Energy', level: 3 })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Undo/ }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/transactions/bulk-category', {
        transaction_ids: [1, 2, 3],
        category_id: null,
      })
    })
    expect(screen.getByRole('heading', { name: 'Coles', level: 3 })).toBeInTheDocument()
    expect(screen.getByText('2 merchants · 5 transactions left')).toBeInTheDocument()
  })

  it('the Undo button is disabled until something has been assigned', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Coles', level: 3 })).toBeInTheDocument())

    expect(screen.getByRole('button', { name: /Undo/ })).toBeDisabled()
  })

  it('shows an action error inline when an assignment fails, without losing the merchant from the queue', async () => {
    mockLoad()
    api.post.mockRejectedValue({ message: 'save failed' })

    renderPage()

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Coles', level: 3 })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('option', { name: 'Utilities' }))

    await waitFor(() => expect(screen.getByText(/save failed/)).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Coles', level: 3 })).toBeInTheDocument()
  })
})
