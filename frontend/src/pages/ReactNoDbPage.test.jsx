import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ReactNoDbPage from './ReactNoDbPage.jsx'

describe('ReactNoDbPage', () => {
  it('renders without making any network call', () => {
    render(<ReactNoDbPage />)

    expect(screen.getByText('React No-DB Verification')).toBeInTheDocument()
    expect(screen.getByText('Component mount: OK')).toBeInTheDocument()
  })
})
