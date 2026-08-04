import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../services/api'
import AccountsPage from './AccountsPage.jsx'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

const sampleCard = {
  id: 2,
  name: 'Visa',
  institution: 'ANZ',
  account_type: 'credit_card',
  balance_sign: 'natural',
  bsb_number: null,
  account_number: '9999',
  created_at: '2026-07-24T10:00:00Z',
  balance: '-300.50',
  balance_as_of: '2026-07-24',
}

const sampleAccount = {
  id: 1,
  name: 'Joint Everyday',
  institution: 'ANZ',
  account_type: 'everyday',
  balance_sign: 'natural',
  bsb_number: '013-006',
  account_number: '5229 8024 5118 3514',
  created_at: '2026-07-24T10:00:00Z',
  balance: '-4838.18',
  balance_as_of: '2026-07-24',
}

function mockLoad(
  accounts = [sampleAccount],
  { inference = { inferred_sign: null, sample_size: 0 }, groups = [] } = {}
) {
  api.get.mockImplementation((path) => {
    if (path === '/accounts') {
      return Promise.resolve({ data: accounts })
    }
    if (path === '/account-groups') {
      return Promise.resolve({ data: groups })
    }
    if (path.endsWith('/infer-balance-sign')) {
      return Promise.resolve({ data: inference })
    }
    return Promise.reject(new Error(`unexpected path ${path}`))
  })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AccountsPage />
    </MemoryRouter>
  )
}

describe('AccountsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading then the account table once data resolves', async () => {
    mockLoad()

    renderPage()

    expect(screen.getByText('Loading accounts...')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Joint Everyday')).toBeInTheDocument()
    })
  })

  it('shows the balance and as-of date', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/-4838.18 \(as of 2026-07-24\)/)).toBeInTheDocument()
    })
  })

  it('shows "No transactions yet" when the account has no balance', async () => {
    mockLoad([{ ...sampleAccount, balance: null, balance_as_of: null }])

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('No transactions yet')).toBeInTheDocument()
    })
  })

  it('links the account name to its detail page', async () => {
    mockLoad()

    renderPage()

    await waitFor(() => expect(screen.getByText('Joint Everyday')).toBeInTheDocument())

    expect(screen.getByRole('link', { name: 'Joint Everyday' })).toHaveAttribute('href', '/accounts/1')
  })

  it('submits the create form with the entered fields', async () => {
    mockLoad([])
    api.post.mockResolvedValue({ data: sampleAccount })

    renderPage()

    await waitFor(() => expect(screen.queryByText('Loading accounts...')).not.toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Joint Everyday' } })
    fireEvent.change(screen.getByLabelText('Account Number'), { target: { value: '5229 8024 5118 3514' } })
    // Two "Add Account" buttons now exist - the collapsible card's own
    // toggle (title text doubles as its accessible name) and the form's
    // submit button. The submit button is the one rendered last.
    const addButtons = screen.getAllByRole('button', { name: 'Add Account' })
    fireEvent.click(addButtons[addButtons.length - 1])

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/accounts', expect.objectContaining({
        name: 'Joint Everyday',
        account_number: '5229 8024 5118 3514',
      }))
    })
  })

  it('deletes an account when confirmed', async () => {
    mockLoad()
    api.delete.mockResolvedValue({})
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderPage()

    await waitFor(() => expect(screen.getByText('Joint Everyday')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/accounts/1')
    })
  })

  it('shows an error message when delete fails', async () => {
    mockLoad()
    api.delete.mockRejectedValue({ response: { data: { detail: 'Cannot delete an account with existing transactions' } } })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderPage()

    await waitFor(() => expect(screen.getByText('Joint Everyday')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(screen.getByText(/Cannot delete an account with existing transactions/)).toBeInTheDocument()
    })
  })

  // --- In-place editing ---------------------------------------------------

  it('opens the edit form beneath the row being edited, not in the top card', async () => {
    mockLoad([sampleAccount])

    renderPage()

    await waitFor(() => expect(screen.getByText('Joint Everyday')).toBeInTheDocument())

    const row = screen.getByText('Joint Everyday').closest('tr')
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))

    // Exactly one Name field exists - the top card shows a message instead
    // of a form while an edit is open, not a second copy of it.
    const nameField = screen.getByLabelText('Name')
    expect(nameField).toHaveValue('Joint Everyday')
    expect(nameField.closest('tr')).not.toBeNull()

    expect(screen.getByText('Finish editing the account below to add another.')).toBeInTheDocument()
  })

  it('keeps the top card titled "Add Account" throughout an edit', async () => {
    mockLoad([sampleAccount])

    renderPage()

    await waitFor(() => expect(screen.getByText('Joint Everyday')).toBeInTheDocument())
    expect(screen.getAllByText('Add Account').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(screen.getAllByText('Add Account').length).toBeGreaterThan(0)
    expect(screen.queryByText('Edit Account')).not.toBeInTheDocument()
  })

  it('closes the first row\'s editor when a second row is opened', async () => {
    const second = { ...sampleAccount, id: 5, name: 'Savings' }
    mockLoad([sampleAccount, second])

    renderPage()

    await waitFor(() => expect(screen.getByText('Savings')).toBeInTheDocument())

    const firstRow = screen.getByRole('link', { name: 'Joint Everyday' }).closest('tr')
    const secondRow = screen.getByRole('link', { name: 'Savings' }).closest('tr')

    fireEvent.click(within(firstRow).getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Joint Everyday')

    fireEvent.click(within(secondRow).getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Savings')
    // Only one edit form exists at a time.
    expect(screen.getAllByLabelText('Name')).toHaveLength(1)
  })

  it('cancel leaves the row unchanged and closes the editor', async () => {
    mockLoad([sampleAccount])

    renderPage()

    await waitFor(() => expect(screen.getByText('Joint Everyday')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Changed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    // The row's own edit form is gone - only the top (empty, Add-only) form
    // remains, so exactly one Name field exists again and it's blank.
    expect(screen.getAllByLabelText('Name')).toHaveLength(1)
    expect(screen.getByLabelText('Name')).toHaveValue('')
    expect(screen.getByRole('link', { name: 'Joint Everyday' })).toBeInTheDocument()
    expect(api.put).not.toHaveBeenCalled()
  })

  it('saving an edit posts the same payload as before and closes the editor', async () => {
    mockLoad([sampleAccount])
    api.put.mockResolvedValue({ data: sampleAccount })

    renderPage()

    await waitFor(() => expect(screen.getByText('Joint Everyday')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/accounts/1', expect.objectContaining({
        name: 'Renamed',
        account_number: sampleAccount.account_number,
      }))
    })
    expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument()
  })

  // --- Typed accounts and the balance-sign toggle ------------------------

  it('shows friendly type labels in the table, including Unclassified for a null type', async () => {
    mockLoad([sampleAccount, { ...sampleCard, id: 3, account_type: null }])

    renderPage()

    await waitFor(() => expect(screen.getByText('Joint Everyday')).toBeInTheDocument())

    // "Everyday" also appears as an <option> in the form's own Account Type
    // select, regardless of which row is shown - scope to the table.
    const table = screen.getByText('All Accounts').closest('.card')
    expect(within(table).getByText('Everyday')).toBeInTheDocument()
    expect(within(table).getByText('Unclassified')).toBeInTheDocument()
  })

  it('does not show the balance-sign toggle for an asset type', async () => {
    mockLoad([])

    renderPage()

    await waitFor(() => expect(screen.queryByText('Loading accounts...')).not.toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Account Type'), { target: { value: 'everyday' } })

    expect(screen.queryByLabelText('Balance sign')).not.toBeInTheDocument()
  })

  it('shows the balance-sign toggle when a liability type is selected', async () => {
    mockLoad([])

    renderPage()

    await waitFor(() => expect(screen.queryByText('Loading accounts...')).not.toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Account Type'), { target: { value: 'credit_card' } })

    expect(screen.getByLabelText('Balance sign')).toBeInTheDocument()
  })

  it('fetches and shows the inferred sign when editing an existing liability account', async () => {
    mockLoad([sampleCard], { inference: { inferred_sign: 'inverted', sample_size: 12 } })

    renderPage()

    await waitFor(() => expect(screen.getByText('Visa')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/accounts/2/infer-balance-sign')
    })
    expect(await screen.findByText(/Inferred from 12 past balances/)).toBeInTheDocument()
    expect(screen.getByText('inverted')).toBeInTheDocument()
  })

  it('applies the inferred sign only when "Use this" is clicked, never automatically', async () => {
    mockLoad([sampleCard], { inference: { inferred_sign: 'inverted', sample_size: 12 } })

    renderPage()

    await waitFor(() => expect(screen.getByText('Visa')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    await screen.findByText(/Inferred from 12 past balances/)
    // The account's OWN stored sign ("natural") is what the form shows
    // until the user explicitly accepts the suggestion - never silently
    // overridden by the inference the moment it loads.
    expect(screen.getByLabelText('Balance sign')).toHaveValue('natural')

    fireEvent.click(screen.getByRole('button', { name: 'Use this' }))

    expect(screen.getByLabelText('Balance sign')).toHaveValue('inverted')
  })

  it('submits the selected balance sign', async () => {
    mockLoad([])
    api.post.mockResolvedValue({ data: sampleCard })

    renderPage()

    await waitFor(() => expect(screen.queryByText('Loading accounts...')).not.toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Visa' } })
    fireEvent.change(screen.getByLabelText('Account Number'), { target: { value: '9999' } })
    fireEvent.change(screen.getByLabelText('Account Type'), { target: { value: 'credit_card' } })
    fireEvent.change(screen.getByLabelText('Balance sign'), { target: { value: 'inverted' } })

    const addButtons = screen.getAllByRole('button', { name: 'Add Account' })
    fireEvent.click(addButtons[addButtons.length - 1])

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/accounts', expect.objectContaining({
        account_type: 'credit_card',
        balance_sign: 'inverted',
      }))
    })
  })

  // --- Account groups ------------------------------------------------------

  it('nests grouped accounts under their group name, with an Ungrouped section for the rest', async () => {
    const group = { id: 9, name: 'Visa Group', created_at: '2026-07-24T10:00:00Z' }
    const grouped = { ...sampleCard, group_id: 9, group_name: 'Visa Group' }
    mockLoad([sampleAccount, grouped], { groups: [group] })

    renderPage()

    await waitFor(() => expect(screen.getByRole('button', { name: /Visa Group/ })).toBeInTheDocument())

    const groupSection = screen.getByRole('button', { name: /Visa Group/ }).closest('.card')
    expect(within(groupSection).getByText('9999')).toBeInTheDocument()

    const ungroupedSection = screen.getByText('Ungrouped').closest('.card')
    expect(within(ungroupedSection).getByText('Joint Everyday')).toBeInTheDocument()
  })

  it('renders one flat table with no section headings when nothing is grouped', async () => {
    mockLoad([sampleAccount, sampleCard])

    renderPage()

    await waitFor(() => expect(screen.getByText('Joint Everyday')).toBeInTheDocument())

    expect(screen.queryByText('Ungrouped')).not.toBeInTheDocument()
  })

  it('creates an account group', async () => {
    mockLoad([])
    api.post.mockResolvedValue({ data: { id: 1, name: 'Visa', created_at: '2026-07-24T10:00:00Z' } })

    renderPage()

    await waitFor(() => expect(screen.queryByText('Loading accounts...')).not.toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('New group name'), { target: { value: 'Visa' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Group' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/account-groups', { name: 'Visa' })
    })
  })

  it('renames an account group', async () => {
    const group = { id: 9, name: 'Visa', created_at: '2026-07-24T10:00:00Z' }
    mockLoad([], { groups: [group] })
    api.put.mockResolvedValue({ data: { ...group, name: 'Visa (renamed)' } })

    renderPage()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByLabelText('Rename Visa'), { target: { value: 'Visa (renamed)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/account-groups/9', { name: 'Visa (renamed)' })
    })
  })

  it('deletes an account group when confirmed', async () => {
    const group = { id: 9, name: 'Visa', created_at: '2026-07-24T10:00:00Z' }
    mockLoad([], { groups: [group] })
    api.delete.mockResolvedValue({})
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderPage()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/account-groups/9')
    })
  })

  it('assigns an account to a group via the account form', async () => {
    const group = { id: 9, name: 'Visa Group', created_at: '2026-07-24T10:00:00Z' }
    mockLoad([sampleCard], { groups: [group] })
    api.put.mockResolvedValue({ data: sampleCard })

    renderPage()

    await waitFor(() => expect(screen.getByText('Visa')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Group'), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/accounts/2', expect.objectContaining({ group_id: 9 }))
    })
  })
})
