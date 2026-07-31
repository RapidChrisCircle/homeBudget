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

const sampleCategory = { id: 1, name: 'Groceries' }

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

  it('renders loading then the category table once data resolves', async () => {
    mockLoad()

    render(<CategoriesPage />)

    expect(screen.getByText('Loading categories...')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Groceries')).toBeInTheDocument()
    })
  })

  it('submits the create form with the entered name', async () => {
    mockLoad([])
    api.post.mockResolvedValue({ data: sampleCategory })

    render(<CategoriesPage />)

    await waitFor(() => expect(screen.queryByText('Loading categories...')).not.toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Groceries' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Category' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/categories', { name: 'Groceries' })
    })
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
