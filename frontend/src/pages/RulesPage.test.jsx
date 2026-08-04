import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../services/api'
import RulesPage from './RulesPage.jsx'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

const sampleRule = {
  id: 1,
  narration_pattern: 'woolworths',
  transaction_type: null,
  min_amount: null,
  max_amount: null,
  category_id: 1,
  category_name: 'Groceries',
  priority: 1,
  created_at: '2026-07-24T10:00:00Z',
}

const sampleCategory = { id: 1, name: 'Groceries' }

function mockLoad(rules = [sampleRule], categories = [sampleCategory], transactionTypes = ['DEP', 'WDL'], findings = []) {
  api.get.mockImplementation((path) => {
    if (path === '/category-rules') {
      return Promise.resolve({ data: rules })
    }
    if (path === '/categories') {
      return Promise.resolve({ data: categories })
    }
    if (path === '/transactions/types') {
      return Promise.resolve({ data: transactionTypes })
    }
    if (path === '/category-rules/review') {
      return Promise.resolve({ data: { findings } })
    }
    return Promise.reject(new Error(`unexpected path ${path}`))
  })
}

function renderPage(initialEntry = '/rules') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <RulesPage />
    </MemoryRouter>
  )
}

describe('RulesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading then the rules table once data resolves', async () => {
    mockLoad()

    renderPage()

    expect(screen.getByText('Loading rules...')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('woolworths')).toBeInTheDocument()
    })

    // Scoped to the row - "Groceries" also appears as an <option> in the form.
    const row = screen.getByText('woolworths').closest('tr')
    expect(within(row).getByText('Groceries')).toBeInTheDocument()
  })

  it('submits the create form sending blank optional fields as null', async () => {
    mockLoad([])
    api.post.mockResolvedValue({ data: sampleRule })

    renderPage()

    await waitFor(() => expect(screen.queryByText('Loading rules...')).not.toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Narration contains'), { target: { value: 'coles' } })
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: '1' } })
    // Two "Add Rule" buttons now exist - the collapsible card's own toggle
    // and the form's submit button, which is rendered last.
    const addRuleButtons = screen.getAllByRole('button', { name: 'Add Rule' })
    fireEvent.click(addRuleButtons[addRuleButtons.length - 1])

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/category-rules', {
        narration_pattern: 'coles',
        transaction_type: null,
        min_amount: null,
        max_amount: null,
        category_id: 1,
      })
    })
  })

  it('populates the transaction type dropdown from available types', async () => {
    mockLoad([], [sampleCategory], ['DEP', 'WDL', 'TFD'])

    renderPage()

    await waitFor(() => expect(screen.queryByText('Loading rules...')).not.toBeInTheDocument())

    const select = screen.getByLabelText('Transaction type')
    fireEvent.change(select, { target: { value: 'TFD' } })

    expect(select).toHaveValue('TFD')
    expect(screen.getByRole('option', { name: 'Any type' })).toBeInTheDocument()
  })

  it('keeps a rule\'s saved transaction type visible even if no longer in the fetched list', async () => {
    const rule = { ...sampleRule, transaction_type: 'TFD' }
    mockLoad([rule], [sampleCategory], ['DEP', 'WDL'])

    renderPage()

    await waitFor(() => expect(screen.getByText('woolworths')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(screen.getByLabelText('Transaction type')).toHaveValue('TFD')
  })

  it('prefills the narration pattern from the query parameter', async () => {
    mockLoad([])

    renderPage('/rules?narration=WOOLWORTHS%20NEWPORT')

    await waitFor(() => {
      expect(screen.getByLabelText('Narration contains')).toHaveValue('WOOLWORTHS NEWPORT')
    })
  })

  it('shows the match count when Check matches is clicked', async () => {
    mockLoad([])
    api.post.mockResolvedValue({ data: { match_count: 47, would_categorize_count: 12 } })

    renderPage()

    await waitFor(() => expect(screen.queryByText('Loading rules...')).not.toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Narration contains'), { target: { value: 'woolworths' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check matches' }))

    await waitFor(() => {
      expect(screen.getByText(/Would match 47 transaction\(s\)/)).toBeInTheDocument()
    })
    expect(screen.getByText(/12 would\s+be categorized now/)).toBeInTheDocument()
  })

  it('applies rules and shows the categorized count', async () => {
    mockLoad()
    api.post.mockResolvedValue({ data: { categorized_count: 8 } })

    renderPage()

    await waitFor(() => expect(screen.getByText('woolworths')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Apply rules now' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/category-rules/apply')
    })
    expect(await screen.findByText('Categorized 8 transaction(s).')).toBeInTheDocument()
  })

  it('moves a rule up when the up button is clicked', async () => {
    const second = { ...sampleRule, id: 2, narration_pattern: 'coles', priority: 2 }
    mockLoad([sampleRule, second])
    api.post.mockResolvedValue({ data: [second, sampleRule] })

    renderPage()

    await waitFor(() => expect(screen.getByText('coles')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Move coles up' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/category-rules/2/move', { direction: 'up' })
    })
  })

  it('renders review findings grouped by kind, with removal offered for duplicate/subsumed but not shadowed', async () => {
    const findings = [
      {
        rule_id: 2, narration_pattern: 'woolworths', category_id: 1, category_name: 'Groceries',
        kind: 'duplicate', blocking_rule_id: 1, blocking_narration_pattern: 'woolworths',
      },
      {
        rule_id: 3, narration_pattern: 'woolworths metro', category_id: 1, category_name: 'Groceries',
        kind: 'subsumed', blocking_rule_id: 1, blocking_narration_pattern: 'woolworths',
      },
      {
        rule_id: 4, narration_pattern: 'woolworths metro central', category_id: 2, category_name: 'Dining',
        kind: 'shadowed', blocking_rule_id: 1, blocking_narration_pattern: 'woolworths',
      },
    ]
    mockLoad([sampleRule], [sampleCategory], ['DEP', 'WDL'], findings)

    renderPage()

    await waitFor(() => expect(screen.getByText('Duplicate (1)')).toBeInTheDocument())
    expect(screen.getByText('Subsumed (1)')).toBeInTheDocument()
    expect(screen.getByText('Shadowed (needs review) (1)')).toBeInTheDocument()

    const reviewCard = screen.getByText('Duplicate (1)').closest('.card')
    const items = within(reviewCard).getAllByRole('listitem')

    // Rendered in kind order (duplicate, subsumed, shadowed), one finding
    // per kind here, so index maps directly to which finding each item is.
    expect(within(items[0]).getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    expect(within(items[1]).getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    expect(within(items[2]).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Remove all duplicate/subsumed rules' })).toBeInTheDocument()
  })

  it('removes a single finding via its own Remove button', async () => {
    const findings = [{
      rule_id: 2, narration_pattern: 'woolworths metro', category_id: 1, category_name: 'Groceries',
      kind: 'subsumed', blocking_rule_id: 1, blocking_narration_pattern: 'woolworths',
    }]
    mockLoad([sampleRule], [sampleCategory], ['DEP', 'WDL'], findings)
    api.delete.mockResolvedValue({})

    renderPage()

    await waitFor(() => expect(screen.getByText('Subsumed (1)')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/category-rules/2')
    })
  })

  it('does not offer the bulk remove action when only shadowed findings exist', async () => {
    const findings = [{
      rule_id: 4, narration_pattern: 'woolworths metro central', category_id: 2, category_name: 'Dining',
      kind: 'shadowed', blocking_rule_id: 1, blocking_narration_pattern: 'woolworths',
    }]
    mockLoad([sampleRule], [sampleCategory], ['DEP', 'WDL'], findings)

    renderPage()

    await waitFor(() => expect(screen.getByText('Shadowed (needs review) (1)')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: 'Remove all duplicate/subsumed rules' })).not.toBeInTheDocument()
  })

  it('calls the bulk remove-redundant endpoint and shows how many were removed', async () => {
    const findings = [{
      rule_id: 2, narration_pattern: 'woolworths metro', category_id: 1, category_name: 'Groceries',
      kind: 'subsumed', blocking_rule_id: 1, blocking_narration_pattern: 'woolworths',
    }]
    mockLoad([sampleRule], [sampleCategory], ['DEP', 'WDL'], findings)
    api.post.mockResolvedValue({ data: { removed_count: 1 } })

    renderPage()

    await waitFor(() => expect(screen.getByText('Subsumed (1)')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Remove all duplicate/subsumed rules' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/category-rules/review/remove-redundant')
    })
    expect(await screen.findByText('Removed 1 redundant rule(s).')).toBeInTheDocument()
  })

  it('opens the edit form beneath the row being edited, keeps the top card titled "Add Rule", and closes a prior edit when a second is opened', async () => {
    const second = { ...sampleRule, id: 2, narration_pattern: 'coles', priority: 2 }
    mockLoad([sampleRule, second])

    renderPage()

    await waitFor(() => expect(screen.getByText('coles')).toBeInTheDocument())
    expect(screen.getAllByText('Add Rule').length).toBeGreaterThan(0)

    const firstRow = screen.getByText('woolworths').closest('tr')
    const secondRow = screen.getByText('coles').closest('tr')

    fireEvent.click(within(firstRow).getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Narration contains')).toHaveValue('woolworths')
    expect(screen.getAllByText('Add Rule').length).toBeGreaterThan(0)
    expect(screen.queryByText('Edit Rule')).not.toBeInTheDocument()

    fireEvent.click(within(secondRow).getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Narration contains')).toHaveValue('coles')
    expect(screen.getAllByLabelText('Narration contains')).toHaveLength(1)
  })

  it('cancel leaves the rule unchanged and closes the editor', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText('woolworths')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Narration contains'), { target: { value: 'changed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getAllByLabelText('Narration contains')).toHaveLength(1)
    expect(screen.getByLabelText('Narration contains')).toHaveValue('')
    expect(api.put).not.toHaveBeenCalled()
  })

  it('saving an edit posts the same payload as before and closes the editor', async () => {
    mockLoad()
    api.put.mockResolvedValue({ data: sampleRule })

    renderPage()

    await waitFor(() => expect(screen.getByText('woolworths')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Narration contains'), { target: { value: 'coles' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/category-rules/1', {
        narration_pattern: 'coles',
        transaction_type: null,
        min_amount: null,
        max_amount: null,
        category_id: 1,
      })
    })
    expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument()
  })

  it('deletes a rule when confirmed', async () => {
    mockLoad()
    api.delete.mockResolvedValue({})
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderPage()

    await waitFor(() => expect(screen.getByText('woolworths')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/category-rules/1')
    })
  })
})
