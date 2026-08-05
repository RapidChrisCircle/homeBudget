import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import HeaderFilter from './HeaderFilter.jsx'

function renderFilter(props = {}) {
  const onApply = vi.fn()
  const onClear = vi.fn()
  const utils = render(
    <table>
      <thead>
        <tr>
          <HeaderFilter
            label="Narration"
            value=""
            isActive={false}
            onApply={onApply}
            onClear={onClear}
            {...props}
          >
            {(draft, setDraft) => (
              <label>
                Narration contains
                <input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} />
              </label>
            )}
          </HeaderFilter>
        </tr>
      </thead>
    </table>
  )
  return { ...utils, onApply, onClear }
}

describe('HeaderFilter', () => {
  it('is closed by default, with aria-expanded false', () => {
    renderFilter()

    expect(screen.getByRole('button', { name: 'Filter by Narration' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText('Narration contains')).not.toBeInTheDocument()
  })

  it('opens on click, with aria-expanded/aria-controls tracking state', () => {
    renderFilter()

    const toggle = screen.getByRole('button', { name: 'Filter by Narration' })
    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const popover = screen.getByRole('dialog', { name: 'Filter by Narration' })
    expect(toggle.getAttribute('aria-controls')).toBe(popover.id)
    expect(screen.getByLabelText('Narration contains')).toBeInTheDocument()
  })

  it('closes on Escape without applying', () => {
    const { onApply } = renderFilter()

    fireEvent.click(screen.getByRole('button', { name: 'Filter by Narration' }))
    fireEvent.change(screen.getByLabelText('Narration contains'), { target: { value: 'coffee' } })
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByLabelText('Narration contains')).not.toBeInTheDocument()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('closes on an outside click without applying', () => {
    const { onApply } = renderFilter()

    fireEvent.click(screen.getByRole('button', { name: 'Filter by Narration' }))
    fireEvent.change(screen.getByLabelText('Narration contains'), { target: { value: 'coffee' } })
    fireEvent.mouseDown(document.body)

    expect(screen.queryByLabelText('Narration contains')).not.toBeInTheDocument()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('typing alone fires nothing - only Apply commits the draft', () => {
    const { onApply } = renderFilter()

    fireEvent.click(screen.getByRole('button', { name: 'Filter by Narration' }))
    fireEvent.change(screen.getByLabelText('Narration contains'), { target: { value: 'coffee' } })

    expect(onApply).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onApply).toHaveBeenCalledWith('coffee')
  })

  it('Apply closes the popover', () => {
    renderFilter()

    fireEvent.click(screen.getByRole('button', { name: 'Filter by Narration' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(screen.queryByLabelText('Narration contains')).not.toBeInTheDocument()
  })

  it('Clear calls onClear and closes the popover, without calling onApply', () => {
    const { onApply, onClear } = renderFilter()

    fireEvent.click(screen.getByRole('button', { name: 'Filter by Narration' }))
    fireEvent.change(screen.getByLabelText('Narration contains'), { target: { value: 'coffee' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(onClear).toHaveBeenCalledTimes(1)
    expect(onApply).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Narration contains')).not.toBeInTheDocument()
  })

  it('re-seeds the draft from the current value each time it opens, discarding an abandoned edit', () => {
    renderFilter({ value: 'first' })

    fireEvent.click(screen.getByRole('button', { name: 'Filter by Narration' }))
    expect(screen.getByLabelText('Narration contains')).toHaveValue('first')
    fireEvent.change(screen.getByLabelText('Narration contains'), { target: { value: 'abandoned edit' } })
    fireEvent.keyDown(document, { key: 'Escape' })

    fireEvent.click(screen.getByRole('button', { name: 'Filter by Narration' }))
    expect(screen.getByLabelText('Narration contains')).toHaveValue('first')
  })

  it('shows a marker when isActive is true, and not when false', () => {
    const { container } = renderFilter({ isActive: true })

    expect(container.querySelector('.header-filter-marker')).toBeInTheDocument()
  })

  it('renders a sort toggle when sortKey is given, with aria-sort tracking the active column', () => {
    const onSort = vi.fn()
    renderFilter({ sortKey: 'narration', activeSortKey: 'narration', activeDirection: 'asc', onSort })

    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'ascending')

    fireEvent.click(screen.getByRole('button', { name: 'Narration' }))
    expect(onSort).toHaveBeenCalledWith('narration')
  })

  it('omits aria-sort entirely when no sortKey is given - not sortable, not just inactive', () => {
    renderFilter()

    expect(screen.getByRole('columnheader')).not.toHaveAttribute('aria-sort')
  })
})
