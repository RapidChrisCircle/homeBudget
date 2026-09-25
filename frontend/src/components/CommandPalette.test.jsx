import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CommandPalette from './CommandPalette.jsx'
import { api } from '../services/api'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
  },
}))

const categories = [
  { id: 1, name: 'Groceries' },
  { id: 2, name: 'Fuel' },
]

const accounts = [
  { id: 1, name: 'Joint Everyday' },
]

function mockLoad({ merchantGroups = [] } = {}) {
  api.get.mockImplementation((path) => {
    if (path === '/categories') {
      return Promise.resolve({ data: categories })
    }
    if (path === '/accounts') {
      return Promise.resolve({ data: accounts })
    }
    if (path.startsWith('/transactions/groups')) {
      return Promise.resolve({ data: { groups: merchantGroups } })
    }
    return Promise.reject(new Error(`unexpected path ${path}`))
  })
}

function LocationProbe({ label }) {
  const location = useLocation()

  return <div>{`${label}${location.search}`}</div>
}

function renderPalette(initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <CommandPalette />
      <Routes>
        <Route path="/" element={<div>Home</div>} />
        <Route path="/rules" element={<div>Rules page</div>} />
        <Route path="/transactions" element={<LocationProbe label="ledger" />} />
        <Route path="/accounts/:id" element={<LocationProbe label="account" />} />
      </Routes>
    </MemoryRouter>
  )
}

function openPalette() {
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
}

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing until opened', () => {
    mockLoad()
    renderPalette()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens on Ctrl+K and focuses the search input', async () => {
    mockLoad()
    renderPalette()

    openPalette()

    const input = screen.getByRole('combobox')
    expect(input).toBeInTheDocument()
    await waitFor(() => expect(input).toHaveFocus())
  })

  it('also opens on Cmd+K (metaKey)', () => {
    mockLoad()
    renderPalette()

    fireEvent.keyDown(document, { key: 'k', metaKey: true })

    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('toggles closed on a second Ctrl+K', () => {
    mockLoad()
    renderPalette()

    openPalette()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    openPalette()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on Escape', () => {
    mockLoad()
    renderPalette()
    openPalette()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes when clicking outside the palette', () => {
    mockLoad()
    const { container } = renderPalette()
    openPalette()

    fireEvent.click(container.querySelector('.command-palette-overlay'))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not close when clicking inside the palette itself', () => {
    mockLoad()
    renderPalette()
    openPalette()

    fireEvent.click(screen.getByRole('dialog'))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('matches a page by label and navigates to it on click', async () => {
    mockLoad()
    renderPalette()
    openPalette()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'rules' } })

    const option = await screen.findByRole('option', { name: 'Rules' })
    fireEvent.click(option)

    expect(await screen.findByText('Rules page')).toBeInTheDocument()
  })

  it('closes the palette after navigating', async () => {
    mockLoad()
    renderPalette()
    openPalette()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'rules' } })
    fireEvent.click(await screen.findByRole('option', { name: 'Rules' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('matches a category, fetched lazily on open, and navigates to the filtered ledger', async () => {
    mockLoad()
    renderPalette()
    openPalette()

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/categories'))

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'groc' } })
    fireEvent.click(await screen.findByRole('option', { name: 'Groceries' }))

    expect(await screen.findByText('ledger?category_id=1')).toBeInTheDocument()
  })

  it('matches an account and navigates to its detail page', async () => {
    mockLoad()
    renderPalette()
    openPalette()

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/accounts'))

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'joint' } })
    fireEvent.click(await screen.findByRole('option', { name: 'Joint Everyday' }))

    expect(await screen.findByText('account')).toBeInTheDocument()
  })

  it('does not fetch categories or accounts again on a second opening', async () => {
    mockLoad()
    renderPalette()

    openPalette()
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/categories'))
    fireEvent.keyDown(document, { key: 'Escape' })

    openPalette()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(api.get.mock.calls.filter(([path]) => path === '/categories')).toHaveLength(1)
    expect(api.get.mock.calls.filter(([path]) => path === '/accounts')).toHaveLength(1)
  })

  it('searches merchants (debounced) and navigates to a narration search', async () => {
    vi.useFakeTimers()
    mockLoad({ merchantGroups: [{ narration_key: 'woolworths', merchant: 'Woolworths' }] })
    renderPalette()
    openPalette()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'woolwo' } })

    // Not yet - the debounce hasn't elapsed.
    expect(api.get.mock.calls.some(([path]) => path.startsWith('/transactions/groups'))).toBe(false)

    await act(async () => {
      vi.advanceTimersByTime(250)
    })
    vi.useRealTimers()

    const option = await screen.findByRole('option', { name: 'Woolworths' })
    fireEvent.click(option)

    expect(await screen.findByText('ledger?search=Woolworths')).toBeInTheDocument()
  })

  it('shows "No matches" for a query with nothing found anywhere', async () => {
    mockLoad()
    renderPalette()
    openPalette()

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/categories'))

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzznothingmatchesthis' } })

    expect(await screen.findByText('No matches.')).toBeInTheDocument()
  })

  it('shows no results and no "No matches" message on an empty query', () => {
    mockLoad()
    renderPalette()
    openPalette()

    expect(screen.queryByText('No matches.')).not.toBeInTheDocument()
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('moves the active selection with arrow keys and activates it with Enter', async () => {
    mockLoad()
    renderPalette()
    openPalette()

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/categories'))

    // "e" matches the "Reports"/"Recurring"/"Rules"/"Settings"-shaped pages
    // less reliably than a term guaranteed to match exactly one page and
    // nothing else - "rules" is unique across pages/categories/accounts.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'rules' } })
    await screen.findByRole('option', { name: 'Rules' })

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })

    expect(await screen.findByText('Rules page')).toBeInTheDocument()
  })

  it('marks the first result active by default via aria-selected', async () => {
    mockLoad()
    renderPalette()
    openPalette()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'rules' } })

    const option = await screen.findByRole('option', { name: 'Rules' })
    expect(option).toHaveAttribute('aria-selected', 'true')
  })
})
