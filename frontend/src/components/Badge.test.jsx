import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Badge from './Badge.jsx'

describe('Badge', () => {
  it('renders its children', () => {
    render(<Badge>auto</Badge>)

    expect(screen.getByText('auto')).toBeInTheDocument()
  })

  it('defaults to the neutral tone', () => {
    render(<Badge>auto</Badge>)

    expect(screen.getByText('auto')).toHaveClass('badge-neutral')
  })

  it('applies the requested tone', () => {
    render(<Badge tone="danger">over</Badge>)

    expect(screen.getByText('over')).toHaveClass('badge-danger')
  })

  it('carries an optional title for hover text', () => {
    render(<Badge tone="info" title="Set automatically by a rule">auto</Badge>)

    expect(screen.getByText('auto')).toHaveAttribute('title', 'Set automatically by a rule')
  })
})
