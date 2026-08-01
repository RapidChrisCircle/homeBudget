import { useEffect, useState } from 'react'
import Amount from './Amount.jsx'
import Badge from './Badge.jsx'
import CategoryQuickAdd from './CategoryQuickAdd.jsx'
import EmptyState from './EmptyState.jsx'
import ErrorState from './ErrorState.jsx'
import LoadingState from './LoadingState.jsx'
import { api } from '../services/api'

// "Similar Uncategorized" - clears a stack of uncategorized rows as a
// handful of merchant groups instead of one row at a time.
//
// Scoped to the SAME ledger filters the ledger table below is currently
// showing (`groupsQuery`, built by the caller from the URL via
// ledgerFilterParams.groupsQueryFromSearchParams) - so a group's "Categorize
// all N" can never reach a row the caller couldn't already see. This card
// has its own independent loading/error state, the same pattern
// CategoriesPage already uses for its category-CRUD and budgets cards: a
// groups failure never blocks the ledger, and vice versa.
export default function TransactionGroups({ groupsQuery, categories, onCategoryCreated, onAssigned }) {
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  // Keyed on narration_key, not on anything from React - both are cleared
  // for a key once its group is successfully assigned (see handleAssign),
  // so a later, unrelated group that happens to reuse the same key (a new
  // import of the same merchant) never inherits a stale selection.
  const [selections, setSelections] = useState({})
  const [createRule, setCreateRule] = useState({})
  const [assigningKey, setAssigningKey] = useState(null)

  const fetchGroups = async (cancelledRef) => {
    const response = await api.get(`/transactions/groups?${groupsQuery}`)
    if (!cancelledRef?.current) {
      setGroups(response.data.groups)
    }
  }

  useEffect(() => {
    const cancelledRef = { current: false }

    setLoading(true)
    setError('')

    fetchGroups(cancelledRef)
      .catch((err) => {
        if (!cancelledRef.current) {
          const message = err?.response?.data?.detail || err?.message || 'Unknown error'
          setError(String(message))
        }
      })
      .finally(() => {
        if (!cancelledRef.current) {
          setLoading(false)
        }
      })

    return () => {
      cancelledRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupsQuery])

  const selectionFor = (key) => selections[key] ?? ''
  const setSelection = (key, value) => setSelections((prev) => ({ ...prev, [key]: value }))
  const ruleFor = (key) => Boolean(createRule[key])
  const toggleRule = (key) => setCreateRule((prev) => ({ ...prev, [key]: !prev[key] }))

  const forgetGroup = (key) => {
    setSelections((prev) => {
      const { [key]: _discard, ...rest } = prev
      return rest
    })
    setCreateRule((prev) => {
      const { [key]: _discard, ...rest } = prev
      return rest
    })
  }

  const handleAssign = async (group) => {
    const categoryId = selectionFor(group.narration_key)

    if (!categoryId) {
      return
    }

    setActionError('')
    setAssigningKey(group.narration_key)

    try {
      await api.post('/transactions/bulk-category', {
        transaction_ids: group.transaction_ids,
        category_id: Number(categoryId),
      })

      // The new rule is for FUTURE imports, not these rows - bulk-category
      // above already cleared categorized_by_rule_id on them, which is what
      // marks a row as human-categorized and off-limits to rule runs (see
      // services/categorization.py). Assigning first, rule second, matters:
      // reversing the order would have no effect on these particular rows
      // either way, but assign-first is what makes that guarantee obvious.
      if (ruleFor(group.narration_key)) {
        await api.post('/category-rules', {
          narration_pattern: group.merchant,
          category_id: Number(categoryId),
        })
      }

      forgetGroup(group.narration_key)
      await Promise.all([onAssigned(), fetchGroups()])
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Categorize failed'
      setActionError(String(message))
    } finally {
      setAssigningKey(null)
    }
  }

  if (loading) {
    return (
      <div className="card">
        <h3>Similar Uncategorized</h3>
        <LoadingState message="Loading similar transactions..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="card">
        <h3>Similar Uncategorized</h3>
        <ErrorState label="Failed to load similar transactions:" message={error} />
      </div>
    )
  }

  return (
    <div className="card">
      <h3>Similar Uncategorized</h3>

      {actionError && <ErrorState label="Action failed:" message={actionError} />}

      {groups.length === 0 && (
        <EmptyState message="No groups of similar uncategorized transactions in the current view." />
      )}

      {groups.map((group) => (
        <div className="card transaction-group" key={group.narration_key}>
          <div className="transaction-group-header">
            <strong>{group.merchant}</strong>
            <Badge tone="neutral" title={`${group.transaction_count} matching transactions`}>
              {group.transaction_count}
            </Badge>
            <Amount value={group.total_amount} neutral />
            <span className="text-muted">{group.first_date} to {group.last_date}</span>
          </div>
          <p className="text-muted">{group.sample_narration}</p>
          <div className="transaction-group-actions">
            <CategoryQuickAdd
              categories={categories}
              value={selectionFor(group.narration_key)}
              onChange={(value) => setSelection(group.narration_key, value)}
              onCategoryCreated={(category) => {
                onCategoryCreated(category)
                setSelection(group.narration_key, String(category.id))
              }}
              label={`Category for ${group.merchant}`}
              includeUncategorized={false}
            />
            <label>
              <input
                type="checkbox"
                checked={ruleFor(group.narration_key)}
                onChange={() => toggleRule(group.narration_key)}
              />
              {' '}Also create a rule
            </label>
            <button
              type="button"
              className="button-primary"
              onClick={() => handleAssign(group)}
              disabled={!selectionFor(group.narration_key) || assigningKey === group.narration_key}
            >
              Categorize all {group.transaction_count}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
