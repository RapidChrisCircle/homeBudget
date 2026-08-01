import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import LineChart from './LineChart.jsx'

const periods = ['2026-01', '2026-02', '2026-03']

describe('LineChart', () => {
  it('renders a point per datum, with hover text via <title>', () => {
    const { container } = render(
      <LineChart periods={periods} series={[{ label: 'Groceries', values: [100, 120, 90] }]} />
    )

    expect(container.querySelectorAll('circle')).toHaveLength(3)
    expect(screen.getByText('Groceries — 2026-02: 120')).toBeInTheDocument()
  })

  it('renders multiple series side by side with a legend', () => {
    const { container } = render(
      <LineChart
        periods={periods}
        series={[
          { label: 'Groceries', values: [100, 120, 90] },
          { label: 'Fuel', values: [50, 55, 60] },
        ]}
      />
    )

    expect(container.querySelectorAll('path')).toHaveLength(2)
    expect(screen.getByText('Groceries')).toBeInTheDocument()
    expect(screen.getByText('Fuel')).toBeInTheDocument()
  })

  it('does not render a legend for a single series', () => {
    render(<LineChart periods={periods} series={[{ label: 'Balance', values: [100, 120, 90] }]} />)

    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('breaks the line rather than drawing through a null gap', () => {
    const { container } = render(
      <LineChart periods={periods} series={[{ label: 'Balance', values: [100, null, 90] }]} />
    )

    // Two points plotted (the gap month draws no circle), and the path has
    // two separate "move to" commands rather than one continuous line.
    expect(container.querySelectorAll('circle')).toHaveLength(2)
    const path = container.querySelector('path').getAttribute('d')
    expect(path.match(/M/g)).toHaveLength(2)
  })

  it('renders "not enough data yet" when every value is missing', () => {
    render(<LineChart periods={periods} series={[{ label: 'Balance', values: [null, null, null] }]} />)

    expect(screen.getByText('Not enough data yet.')).toBeInTheDocument()
  })

  it('renders "not enough data yet" when there are no periods at all', () => {
    render(<LineChart periods={[]} series={[]} />)

    expect(screen.getByText('Not enough data yet.')).toBeInTheDocument()
  })

  it('draws a zero baseline only when the domain spans zero', () => {
    const { container: spanning } = render(
      <LineChart periods={periods} series={[{ label: 'Net', values: [-50, 10, 30] }]} />
    )
    const spanningLines = spanning.querySelectorAll('line[stroke="#9ca3af"]')
    expect(spanningLines.length).toBe(1)

    const { container: allPositive } = render(
      <LineChart periods={periods} series={[{ label: 'Balance', values: [1000, 1200, 1100] }]} />
    )
    const positiveLines = allPositive.querySelectorAll('line[stroke="#9ca3af"]')
    expect(positiveLines.length).toBe(0)
  })
})
