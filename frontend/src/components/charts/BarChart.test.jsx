import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import BarChart from './BarChart.jsx'

const periods = ['2026-01', '2026-02', '2026-03']

describe('BarChart', () => {
  it('renders a bar per datum, with hover text via <title>', () => {
    const { container } = render(
      <BarChart periods={periods} series={[{ label: 'Income', values: [5000, 5200, 4800] }]} />
    )

    expect(container.querySelectorAll('rect')).toHaveLength(3)
    expect(screen.getByText('Income — 2026-02: 5200')).toBeInTheDocument()
  })

  it('renders multiple series side by side with a legend', () => {
    const { container } = render(
      <BarChart
        periods={periods}
        series={[
          { label: 'Income', values: [5000, 5200, 4800] },
          { label: 'Spending', values: [3200, 3400, 3100] },
        ]}
      />
    )

    expect(container.querySelectorAll('rect')).toHaveLength(6)
    expect(screen.getByText('Income')).toBeInTheDocument()
    expect(screen.getByText('Spending')).toBeInTheDocument()
  })

  it('does not render a legend for a single series', () => {
    render(<BarChart periods={periods} series={[{ label: 'Net saved', values: [1800, 1200, -400] }]} />)

    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('draws a negative bar below the zero line rather than requiring special handling', () => {
    const { container } = render(
      <BarChart periods={periods} series={[{ label: 'Net saved', values: [1800, 1200, -400] }]} />
    )

    const bars = container.querySelectorAll('rect')
    const zeroLine = container.querySelector('line[stroke="#9ca3af"]')
    const zeroY = Number(zeroLine.getAttribute('y1'))

    // The negative bar (index 2) must start AT the zero line, not above it.
    expect(Number(bars[2].getAttribute('y'))).toBeCloseTo(zeroY, 0)
    // A positive bar must end at the zero line (top is above it).
    expect(Number(bars[0].getAttribute('y'))).toBeLessThan(zeroY)
  })

  it('renders "not enough data yet" when there is no data', () => {
    render(<BarChart periods={[]} series={[]} />)

    expect(screen.getByText('Not enough data yet.')).toBeInTheDocument()
  })

  it('skips a null datum without crashing or drawing a phantom bar', () => {
    const { container } = render(
      <BarChart periods={periods} series={[{ label: 'Budgeted', values: [500, null, 500] }]} />
    )

    expect(container.querySelectorAll('rect').length).toBe(2)
  })
})
