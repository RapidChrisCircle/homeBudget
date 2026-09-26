import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ToastContainer from './ToastContainer.jsx'
import { _resetToastsForTests, dismissToast, showToast } from '../services/toast.ts'

beforeEach(() => {
  _resetToastsForTests()
})

afterEach(() => {
  _resetToastsForTests()
})

describe('ToastContainer', () => {
  it('renders nothing when there are no toasts', () => {
    const { container } = render(<ToastContainer />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders a toast fired before it was even mounted', () => {
    showToast('Budget saved.', { durationMs: 0 })

    render(<ToastContainer />)

    expect(screen.getByText('Budget saved.')).toBeInTheDocument()
  })

  it('renders a toast fired after mounting', () => {
    render(<ToastContainer />)

    act(() => {
      showToast('Imported 5 transaction(s).', { durationMs: 0 })
    })

    expect(screen.getByText('Imported 5 transaction(s).')).toBeInTheDocument()
  })

  it('applies a tone-specific class', () => {
    showToast('Heads up.', { tone: 'info', durationMs: 0 })

    render(<ToastContainer />)

    expect(screen.getByText('Heads up.').closest('.toast')).toHaveClass('toast-info')
  })

  it('dismisses a toast when its own dismiss button is clicked', () => {
    showToast('Dismiss me', { durationMs: 0 })

    render(<ToastContainer />)
    expect(screen.getByText('Dismiss me')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))

    expect(screen.queryByText('Dismiss me')).not.toBeInTheDocument()
  })

  it('shows more than one toast at once', () => {
    showToast('First', { durationMs: 0 })
    showToast('Second', { durationMs: 0 })

    render(<ToastContainer />)

    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
  })

  it('stops showing a toast dismissed from outside the component', () => {
    const id = showToast('External dismiss', { durationMs: 0 })

    render(<ToastContainer />)
    expect(screen.getByText('External dismiss')).toBeInTheDocument()

    act(() => {
      dismissToast(id)
    })

    expect(screen.queryByText('External dismiss')).not.toBeInTheDocument()
  })
})
