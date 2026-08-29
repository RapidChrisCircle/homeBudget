import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ComparisonSparkline from './ComparisonSparkline.jsx'

const periods = ['1', '2', '3']

describe('ComparisonSparkline', () => {
  it('renders both series, the comparison one muted', () => {
    const { container } = render(
      <ComparisonSparkline
        periods={periods}
        thisMonthValues={[10, 25, 40]}
        comparisonValues={[15, 30, 45]}
        comparisonLabel="Last month"
      />
    )

    expect(screen.getByText('Last month')).toBeInTheDocument()
    const paths = container.querySelectorAll('path')
    expect(paths[1]).toHaveAttribute('stroke-dasharray', '4 3')
  })

  it('shows the delta at the last day both curves have a value for, not the whole-array ends', () => {
    render(
      <ComparisonSparkline
        // Day 3 is still in the future this month (null) - the delta must
        // compare day 2, the last day both sides actually have data for.
        periods={periods}
        thisMonthValues={[10, 25, null]}
        comparisonValues={[15, 30, 45]}
        comparisonLabel="Last month"
      />
    )

    // 25 - 30 = -5 (spending less than the comparison - good).
    expect(screen.getByText('-5.00')).toBeInTheDocument()
  })

  it('colors overspending (a positive delta) as the expense tone, not the income tone', () => {
    render(
      <ComparisonSparkline
        periods={periods}
        thisMonthValues={[20]}
        comparisonValues={[10]}
        comparisonLabel="Last month"
      />
    )

    expect(screen.getByText('+10.00')).toHaveClass('stat-tile-expense')
  })

  it('colors underspending (a negative delta) as the income tone', () => {
    render(
      <ComparisonSparkline
        periods={periods}
        thisMonthValues={[5]}
        comparisonValues={[10]}
        comparisonLabel="Last month"
      />
    )

    expect(screen.getByText('-5.00')).toHaveClass('stat-tile-income')
  })

  it('shows no delta caption when neither curve has an overlapping known value', () => {
    render(
      <ComparisonSparkline
        periods={periods}
        thisMonthValues={[null, null, null]}
        comparisonValues={[null, null, null]}
        comparisonLabel="Last month"
      />
    )

    expect(screen.queryByText(/vs Last month/)).not.toBeInTheDocument()
  })

  it('only the real series is clickable - the comparison line opts out', () => {
    const onSelectPoint = vi.fn()
    render(
      <ComparisonSparkline
        periods={periods}
        thisMonthValues={[10, 25, 40]}
        comparisonValues={[15, 30, 45]}
        comparisonLabel="Last month"
        onSelectPoint={onSelectPoint}
      />
    )

    const thisMonthPoints = screen.getAllByRole('button', { name: /^This month — /})
    expect(thisMonthPoints.length).toBeGreaterThan(0)
    fireEvent.click(thisMonthPoints[0])

    expect(onSelectPoint).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /^Last month — /})).not.toBeInTheDocument()
  })
})
