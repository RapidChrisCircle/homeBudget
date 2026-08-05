import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SortableHeader from './SortableHeader.jsx'

function renderHeaders({ activeSortKey = null, activeDirection = null } = {}) {
  const onSort = vi.fn()
  const utils = render(
    <table>
      <thead>
        <tr>
          <SortableHeader label="Date" sortKey="date" activeSortKey={activeSortKey} activeDirection={activeDirection} onSort={onSort} />
          <SortableHeader label="Amount" sortKey="amount" activeSortKey={activeSortKey} activeDirection={activeDirection} onSort={onSort} />
        </tr>
      </thead>
    </table>
  )
  return { ...utils, onSort }
}

describe('SortableHeader', () => {
  it('reports aria-sort="none" when not the active column', () => {
    renderHeaders()

    expect(screen.getByRole('columnheader', { name: 'Date' })).toHaveAttribute('aria-sort', 'none')
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toHaveAttribute('aria-sort', 'none')
  })

  it('reports aria-sort="ascending" only for the active column', () => {
    renderHeaders({ activeSortKey: 'date', activeDirection: 'asc' })

    expect(screen.getByRole('columnheader', { name: /Date/ })).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toHaveAttribute('aria-sort', 'none')
  })

  it('reports aria-sort="descending" for the active column in the other direction', () => {
    renderHeaders({ activeSortKey: 'date', activeDirection: 'desc' })

    expect(screen.getByRole('columnheader', { name: /Date/ })).toHaveAttribute('aria-sort', 'descending')
  })

  it('never marks more than one column active at a time', () => {
    renderHeaders({ activeSortKey: 'amount', activeDirection: 'asc' })

    const headers = screen.getAllByRole('columnheader')
    const activeCount = headers.filter((h) => h.getAttribute('aria-sort') !== 'none').length
    expect(activeCount).toBe(1)
  })

  it('calls onSort with its own sortKey when clicked', () => {
    const { onSort } = renderHeaders()

    fireEvent.click(screen.getByRole('button', { name: 'Date' }))

    expect(onSort).toHaveBeenCalledWith('date')
  })

  it('numeric right-aligns the header without disturbing aria-sort', () => {
    render(
      <table>
        <thead>
          <tr>
            <SortableHeader label="Amount" sortKey="amount" activeSortKey="amount" activeDirection="asc" onSort={vi.fn()} numeric />
          </tr>
        </thead>
      </table>
    )

    const header = screen.getByRole('columnheader', { name: /Amount/ })
    expect(header).toHaveClass('numeric')
    expect(header).toHaveAttribute('aria-sort', 'ascending')
  })

  it('omits the numeric class by default', () => {
    renderHeaders()

    expect(screen.getByRole('columnheader', { name: 'Date' })).not.toHaveClass('numeric')
  })
})
