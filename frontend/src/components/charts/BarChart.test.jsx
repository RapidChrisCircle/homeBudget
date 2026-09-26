import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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

  it('shows a shared tooltip on hover and hides it on mouseleave', () => {
    const { container } = render(
      <BarChart periods={periods} series={[{ label: 'Income', values: [5000, 5200, 4800] }]} />
    )

    const bar = container.querySelectorAll('rect')[1]
    fireEvent.mouseEnter(bar)

    expect(container.querySelector('.chart-tooltip')).toHaveTextContent('Income — 2026-02: 5200')

    fireEvent.mouseLeave(bar)

    expect(container.querySelector('.chart-tooltip')).not.toBeInTheDocument()
  })

  it('shows the tooltip on keyboard focus for a clickable bar, not just hover', () => {
    const { container } = render(
      <BarChart
        periods={periods}
        series={[{ label: 'Income', values: [5000, 5200, 4800] }]}
        onSelectBar={vi.fn()}
      />
    )

    const bar = container.querySelectorAll('rect')[0]
    fireEvent.focus(bar)

    expect(container.querySelector('.chart-tooltip')).toHaveTextContent('Income — 2026-01: 5000')

    fireEvent.blur(bar)

    expect(container.querySelector('.chart-tooltip')).not.toBeInTheDocument()
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
    const zeroLine = container.querySelector('line[stroke="var(--border-strong)"]')
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

  describe('drill-down', () => {
    const series = [
      { label: 'Income', values: [5000, 5200, 4800] },
      { label: 'Spending', values: [3200, 3400, 3100] },
      { label: 'Net saved', values: [1800, 1800, 1700], selectable: false },
    ]

    it('is entirely absent unless the caller asks for it', () => {
      render(<BarChart periods={periods} series={series} />)

      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('reports which series, period and value a clicked bar belongs to', () => {
      const onSelectBar = vi.fn()
      render(<BarChart periods={periods} series={series} onSelectBar={onSelectBar} />)

      fireEvent.click(screen.getByRole('button', { name: 'Income — 2026-02: 5200' }))

      expect(onSelectBar).toHaveBeenCalledWith(expect.objectContaining({
        seriesIndex: 0,
        periodIndex: 1,
        period: '2026-02',
        value: 5200,
      }))
    })

    it('activates a bar from the keyboard, not just the mouse', () => {
      const onSelectBar = vi.fn()
      render(<BarChart periods={periods} series={series} onSelectBar={onSelectBar} />)

      fireEvent.keyDown(screen.getByRole('button', { name: 'Spending — 2026-03: 3100' }), { key: ' ' })

      expect(onSelectBar).toHaveBeenCalledTimes(1)
    })

    it('offers no affordance on a series that opts out', () => {
      render(<BarChart periods={periods} series={series} onSelectBar={vi.fn()} />)

      expect(screen.queryByRole('button', { name: /^Net saved — /})).not.toBeInTheDocument()
    })
  })
})
