// Pagination controls for a paginated list envelope
// ({total, page, page_size, total_pages}).
//
// Always render this, including when the current page has no rows - a page
// that has gone out of range (rows deleted elsewhere, or a stale bookmarked
// URL) is exactly when the user most needs a way back.
export default function Pagination({ pageInfo, onPageChange }) {
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
    </div>
  )
}
