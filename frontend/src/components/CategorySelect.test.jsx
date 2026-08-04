import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CategorySelect from './CategorySelect.jsx'

const groupedCategories = [
  { id: 1, name: 'Housing', parent_id: null },
  { id: 2, name: 'Rent', parent_id: 1 },
  { id: 3, name: 'Council Rates', parent_id: 1 },
  { id: 4, name: 'Fuel', parent_id: null },
]

function renderSelect(props = {}) {
  const onChange = vi.fn()
  const utils = render(
    <CategorySelect categories={groupedCategories} value="" onChange={onChange} aria-label="Category" {...props} />
  )
  return { ...utils, onChange }
}

describe('CategorySelect', () => {
  it('renders children grouped under their parent as an optgroup', () => {
    renderSelect()

    const select = screen.getByLabelText('Category')
    const group = select.querySelector('optgroup[label="Housing"]')
    expect(group).not.toBeNull()

    const groupOptionNames = Array.from(group.querySelectorAll('option')).map((o) => o.textContent)
    expect(groupOptionNames).toEqual(['Rent', 'Council Rates'])
  })

  it('lists a plain top-level category outside any optgroup', () => {
    renderSelect()

    const select = screen.getByLabelText('Category')
    // A direct child <option> of the <select> itself, not inside any optgroup.
    const topLevelOption = Array.from(select.children).find(
      (node) => node.tagName === 'OPTION' && node.textContent === 'Fuel'
    )
    expect(topLevelOption).toBeTruthy()
  })

  it('never renders a parent category as a selectable option', () => {
    renderSelect()

    const select = screen.getByLabelText('Category')
    // "Housing" (the parent) must appear only as the optgroup's label, never
    // as an <option> value a user could actually pick.
    const housingOption = Array.from(select.querySelectorAll('option')).find(
      (o) => o.textContent === 'Housing'
    )
    expect(housingOption).toBeUndefined()
    expect(select.querySelector('optgroup[label="Housing"]')).not.toBeNull()
  })

  it('renders caller-supplied leading options before the categories', () => {
    render(
      <CategorySelect categories={groupedCategories} value="" onChange={() => {}} aria-label="Category">
        <option value="">Uncategorized</option>
      </CategorySelect>
    )

    const options = Array.from(screen.getByLabelText('Category').options).map((o) => o.textContent)
    expect(options[0]).toBe('Uncategorized')
  })

  it('shows an archived-but-currently-selected category via fallbackOption', () => {
    // "Old Category" (id 99) is absent from `categories` - as an archived
    // category would be, since GET /categories excludes archived by
    // default - but the transaction/split/rule still points at it.
    renderSelect({ value: '99', fallbackOption: { id: 99, name: 'Old Category' } })

    expect(screen.getByText('Old Category (archived)')).toBeInTheDocument()
    expect(screen.getByLabelText('Category')).toHaveValue('99')
  })

  it('does not show the fallback option when the selected category is present normally', () => {
    renderSelect({ value: '4', fallbackOption: { id: 99, name: 'Old Category' } })

    expect(screen.queryByText('Old Category (archived)')).not.toBeInTheDocument()
  })

  it('does not show the fallback option when it is not the current value', () => {
    renderSelect({ value: '', fallbackOption: { id: 99, name: 'Old Category' } })

    expect(screen.queryByText('Old Category (archived)')).not.toBeInTheDocument()
  })
})
