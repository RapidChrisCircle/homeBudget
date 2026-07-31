import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../services/api'
import CategoriesPage from './CategoriesPage.jsx'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

const sampleCategory = { id: 1, name: 'Groceries', kind: 'expense', budget_amount: '250.00' }

function mockLoad(categories = [sampleCategory]) {
  api.get.mockImplementation((path) => {
    if (path === '/categories') {
      return Promise.resolve({ data: categories })
    }
    return Promise.reject(new Error(`unexpected path ${path}`))
  })
}

describe('CategoriesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading then the category table with kind and budget columns', async () => {
    mockLoad()

    render(<CategoriesPage />)

    expect(screen.getByText('Loading categories...')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Groceries')).toBeInTheDocument()
    })
    expect(screen.getByText('expense')).toBeInTheDocument()
    expect(screen.getByText('250.00')).toBeInTheDocument()
  })

  it('submits the create form with the entered name, kind and budget', async () => {
    mockLoad([])
    api.post.mockResolvedValue({ data: sampleCategory })

    render(<CategoriesPage />)

    await waitFor(() => expect(screen.queryByText('Loading categories...')).not.toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Groceries' } })
    fireEvent.change(screen.getByLabelText('Monthly budget'), { target: { value: '800' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Category' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/categories', {
        name: 'Groceries',
        kind: 'expense',
        budget_amount: '800',
      })
    })
  })

  it('sends a null budget when the field is left blank', async () => {
    mockLoad([])
    api.post.mockResolvedValue({ data: sampleCategory })

    render(<CategoriesPage />)

    await waitFor(() => expect(screen.queryByText('Loading categories...')).not.toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Salary' } })
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'income' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Category' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/categories', {
        name: 'Salary',
        kind: 'income',
        budget_amount: null,
      })
    })
  })

  it('hides the budget field for non-expense kinds', async () => {
    mockLoad([])

    render(<CategoriesPage />)

    await waitFor(() => expect(screen.queryByText('Loading categories...')).not.toBeInTheDocument())

    expect(screen.getByLabelText('Monthly budget')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'transfer' } })

    expect(screen.queryByLabelText('Monthly budget')).not.toBeInTheDocument()
  })

  it('prefills the form when editing a category', async () => {
    mockLoad()

    render(<CategoriesPage />)

    await waitFor(() => expect(screen.getByText('Groceries')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(screen.getByLabelText('Name')).toHaveValue('Groceries')
    expect(screen.getByLabelText('Kind')).toHaveValue('expense')
    expect(screen.getByLabelText('Monthly budget')).toHaveValue(250)
  })

  it('deletes a category when confirmed', async () => {
    mockLoad()
    api.delete.mockResolvedValue({})
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<CategoriesPage />)

    await waitFor(() => expect(screen.getByText('Groceries')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/categories/1')
    })
  })
})
