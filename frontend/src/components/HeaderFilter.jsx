import { useEffect, useRef, useState } from 'react'

// Excel-style column filtering: a `▾` disclosure button in the `<th>` opens
// a small popover beneath it with the actual filter field(s) and its own
// Apply/Clear - reusing the disclosure idiom already established twice in
// this codebase (aria-expanded/aria-controls on the toggle, a sibling
// element for the content - the ledger's own Details row and
// InlineEditRow both do this), rather than inventing a second one.
//
// The popover holds its OWN draft state, seeded from `value` only when it
// opens - not bound directly to the parent's committed filter state. This
// is what lets Apply commit just THIS filter without dragging along
// whatever another, still-open-but-abandoned popover happens to have
// typed into its own field; Escape or clicking outside closes without
// applying, discarding the draft. It's also why there's no per-keystroke
// filtering here - the codebase has no debounce machinery and shouldn't
// grow any for this (see the ledger filters this component replaces),
// and an explicit Apply is the same "commit on an action" convention
// every other form here already follows.
//
// This <th> can OPTIONALLY also be a sort control (sortKey/activeSortKey/
// activeDirection/onSort) - composing what components/SortableHeader.jsx
// does, inline, since a header can only exist once per column. Left out
// entirely (sortKey omitted) for a column that's filterable but not
// meaningfully sortable.
// `as="th"` (the default) is a real table column header, used wherever the
// filter has a matching visible column. `as="div"` renders the identical
// popover - same draft state, same Apply/Clear, same Esc/outside-click -
// as a plain element instead, for the one place a filter needs to exist
// OUTSIDE a <thead> row: TransactionsPage's grouped-by-merchant view, whose
// table has no Date/Account/Narration/Amount/Category columns to hang
// these on. `sortKey` is meaningless there and simply isn't passed.
export default function HeaderFilter({
  label,
  value,
  isActive,
  onApply,
  onClear,
  children,
  sortKey = null,
  activeSortKey = null,
  activeDirection = null,
  onSort = null,
  as = 'th',
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const containerRef = useRef(null)
  const popoverId = `header-filter-${label.toLowerCase().replace(/\s+/g, '-')}`

  const openPopover = () => {
    setDraft(value)
    setOpen(true)
  }

  const closePopover = () => setOpen(false)

  const toggleOpen = () => (open ? closePopover() : openPopover())

  useEffect(() => {
    if (!open) {
      return undefined
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        closePopover()
      }
    }

    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        closePopover()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    // mousedown, not click - fires before the outside element's own click
    // handler, so opening one header's popover reliably closes another's
    // rather than racing it.
    document.addEventListener('mousedown', handleClickOutside)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  const handleSubmit = (event) => {
    event.preventDefault()
    onApply(draft)
    closePopover()
  }

  const handleClear = () => {
    onClear()
    closePopover()
  }

  const isSortable = sortKey !== null
  const sortIsActive = isSortable && sortKey === activeSortKey
  const ariaSort = isSortable ? (sortIsActive ? (activeDirection === 'asc' ? 'ascending' : 'descending') : 'none') : undefined

  const Tag = as
  const tagProps = as === 'th'
    ? { scope: 'col', 'aria-sort': ariaSort }
    : {}

  const className = as === 'th' ? 'header-filter-cell' : 'header-filter-cell header-filter-inline'

  return (
    <Tag className={className} ref={containerRef} {...tagProps}>
      <div className="header-filter-heading">
        {isSortable ? (
          <button type="button" className="sortable-header" onClick={() => onSort(sortKey)}>
            {label}
            {sortIsActive && (
              <span aria-hidden="true" className="sortable-header-arrow">
                {activeDirection === 'asc' ? ' ▲' : ' ▼'}
              </span>
            )}
          </button>
        ) : (
          <span>{label}</span>
        )}
        <button
          type="button"
          className="header-filter-toggle"
          aria-expanded={open}
          aria-controls={popoverId}
          aria-label={`Filter by ${label}`}
          onClick={toggleOpen}
        >
          <span aria-hidden="true">▾</span>
          {isActive && <span className="header-filter-marker" aria-hidden="true" title="Filter active" />}
        </button>
      </div>

      {open && (
        <div id={popoverId} className="header-filter-popover" role="dialog" aria-label={`Filter by ${label}`}>
          <form onSubmit={handleSubmit}>
            {children(draft, setDraft)}
            <div className="header-filter-actions">
              <button type="submit" className="button-primary">Apply</button>
              <button type="button" onClick={handleClear}>Clear</button>
            </div>
          </form>
        </div>
      )}
    </Tag>
  )
}
