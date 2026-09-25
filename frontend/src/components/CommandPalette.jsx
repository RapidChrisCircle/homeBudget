import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { pages } from '../pageRegistry.jsx'
import { api } from '../services/api'

const MAX_RESULTS_PER_GROUP = 6
// Matches HeaderFilter's own reasoning for not filtering per keystroke -
// this app has no per-keystroke debounce machinery elsewhere, and a
// command palette firing a network request on every character typed would
// be the first of it. Short enough that it still feels instant.
const MERCHANT_SEARCH_DEBOUNCE_MS = 200
const MIN_MERCHANT_SEARCH_LENGTH = 2

// Global search / command palette - the ONE UI element in this app that
// exists purely for keyboard users, so unlike everything else here it has
// no pointer-only path to reach it at all: Ctrl+K/Cmd+K opens it from
// ANY page, Escape or clicking outside closes it, arrow keys move the
// selection, and Enter activates it. Mounted once in App.jsx, outside the
// routed <Routes> tree, so it survives navigation instead of remounting
// (and losing its lazily-fetched categories/accounts) every time the
// route changes.
//
// Categories and accounts are fetched once, lazily, the first time the
// palette is opened - not eagerly on every page load, which would add two
// requests to every single page view for a feature most sessions never
// open. Merchants are the one thing genuinely not already fetchable in
// one shot (there is no "list every merchant" endpoint, only the
// filtered/grouped ledger), so they're searched live, debounced, through
// the same GET /transactions/groups the ledger's own Group by merchant
// view already uses.
export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [categories, setCategories] = useState(null)
  const [accounts, setAccounts] = useState(null)
  const [merchants, setMerchants] = useState([])
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef(null)
  const navigate = useNavigate()
  const listboxId = useId()

  useEffect(() => {
    function handleGlobalKeyDown(event) {
      const key = event.key.toLowerCase()

      if ((event.metaKey || event.ctrlKey) && key === 'k') {
        event.preventDefault()
        setOpen((prev) => !prev)
      } else if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('keydown', handleGlobalKeyDown)
    return () => document.removeEventListener('keydown', handleGlobalKeyDown)
  }, [])

  useEffect(() => {
    if (!open) {
      return
    }

    setQuery('')
    setActiveIndex(0)
    // Deferred a tick past the open-triggering render so the input already
    // exists in the DOM (this effect's own render is what mounts it).
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 0)

    if (categories === null) {
      api.get('/categories').then((response) => setCategories(response.data)).catch(() => setCategories([]))
    }
    if (accounts === null) {
      api.get('/accounts').then((response) => setAccounts(response.data)).catch(() => setAccounts([]))
    }

    return () => clearTimeout(focusTimer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    const trimmed = query.trim()

    if (!open || trimmed.length < MIN_MERCHANT_SEARCH_LENGTH) {
      setMerchants([])
      return
    }

    let cancelled = false
    const timer = setTimeout(() => {
      api.get(`/transactions/groups?search=${encodeURIComponent(trimmed)}`)
        .then((response) => {
          if (!cancelled) {
            setMerchants(response.data.groups.slice(0, MAX_RESULTS_PER_GROUP))
          }
        })
        .catch(() => {
          if (!cancelled) {
            setMerchants([])
          }
        })
    }, MERCHANT_SEARCH_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, query])

  const groups = useMemo(() => {
    const term = query.trim().toLowerCase()

    if (!term) {
      return []
    }

    const found = []

    const matchedPages = pages
      .filter((page) => !page.hidden && page.label.toLowerCase().includes(term))
      .map((page) => ({ key: `page-${page.path}`, label: page.label, onSelect: () => navigate(page.path) }))

    if (matchedPages.length > 0) {
      found.push({ label: 'Pages', items: matchedPages })
    }

    const matchedCategories = (categories || [])
      .filter((category) => category.name.toLowerCase().includes(term))
      .slice(0, MAX_RESULTS_PER_GROUP)
      .map((category) => ({
        key: `category-${category.id}`,
        label: category.name,
        onSelect: () => navigate(`/transactions?category_id=${category.id}`),
      }))

    if (matchedCategories.length > 0) {
      found.push({ label: 'Categories', items: matchedCategories })
    }

    const matchedAccounts = (accounts || [])
      .filter((account) => account.name.toLowerCase().includes(term))
      .slice(0, MAX_RESULTS_PER_GROUP)
      .map((account) => ({
        key: `account-${account.id}`,
        label: account.name,
        onSelect: () => navigate(`/accounts/${account.id}`),
      }))

    if (matchedAccounts.length > 0) {
      found.push({ label: 'Accounts', items: matchedAccounts })
    }

    if (merchants.length > 0) {
      found.push({
        label: 'Merchants',
        items: merchants.map((merchant) => ({
          key: `merchant-${merchant.narration_key}`,
          label: merchant.merchant,
          onSelect: () => navigate(`/transactions?search=${encodeURIComponent(merchant.merchant)}`),
        })),
      })
    }

    return found
  }, [query, categories, accounts, merchants, navigate])

  const flatItems = useMemo(() => groups.flatMap((group) => group.items), [groups])

  useEffect(() => {
    setActiveIndex(0)
  }, [flatItems.length])

  if (!open) {
    return null
  }

  const activate = (item) => {
    item.onSelect()
    setOpen(false)
  }

  const handleInputKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => Math.min(index + 1, flatItems.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const item = flatItems[activeIndex]
      if (item) {
        activate(item)
      }
    }
  }

  const hasSearched = query.trim().length > 0
  const activeItem = flatItems[activeIndex]
  let renderedIndex = -1

  return (
    <div className="command-palette-overlay" onClick={() => setOpen(false)}>
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          className="command-palette-input"
          role="combobox"
          aria-expanded={flatItems.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeItem ? activeItem.key : undefined}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="Search pages, categories, accounts, merchants..."
        />

        {hasSearched && flatItems.length === 0 && <p className="command-palette-empty">No matches.</p>}

        <div id={listboxId} role="listbox" aria-label="Search results" className="command-palette-results">
          {groups.map((group) => (
            <div key={group.label} role="group" aria-label={group.label} className="command-palette-group">
              <p className="command-palette-group-label" aria-hidden="true">{group.label}</p>
              {group.items.map((item) => {
                renderedIndex += 1
                const isActive = renderedIndex === activeIndex

                return (
                  <button
                    key={item.key}
                    id={item.key}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    className={isActive ? 'command-palette-item active' : 'command-palette-item'}
                    onMouseEnter={() => setActiveIndex(renderedIndex)}
                    onClick={() => activate(item)}
                  >
                    {item.label}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
