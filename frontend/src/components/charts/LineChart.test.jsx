import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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

  it('shows a shared tooltip on hover and hides it on mouseleave', () => {
    const { container } = render(
      <LineChart periods={periods} series={[{ label: 'Groceries', values: [100, 120, 90] }]} />
    )

    const point = container.querySelectorAll('circle')[1]
    fireEvent.mouseEnter(point)

    expect(container.querySelector('.chart-tooltip')).toHaveTextContent('Groceries — 2026-02: 120')

    fireEvent.mouseLeave(point)

    expect(container.querySelector('.chart-tooltip')).not.toBeInTheDocument()
  })

  it('shows the tooltip on keyboard focus for a clickable point, not just hover', () => {
    const { container } = render(
      <LineChart
        periods={periods}
        series={[{ label: 'Groceries', values: [100, 120, 90] }]}
        onSelectPoint={vi.fn()}
      />
    )

    const point = container.querySelectorAll('circle')[0]
    fireEvent.focus(point)

    expect(container.querySelector('.chart-tooltip')).toHaveTextContent('Groceries — 2026-01: 100')

    fireEvent.blur(point)

    expect(container.querySelector('.chart-tooltip')).not.toBeInTheDocument()
  })

  it('renders no tooltip element at all until something is hovered or focused', () => {
    const { container } = render(
      <LineChart periods={periods} series={[{ label: 'Groceries', values: [100, 120, 90] }]} />
    )

    expect(container.querySelector('.chart-tooltip')).not.toBeInTheDocument()
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

  it('renders a muted series as a dashed, text-muted line rather than a categorical hue', () => {
    const { container } = render(
      <LineChart
        periods={periods}
        series={[
          { label: 'This month', values: [100, 120, 90] },
          { label: 'Last month', values: [90, 100, 80], muted: true },
        ]}
      />
    )

    const paths = container.querySelectorAll('path')
    expect(paths[0]).toHaveAttribute('stroke', 'var(--series-1)')
    expect(paths[0]).not.toHaveAttribute('stroke-dasharray')
    expect(paths[1]).toHaveAttribute('stroke', 'var(--text-muted)')
    expect(paths[1]).toHaveAttribute('stroke-dasharray', '4 3')
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
    const spanningLines = spanning.querySelectorAll('line[stroke="var(--border-strong)"]')
    expect(spanningLines.length).toBe(1)

    const { container: allPositive } = render(
      <LineChart periods={periods} series={[{ label: 'Balance', values: [1000, 1200, 1100] }]} />
    )
    const positiveLines = allPositive.querySelectorAll('line[stroke="var(--border-strong)"]')
    expect(positiveLines.length).toBe(0)
  })

  describe('drill-down', () => {
    const series = [
      { label: 'Groceries', values: [100, 120, 90] },
      { label: 'Other', values: [10, 10, 10], selectable: false },
    ]

    it('is entirely absent unless the caller asks for it', () => {
      render(<LineChart periods={periods} series={series} />)

      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('reports which series and period a clicked point belongs to', () => {
      const onSelectPoint = vi.fn()
      render(<LineChart periods={periods} series={series} onSelectPoint={onSelectPoint} />)

      fireEvent.click(screen.getByRole('button', { name: 'Groceries — 2026-02: 120' }))

      expect(onSelectPoint).toHaveBeenCalledWith(expect.objectContaining({
        periodIndex: 1,
        period: '2026-02',
        seriesIndex: 0,
        value: 120,
      }))
    })

    it('activates a point from the keyboard, not just the mouse', () => {
      const onSelectPoint = vi.fn()
      render(<LineChart periods={periods} series={series} onSelectPoint={onSelectPoint} />)

      fireEvent.keyDown(screen.getByRole('button', { name: 'Groceries — 2026-01: 100' }), { key: 'Enter' })

      expect(onSelectPoint).toHaveBeenCalledTimes(1)
    })

    it('makes legend entries buttons when a series can be selected', () => {
      const onSelectSeries = vi.fn()
      render(<LineChart periods={periods} series={series} onSelectSeries={onSelectSeries} />)

      fireEvent.click(screen.getByRole('button', { name: 'Groceries' }))

      expect(onSelectSeries).toHaveBeenCalledWith(expect.objectContaining({ seriesIndex: 0 }))
    })

    it('offers no affordance on a series that opts out', () => {
      render(
        <LineChart
          periods={periods}
          series={series}
          onSelectPoint={vi.fn()}
          onSelectSeries={vi.fn()}
        />
      )

      expect(screen.queryByRole('button', { name: 'Other' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Other — / })).not.toBeInTheDocument()
    })
  })
})
