import { PAGE_SIZE_OPTIONS } from './ledgerFilterParams.js'

// Pagination controls for a paginated list envelope
// ({total, page, page_size, total_pages}), plus a rows-per-page selector.
//
// Always render this, including when the current page has no rows - a page
// that has gone out of range (rows deleted elsewhere, or a stale bookmarked
// URL) is exactly when the user most needs a way back.
//
// `pageSize` is passed separately from `pageInfo` rather than read off
// `pageInfo.page_size` - it needs to reflect the URL immediately (see
// ledgerFilterParams.pageSizeFromSearchParams), not lag a render behind
// waiting on the next API response to confirm it.
export default function Pagination({ pageInfo, onPageChange, pageSize, onPageSizeChange }) {
  return (
    <div className="pagination">
      <button
        type="button"
        onClick={() => onPageChange(pageInfo.page - 1)}
        disabled={pageInfo.page <= 1}
      >
        Previous
      </button>
      <span>
        {' '}Page {pageInfo.page} of {pageInfo.total_pages} ({pageInfo.total} total){' '}
      </span>
      <button
        type="button"
        onClick={() => onPageChange(pageInfo.page + 1)}
        disabled={pageInfo.page >= pageInfo.total_pages}
      >
        Next
      </button>
      <label className="page-size-select">
        Rows per page
        <select value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))}>
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>{size}</option>
          ))}
        </select>
      </label>
    </div>
  )
}
