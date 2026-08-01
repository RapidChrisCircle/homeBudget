import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Pagination from './Pagination.jsx'
import { PAGE_SIZE_OPTIONS } from './ledgerFilterParams.js'

const pageInfo = { total: 120, page: 2, page_size: 50, total_pages: 3 }

function renderPagination(props = {}) {
  return render(
    <Pagination
      pageInfo={pageInfo}
      onPageChange={() => {}}
      pageSize={50}
      onPageSizeChange={() => {}}
      {...props}
    />
  )
}

describe('Pagination', () => {
  it('offers every configured page size', () => {
    renderPagination()

    const options = Array.from(screen.getByLabelText('Rows per page').options).map((o) => Number(o.value))
    expect(options).toEqual(PAGE_SIZE_OPTIONS)
  })

  it('reflects the current page size', () => {
    renderPagination({ pageSize: 100 })

    expect(screen.getByLabelText('Rows per page')).toHaveValue('100')
  })

  it('fires onPageSizeChange with the chosen size as a number', () => {
    const onPageSizeChange = vi.fn()
    renderPagination({ onPageSizeChange })

    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '20' } })

    expect(onPageSizeChange).toHaveBeenCalledWith(20)
  })

  it('disables Previous on the first page and Next on the last', () => {
    renderPagination({ pageInfo: { total: 3, page: 1, page_size: 50, total_pages: 1 } })

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })
})
