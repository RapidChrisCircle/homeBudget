import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Amount from './Amount.jsx'

describe('Amount', () => {
  it('formats to two decimal places', () => {
    render(<Amount value="45" />)

    expect(screen.getByText('45.00')).toBeInTheDocument()
  })

  it('renders an empty string for null', () => {
    const { container } = render(<Amount value={null} />)

    expect(container.querySelector('.amount')).toHaveTextContent('')
  })

  it('marks a negative value with the negative class', () => {
    render(<Amount value="-45.00" />)

    expect(screen.getByText('-45.00')).toHaveClass('amount-negative')
  })

  it('marks a positive value with the positive class', () => {
    render(<Amount value="45.00" />)

    expect(screen.getByText('45.00')).toHaveClass('amount-positive')
  })

  it('applies no sign class when neutral is set', () => {
    render(<Amount value="45.00" neutral />)

    const el = screen.getByText('45.00')
    expect(el).not.toHaveClass('amount-positive')
    expect(el).not.toHaveClass('amount-negative')
  })

  it('applies no sign class to a zero value', () => {
    render(<Amount value="0.00" />)

    const el = screen.getByText('0.00')
    expect(el).not.toHaveClass('amount-positive')
    expect(el).not.toHaveClass('amount-negative')
  })

  it('renders the tabular-nums class for column alignment', () => {
    render(<Amount value="45.00" />)

    expect(screen.getByText('45.00')).toHaveClass('amount')
  })
})
