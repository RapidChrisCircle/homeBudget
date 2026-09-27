import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Amount from '../components/Amount.jsx'
import EmptyState from '../components/EmptyState.jsx'
import ErrorState from '../components/ErrorState.jsx'
import LoadingState from '../components/LoadingState.jsx'
import PageHeader from '../components/PageHeader.jsx'
import { api } from '../services/api'
import { showToast } from '../services/toast'
import { categoryPathLabel, groupByParent } from '../utils/categories.js'
import { formatDate } from '../utils/format.js'

const MAX_VISIBLE_CATEGORIES = 8

// A one-at-a-time, keyboard-driven queue over the SAME uncategorised
// merchant groups the ledger's own Group by merchant view already shows
// (GET /transactions/groups, GET /transactions/bulk-category) - this adds
// no new backend endpoint. What's actually new here: largest-first
// ordering, one merchant in focus at a time, a keyboard-only path through
// the whole queue, an undo stack, and a progress readout. It is
// deliberately a SEPARATE, hidden route (pageRegistry.jsx) rather than a
// `?review=1` param on the ledger itself - applying any ledger filter
// rebuilds the URL's search params from scratch (see
// ledgerFilterParams.searchParamsFromFilters), which would silently drop
// a param like that the moment a filter changed.
export default function TriageQueuePage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [categories, setCategories] = useState([])

  // The queue itself: uncategorised merchant groups, largest-first,
  // shrinking by one each time a merchant is assigned. `index` is a cursor
  // INTO this array, not a separate merchant id - removing the current
  // entry naturally leaves `index` pointing at the next one.
  const [queue, setQueue] = useState([])
  const [index, setIndex] = useState(0)

  // {group, previousLength} so undo can restore both the group and its
  // place in the queue - see handleUndo below. Bounded to the session,
  // like the ledger's own note/category edits have no undo further back
  // than this either.
  const [undoStack, setUndoStack] = useState([])

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [alsoCreateRule, setAlsoCreateRule] = useState(false)
  const [assigning, setAssigning] = useState(false)

  const containerRef = useRef(null)
  const inputRef = useRef(null)
  const listboxId = useId()

  useEffect(() => {
    let cancelled = false

    Promise.all([api.get('/transactions/groups'), api.get('/categories')])
      .then(([groupsRes, categoriesRes]) => {
        if (cancelled) {
          return
        }
        const sorted = [...groupsRes.data.groups].sort((a, b) => b.transaction_count - a.transaction_count)
        setQueue(sorted)
        setCategories(categoriesRes.data)
        // Keyboard-first - the whole point of this page is a mouse-free
        // path through the queue, so it starts with focus already on it.
        containerRef.current?.focus()
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err?.response?.data?.detail || err?.message || 'Unknown error'))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const current = queue[index]

  // Assignable categories only - a parent category is grouping only and is
  // never itself assignable (see backend's Category.parent_id docstring;
  // CategorySelect.jsx makes the identical exclusion via an inert
  // <optgroup> label instead, since this is a custom combobox, not a
  // native <select>, and has to do the filtering itself).
  const assignableCategories = useMemo(() => {
    const { parentless, groups } = groupByParent(categories)
    return [...parentless, ...groups.flatMap((g) => g.children)]
  }, [categories])

  const filteredCategories = useMemo(() => {
    const term = query.trim().toLowerCase()
    const pool = term
      ? assignableCategories.filter((c) => categoryPathLabel(c).toLowerCase().includes(term))
      : assignableCategories
    return pool.slice(0, MAX_VISIBLE_CATEGORIES)
  }, [assignableCategories, query])

  useEffect(() => {
    setActiveIndex(0)
  }, [query, index])

  const goToNext = () => setIndex((i) => Math.min(i + 1, Math.max(queue.length - 1, 0)))
  const goToPrevious = () => setIndex((i) => Math.max(i - 1, 0))

  const assignCurrent = async (categoryId) => {
    if (!current || assigning) {
      return
    }

    setAssigning(true)
    setActionError('')

    try {
      await api.post('/transactions/bulk-category', {
        transaction_ids: current.transaction_ids,
        category_id: categoryId,
      })

      if (alsoCreateRule) {
        // Best-effort - a duplicate or otherwise-rejected rule must not
        // block progress through the queue, which is the whole point of
        // this page. Mirrors RuleEditor.jsx's own prefill convention:
        // merchant_label (here, group.merchant) over the raw narration.
        try {
          await api.post('/category-rules', {
            narration_pattern: current.merchant || current.sample_narration,
            category_id: categoryId,
          })
        } catch {
          // Swallowed deliberately - see comment above.
        }
      }

      setUndoStack((stack) => [...stack, { group: current, atIndex: index }])
      setQueue((q) => {
        const next = q.filter((g) => g.narration_key !== current.narration_key)
        setIndex((i) => Math.min(i, Math.max(next.length - 1, 0)))
        return next
      })
      setQuery('')
      setAlsoCreateRule(false)
      showToast(`Categorised ${current.transaction_count} transaction(s) from ${current.merchant}.`)
      inputRef.current?.focus()
    } catch (err) {
      setActionError(String(err?.response?.data?.detail || err?.message || 'Unknown error'))
    } finally {
      setAssigning(false)
    }
  }

  const handleUndo = async () => {
    const last = undoStack[undoStack.length - 1]
    if (!last || assigning) {
      return
    }

    setAssigning(true)
    setActionError('')

    try {
      // Exact only because every group in this queue is uncategorised by
      // construction (GET /transactions/groups defaults to
      // include_categorized=false) - re-nulling is always the correct
      // undo here. This does NOT revert an "also create a rule" side
      // effect from the same assignment, if one was made.
      await api.post('/transactions/bulk-category', {
        transaction_ids: last.group.transaction_ids,
        category_id: null,
      })

      setUndoStack((stack) => stack.slice(0, -1))
      setQueue((q) => {
        const next = [...q]
        next.splice(Math.min(last.atIndex, next.length), 0, last.group)
        return next
      })
      setIndex(Math.min(last.atIndex, queue.length))
      showToast(`Undid ${last.group.merchant}.`)
    } catch (err) {
      setActionError(String(err?.response?.data?.detail || err?.message || 'Unknown error'))
    } finally {
      setAssigning(false)
    }
  }

  // Bound to the QUEUE CONTAINER, never document - every other document-
  // level key handler in this app is Escape-only (HeaderFilter, the modal
  // editors); a bare j/k/u on document would fire while typing into the
  // ledger's own note field, a filter popover, or the command palette's
  // input, none of which have any way to tell this page it's open. Only
  // fires while the container itself (not the category input) has focus.
  const handleContainerKeyDown = (event) => {
    if (event.key === 'j' || event.key === 'ArrowDown') {
      event.preventDefault()
      goToNext()
    } else if (event.key === 'k' || event.key === 'ArrowUp') {
      event.preventDefault()
      goToPrevious()
    } else if (event.key === 'u') {
      event.preventDefault()
      handleUndo()
    } else if (event.key === 'Enter' || event.key === '/') {
      event.preventDefault()
      inputRef.current?.focus()
    }
  }

  // The category combobox itself - the same clamped-activeIndex/Arrow/
  // Enter shape components/CommandPalette.jsx already established,
  // reused deliberately rather than a second hand-rolled version.
  const handleInputKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, filteredCategories.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const category = filteredCategories[activeIndex]
      if (category) {
        assignCurrent(category.id)
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setQuery('')
      containerRef.current?.focus()
    }
  }

  if (loading) {
    return (
      <section className="page">
        <PageHeader title="Review Uncategorised Transactions" />
        <LoadingState message="Loading uncategorised transactions..." rows={4} />
      </section>
    )
  }

  if (error) {
    return (
      <section className="page">
        <PageHeader title="Review Uncategorised Transactions" />
        <ErrorState label="Failed to load:" message={error} />
      </section>
    )
  }

  const totalRemaining = queue.reduce((sum, g) => sum + g.transaction_count, 0)
  const activeCategory = filteredCategories[activeIndex]
  const signedTotal = current
    ? (current.direction === 'outflow' ? -Number(current.total_amount) : Number(current.total_amount))
    : 0

  return (
    <section className="page">
      <PageHeader title="Review Uncategorised Transactions" />
      <p>
        One merchant at a time, largest first. <kbd>j</kbd>/<kbd>k</kbd> to move,{' '}
        <kbd>Enter</kbd> to search categories, <kbd>u</kbd> to undo.{' '}
        <Link to="/transactions">Back to the ledger</Link>
      </p>

      {actionError && <ErrorState label="Action failed:" message={actionError} />}

      {queue.length === 0 && <EmptyState message="Nothing left to review - every merchant has a category." />}

      {current && (
        <div
          ref={containerRef}
          className="triage-queue"
          tabIndex={-1}
          onKeyDown={handleContainerKeyDown}
        >
          <div className="triage-progress" aria-live="polite">
            {queue.length} merchant{queue.length === 1 ? '' : 's'} · {totalRemaining} transaction{totalRemaining === 1 ? '' : 's'} left
          </div>

          <div className="triage-current">
            <h3>{current.merchant}</h3>
            <p>
              {current.transaction_count} transaction{current.transaction_count === 1 ? '' : 's'} ·{' '}
              <Amount value={signedTotal} /> · {formatDate(current.first_date)}–{formatDate(current.last_date)}
            </p>
            <p className="text-muted">{current.sample_narration}</p>
            <p className="text-muted">Accounts: {current.account_names.join(', ')}</p>
          </div>

          <div className="triage-assign">
            <label>
              Category
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded={filteredCategories.length > 0}
                aria-controls={listboxId}
                aria-autocomplete="list"
                aria-activedescendant={activeCategory ? `triage-category-${activeCategory.id}` : undefined}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Type to search categories..."
                disabled={assigning}
              />
            </label>

            <div id={listboxId} role="listbox" aria-label="Categories" className="triage-category-list">
              {filteredCategories.map((category, i) => (
                <button
                  key={category.id}
                  id={`triage-category-${category.id}`}
                  type="button"
                  role="option"
                  aria-selected={i === activeIndex}
                  className={i === activeIndex ? 'triage-category-option active' : 'triage-category-option'}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => assignCurrent(category.id)}
                  disabled={assigning}
                >
                  {categoryPathLabel(category)}
                </button>
              ))}
              {filteredCategories.length === 0 && <p className="triage-category-empty">No matching categories.</p>}
            </div>

            <label className="triage-also-rule">
              <input
                type="checkbox"
                checked={alsoCreateRule}
                onChange={(event) => setAlsoCreateRule(event.target.checked)}
              />
              {' '}Also create a rule from this merchant
            </label>
          </div>

          <div className="triage-controls">
            <button type="button" onClick={goToPrevious} disabled={index === 0}>
              <kbd>k</kbd> Previous
            </button>
            <button type="button" onClick={goToNext} disabled={index >= queue.length - 1}>
              <kbd>j</kbd> Next
            </button>
            <button type="button" onClick={handleUndo} disabled={undoStack.length === 0 || assigning}>
              <kbd>u</kbd> Undo
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
