import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import InlineEditRow from './InlineEditRow.jsx'

function renderRow(props = {}) {
  const onSubmit = vi.fn((event) => event.preventDefault())
  const onCancel = vi.fn()
  const utils = render(
    <table>
      <tbody>
        <tr>
          <td colSpan={3}>
            <button
              type="button"
              aria-expanded="true"
              aria-controls="row-editor"
            >
              Edit
            </button>
          </td>
        </tr>
        <InlineEditRow id="row-editor" colSpan={3} onSubmit={onSubmit} onCancel={onCancel} {...props}>
          <label>
            Name
            <input type="text" defaultValue="Test" />
          </label>
        </InlineEditRow>
      </tbody>
    </table>
  )
  return { ...utils, onSubmit, onCancel }
}

describe('InlineEditRow', () => {
  it('renders beneath its row, spanning the full table via colSpan', () => {
    renderRow()

    const row = document.getElementById('row-editor')
    expect(row.tagName).toBe('TR')
    const cell = row.querySelector('td')
    expect(cell).toHaveAttribute('colspan', '3')
  })

  it('the toggle button that controls it carries matching aria-expanded/aria-controls', () => {
    renderRow()

    const toggle = screen.getByRole('button', { name: 'Edit' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAttribute('aria-controls', 'row-editor')
  })

  it('submits via the caller-supplied handler', () => {
    const { onSubmit } = renderRow()

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('cancel discards without submitting', () => {
    const { onSubmit, onCancel } = renderRow()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('disables both actions while saving', () => {
    renderRow({ saving: true })

    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })

  it('uses a custom submit label when given one', () => {
    renderRow({ submitLabel: 'Add Rule' })

    expect(screen.getByRole('button', { name: 'Add Rule' })).toBeInTheDocument()
  })
})
