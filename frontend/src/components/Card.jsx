import { useState } from 'react'

const STORAGE_PREFIX = 'homebudget:card:'
const HEADING_TAGS = { 2: 'h2', 3: 'h3', 4: 'h4' }

// localStorage can throw (private browsing, disabled storage, a full quota)
// - a card just not remembering its state across a reload is a far better
// failure than a crash on every toggle. Returns null (rather than a
// default) when nothing is stored, so the caller's own defaultOpen can win.
function readPersisted(id) {
  try {
    const value = localStorage.getItem(STORAGE_PREFIX + id)
    if (value === 'open') return true
    if (value === 'closed') return false
    return null
  } catch {
    return null
  }
}

function persist(id, open) {
  try {
    localStorage.setItem(STORAGE_PREFIX + id, open ? 'open' : 'closed')
  } catch {
    // See readPersisted.
  }
}

// A collapsible nested card. Wraps every page's `<div className="card">`
// content sections (NOT the outer page `<section className="page">` a page
// itself lives in - that one stays fixed, since collapsing a whole page
// reads as a broken page rather than a tidied one).
//
// `id` is an explicit, required prop rather than derived from `title` -
// several titles interpolate data (e.g. Dashboard's "Summary — {month}"),
// and a title-derived storage key would silently orphan itself every time
// that data changes, quietly losing the user's collapsed/open choice.
//
// Defaults to OPEN and collapsed content is unmounted (not just hidden) -
// together these are what keep every existing test that asserts on a
// card's contents passing unchanged, since nothing about adopting Card
// removes anything from the DOM by default.
export default function Card({ id, title, level = 3, defaultOpen = true, className = '', children }) {
  const [open, setOpen] = useState(() => {
    const persisted = readPersisted(id)
    return persisted === null ? defaultOpen : persisted
  })

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev
      persist(id, next)
      return next
    })
  }

  const Heading = HEADING_TAGS[level] || 'h3'

  return (
    <div className={className ? `card ${className}` : 'card'}>
      <Heading className="card-heading">
        <button type="button" className="card-toggle" onClick={toggle} aria-expanded={open}>
          <span className="card-toggle-icon" aria-hidden="true">{open ? '▾' : '▸'}</span>
          {title}
        </button>
      </Heading>
      {open && <div className="card-body">{children}</div>}
    </div>
  )
}
