import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import PageHeader from './PageHeader.jsx'

describe('PageHeader', () => {
  it('renders the title as a level-2 heading', () => {
    render(<PageHeader title="Dashboard" />)

    expect(screen.getByRole('heading', { level: 2, name: 'Dashboard' })).toBeInTheDocument()
  })

  it('accepts a dynamic title, not just a string', () => {
    render(<PageHeader title={<>{'Joint Everyday'}</>} />)

    expect(screen.getByRole('heading', { level: 2, name: 'Joint Everyday' })).toBeInTheDocument()
  })

  it('renders no subtitle by default', () => {
    render(<PageHeader title="Dashboard" />)

    expect(document.querySelector('.page-subtitle')).not.toBeInTheDocument()
  })

  it('renders a subtitle when given one', () => {
    render(<PageHeader title="Dashboard" subtitle="September 2026" />)

    expect(screen.getByText('September 2026')).toHaveClass('page-subtitle')
  })

  it('renders no actions slot when given no children', () => {
    render(<PageHeader title="Dashboard" />)

    expect(document.querySelector('.page-header-actions')).not.toBeInTheDocument()
  })

  it('renders children inside the actions slot', () => {
    render(
      <PageHeader title="Dashboard">
        <button type="button">Edit dashboard</button>
      </PageHeader>
    )

    const actions = document.querySelector('.page-header-actions')
    expect(actions).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit dashboard' })).toBeInTheDocument()
  })
})
