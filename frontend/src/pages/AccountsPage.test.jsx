import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

const sampleAccount = {
  id: 1,
  name: 'Joint Everyday',
  institution: 'ANZ',
  account_type: 'everyday',
  bsb_number: '013-006',
  account_number: '5229 8024 5118 3514',
  created_at: '2026-07-24T10:00:00Z',
}

function mockLoad(accounts = [sampleAccount]) {
  api.get.mockImplementation((path) => {
    if (path === '/accounts') {
      return Promise.resolve({ data: accounts })
    }
    return Promise.reject(new Error(`unexpected path ${path}`))
  })
}

describe('AccountsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading then the account table once data resolves', async () => {
    mockLoad()

    render(<AccountsPage />)

    expect(screen.getByText('Loading accounts...')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Joint Everyday')).toBeInTheDocument()
    })
  })

  it('submits the create form with the entered fields', async () => {
    mockLoad([])
    api.post.mockResolvedValue({ data: sampleAccount })

    render(<AccountsPage />)

    await waitFor(() => expect(screen.queryByText('Loading accounts...')).not.toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Joint Everyday' } })
    fireEvent.change(screen.getByLabelText('Account Number'), { target: { value: '5229 8024 5118 3514' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Account' }))

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

    render(<AccountsPage />)

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

    render(<AccountsPage />)

    await waitFor(() => expect(screen.getByText('Joint Everyday')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(screen.getByText(/Cannot delete an account with existing transactions/)).toBeInTheDocument()
    })
  })
})
