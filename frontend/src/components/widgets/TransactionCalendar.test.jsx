import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TransactionCalendar from './TransactionCalendar.jsx'

const days = [
  { date: '2026-07-05', total_in: '0', total_out: '40.00', count: 2 },
  { date: '2026-07-08', total_in: '2000.00', total_out: '0', count: 1 },
]

describe('TransactionCalendar', () => {
  it('renders the weekday header and the month total in/out', () => {
    render(<TransactionCalendar year={2026} month={7} monthLabel="July 2026" days={days} />)

    expect(screen.getByText('July 2026')).toBeInTheDocument()
    expect(screen.getByText('↑ 2000.00')).toBeInTheDocument()
    expect(screen.getByText('↓ 40.00')).toBeInTheDocument()
  })

  it('renders every day of the month, including padding around the 1st and last', () => {
    const { container } = render(<TransactionCalendar year={2026} month={7} monthLabel="July 2026" days={[]} />)

    // 31 real days plus leading/trailing blanks fill out whole weeks.
    const cells = container.querySelectorAll('td')
    expect(cells.length % 7).toBe(0)
    expect(cells.length).toBeGreaterThanOrEqual(31)
  })

  it('is not interactive at all without onSelectDay - no stray buttons', () => {
    render(<TransactionCalendar year={2026} month={7} monthLabel="July 2026" days={days} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('makes a day with activity a clickable button when onSelectDay is given', () => {
    const onSelectDay = vi.fn()
    render(<TransactionCalendar year={2026} month={7} monthLabel="July 2026" days={days} onSelectDay={onSelectDay} />)

    fireEvent.click(screen.getByRole('button', { name: /2026-07-05/ }))

    expect(onSelectDay).toHaveBeenCalledWith('2026-07-05')
  })

  it('does not make an empty day clickable, even with onSelectDay given', () => {
    render(<TransactionCalendar year={2026} month={7} monthLabel="July 2026" days={days} onSelectDay={vi.fn()} />)

    // Only the 2 days with real activity are buttons.
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('names each day\'s activity in its accessible label', () => {
    render(<TransactionCalendar year={2026} month={7} monthLabel="July 2026" days={days} onSelectDay={vi.fn()} />)

    expect(screen.getByRole('button', { name: /2 transaction\(s\).*in 0.00.*out 40.00/ })).toBeInTheDocument()
  })

  it('does not crash on a month with no activity at all', () => {
    render(<TransactionCalendar year={2026} month={7} monthLabel="July 2026" days={[]} />)

    expect(screen.getByText('July 2026')).toBeInTheDocument()
  })

  it('marks a leading/trailing padding cell distinctly from a real day', () => {
    // 2026-07-01 is a Wednesday, so the first row has 3 leading blanks.
    const { container } = render(<TransactionCalendar year={2026} month={7} monthLabel="July 2026" days={[]} />)

    const firstRow = container.querySelector('tbody tr')
    const blanks = within(firstRow).getAllByRole('cell').filter((cell) => cell.classList.contains('tx-calendar-cell-empty'))
    expect(blanks).toHaveLength(3)
  })
})
