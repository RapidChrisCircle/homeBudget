import { Fragment, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Amount from '../components/Amount.jsx'
import Card from '../components/Card.jsx'
import CategorySelect from '../components/CategorySelect.jsx'
import ErrorState from '../components/ErrorState.jsx'
import InlineEditRow from '../components/InlineEditRow.jsx'
import LoadingState from '../components/LoadingState.jsx'
import { api } from '../services/api'

const RULES_TABLE_COLUMN_COUNT = 7

const EMPTY_FORM = {
  narration_pattern: '',
  transaction_type: '',
  min_amount: '',
  max_amount: '',
  category_id: '',
}

// Blank optional fields are sent as null, not '' - the backend treats an
// empty criterion as "not set" rather than "must equal empty string".
function buildPayload(form) {
  return {
    narration_pattern: form.narration_pattern,
    transaction_type: form.transaction_type || null,
    min_amount: form.min_amount || null,
    max_amount: form.max_amount || null,
    category_id: form.category_id ? Number(form.category_id) : null,
  }
}

// Findings by kind, in the fixed order they're worth reading: the auto-
// removable ones first (duplicate is the strongest claim - identical in
// every field - subsumed the more general redundant case), shadowed last,
// since it's the one that needs a human decision rather than a click.
const FINDING_KIND_ORDER = ['duplicate', 'subsumed', 'shadowed']
const FINDING_KIND_LABELS = {
  duplicate: 'Duplicate',
  subsumed: 'Subsumed',
  shadowed: 'Shadowed (needs review)',
}
const AUTO_REMOVABLE_KINDS = new Set(['duplicate', 'subsumed'])

export default function RulesPage() {
  const [rules, setRules] = useState([])
  const [categories, setCategories] = useState([])
  const [transactionTypes, setTransactionTypes] = useState([])
  const [findings, setFindings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [applyMessage, setApplyMessage] = useState('')
  const [applying, setApplying] = useState(false)
  const [removingRedundant, setRemovingRedundant] = useState(false)
  const [reviewMessage, setReviewMessage] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()

  const refresh = async () => {
    const [rulesRes, categoriesRes, typesRes, reviewRes] = await Promise.all([
      api.get('/category-rules'),
      api.get('/categories'),
      api.get('/transactions/types'),
      api.get('/category-rules/review'),
    ])
    setRules(rulesRes.data)
    setCategories(categoriesRes.data)
    setTransactionTypes(typesRes.data)
    setFindings(reviewRes.data.findings)
  }

  useEffect(() => {
    let cancelled = false

    setLoading(true)
    setError('')

    refresh()
      .catch((err) => {
        if (!cancelled) {
          const message = err?.response?.data?.detail || err?.message || 'Unknown error'
          setError(String(message))
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

  // Seeded by the "Make rule" button on the ledger. Cleared immediately so a
  // refresh or Cancel doesn't resurrect the prefill.
  useEffect(() => {
    const narration = searchParams.get('narration')
    if (narration) {
      setForm((prev) => ({ ...prev, narration_pattern: narration }))
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const handleFieldChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }))
  }

  const startEdit = (rule) => {
    setEditingId(rule.id)
    setPreview(null)
    setForm({
      narration_pattern: rule.narration_pattern,
      transaction_type: rule.transaction_type || '',
      min_amount: rule.min_amount ?? '',
      max_amount: rule.max_amount ?? '',
      category_id: String(rule.category_id),
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setPreview(null)
    setForm(EMPTY_FORM)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    setActionError('')
    setSaving(true)

    try {
      if (editingId) {
        await api.put(`/category-rules/${editingId}`, buildPayload(form))
      } else {
        await api.post('/category-rules', buildPayload(form))
      }
      cancelEdit()
      await refresh()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Save failed'
      setActionError(String(message))
    } finally {
      setSaving(false)
    }
  }

  const handlePreview = async () => {
    setActionError('')
    setPreviewing(true)
    try {
      const response = await api.post('/category-rules/preview', {
        ...buildPayload(form),
        exclude_rule_id: editingId || null,
      })
      setPreview(response.data)
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Preview failed'
      setActionError(String(message))
    } finally {
      setPreviewing(false)
    }
  }

  const handleApplyRules = async () => {
    setActionError('')
    setApplying(true)
    try {
      const response = await api.post('/category-rules/apply')
      setApplyMessage(`Categorized ${response.data.categorized_count} transaction(s).`)
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Apply rules failed'
      setActionError(String(message))
    } finally {
      setApplying(false)
    }
  }

  const handleMove = async (id, direction) => {
    setActionError('')
    try {
      const response = await api.post(`/category-rules/${id}/move`, { direction })
      setRules(response.data)
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Reorder failed'
      setActionError(String(message))
    }
  }

  // A per-finding removal is always duplicate/subsumed (the review card
  // never offers this button for a shadowed finding) - both are provably
  // no-ops (see services/rule_review.py), so this skips the confirm dialog
  // handleDelete uses for a plain manual delete.
  const handleRemoveFinding = async (ruleId) => {
    setActionError('')
    try {
      await api.delete(`/category-rules/${ruleId}`)
      if (editingId === ruleId) {
        cancelEdit()
      }
      await refresh()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Remove failed'
      setActionError(String(message))
    }
  }

  const handleRemoveRedundant = async () => {
    setActionError('')
    setReviewMessage('')
    setRemovingRedundant(true)
    try {
      const response = await api.post('/category-rules/review/remove-redundant')
      setReviewMessage(`Removed ${response.data.removed_count} redundant rule(s).`)
      await refresh()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Remove failed'
      setActionError(String(message))
    } finally {
      setRemovingRedundant(false)
    }
  }

  const handleDelete = async (id) => {
    const confirmed = window.confirm(
      'Delete this rule? Transactions it categorized keep their category but will no longer be updated by rules.'
    )
    if (!confirmed) {
      return
    }
    setActionError('')
    try {
      await api.delete(`/category-rules/${id}`)
      if (editingId === id) {
        cancelEdit()
      }
      await refresh()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Delete failed'
      setActionError(String(message))
    }
  }

  // Include the rule's current type even if no transaction of that type
  // exists any more (e.g. edited after the underlying rows were deleted),
  // so editing never silently blanks out a saved value.
  const typeOptions = Array.from(new Set([...transactionTypes, form.transaction_type].filter(Boolean)))

  // The rule being edited may target a category that's since been
  // archived (GET /categories excludes archived by default), in which
  // case it won't be in `categories` at all - read straight from `rules`
  // (which already carries category_name) rather than adding separate
  // state just to remember it across the edit.
  const editingRule = editingId != null ? rules.find((rule) => rule.id === editingId) : null

  const findingsByKind = FINDING_KIND_ORDER
    .map((kind) => ({ kind, items: findings.filter((finding) => finding.kind === kind) }))
    .filter((group) => group.items.length > 0)

  const hasAutoRemovableFindings = findings.some((finding) => AUTO_REMOVABLE_KINDS.has(finding.kind))

  const renderFormFields = () => (
    <>
      <div>
        <label>
          Narration contains
          <input
            type="text"
            value={form.narration_pattern}
            onChange={handleFieldChange('narration_pattern')}
            required
          />
        </label>
      </div>
      <div>
        <label>
          Transaction type
          <select value={form.transaction_type} onChange={handleFieldChange('transaction_type')}>
            <option value="">Any type</option>
            {typeOptions.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <label>
          Min amount
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.min_amount}
            onChange={handleFieldChange('min_amount')}
          />
        </label>
      </div>
      <div>
        <label>
          Max amount
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.max_amount}
            onChange={handleFieldChange('max_amount')}
          />
        </label>
      </div>
      <div>
        <label>
          Category
          <CategorySelect
            categories={categories}
            value={form.category_id}
            onChange={handleFieldChange('category_id')}
            required
            fallbackOption={
              editingRule ? { id: editingRule.category_id, name: editingRule.category_name } : null
            }
          >
            <option value="">Select a category</option>
          </CategorySelect>
        </label>
      </div>
    </>
  )

  return (
    <section className="card">
      <h2>Rules</h2>

      {actionError && <ErrorState label="Action failed:" message={actionError} />}

      <Card id="rules-apply" title="Apply Rules">
        <p>
          Re-runs every rule over your existing transactions. Categories you set by hand are never
          changed.
        </p>
        <button type="button" onClick={handleApplyRules} disabled={applying}>
          Apply rules now
        </button>
        {applyMessage && <p>{applyMessage}</p>}
      </Card>

      <Card id="rules-review" title="Review Rules">
        <p>
          Rules are checked top to bottom and the first match wins, so a rule can end up
          permanently unreachable - shadowed by a broader one above it. This reads that ordering
          and reports what it makes provable; it changes nothing on its own.
        </p>

        {findings.length === 0 && <p>No duplicate, subsumed or shadowed rules found.</p>}

        {findingsByKind.map(({ kind, items }) => (
          <div key={kind}>
            <h4>{FINDING_KIND_LABELS[kind]} ({items.length})</h4>
            <ul>
              {items.map((finding) => (
                <li key={finding.rule_id}>
                  <strong>{finding.narration_pattern}</strong> ({finding.category_name}) is blocked
                  by rule &quot;{finding.blocking_narration_pattern}&quot;.
                  {AUTO_REMOVABLE_KINDS.has(kind) && (
                    <button
                      type="button"
                      className="button-danger"
                      onClick={() => handleRemoveFinding(finding.rule_id)}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}

        {hasAutoRemovableFindings && (
          <button type="button" onClick={handleRemoveRedundant} disabled={removingRedundant}>
            Remove all duplicate/subsumed rules
          </button>
        )}
        {reviewMessage && <p>{reviewMessage}</p>}
      </Card>

      <Card id="rules-form" title="Add Rule">
        {editingId ? (
          <p>Finish editing the rule below to add another.</p>
        ) : (
          <>
            <p>
              Rules are checked top to bottom and the first match wins. Amounts are compared as
              positive dollar values regardless of debit or credit &mdash; set Transaction type to
              restrict a rule to spending or income.
            </p>

            <form onSubmit={handleSubmit}>
              {renderFormFields()}
              <button type="submit" className="button-primary" disabled={saving}>
                Add Rule
              </button>
              <button type="button" onClick={handlePreview} disabled={previewing}>
                Check matches
              </button>
            </form>

            {preview && (
              <p>
                Would match {preview.match_count} transaction(s); {preview.would_categorize_count}{' '}
                would be categorized now.
              </p>
            )}
          </>
        )}
      </Card>

      <Card id="rules-list" title="All Rules">
        {loading && <LoadingState message="Loading rules..." />}
        {!loading && error && <ErrorState label="Failed to load rules:" message={error} />}

        {!loading && !error && (
          <table>
            <caption className="visually-hidden">Auto-categorization rules</caption>
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Narration contains</th>
                <th scope="col">Type</th>
                <th scope="col">Min</th>
                <th scope="col">Max</th>
                <th scope="col">Category</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, index) => {
                const editId = `rule-edit-${rule.id}`
                const isEditing = editingId === rule.id

                return (
                  <Fragment key={rule.id}>
                    <tr>
                      <td>
                        <button
                          type="button"
                          aria-label={`Move ${rule.narration_pattern} up`}
                          onClick={() => handleMove(rule.id, 'up')}
                          disabled={index === 0}
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${rule.narration_pattern} down`}
                          onClick={() => handleMove(rule.id, 'down')}
                          disabled={index === rules.length - 1}
                        >
                          ▼
                        </button>
                      </td>
                      <td>{rule.narration_pattern}</td>
                      <td>{rule.transaction_type}</td>
                      <td><Amount value={rule.min_amount} neutral /></td>
                      <td><Amount value={rule.max_amount} neutral /></td>
                      <td>{rule.category_name}</td>
                      <td>
                        <button
                          type="button"
                          aria-expanded={isEditing}
                          aria-controls={editId}
                          onClick={() => startEdit(rule)}
                        >
                          Edit
                        </button>
                        <button type="button" className="button-danger" onClick={() => handleDelete(rule.id)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                    {isEditing && (
                      <InlineEditRow
                        id={editId}
                        colSpan={RULES_TABLE_COLUMN_COUNT}
                        onSubmit={handleSubmit}
                        onCancel={cancelEdit}
                        saving={saving}
                      >
                        {renderFormFields()}
                        <button type="button" onClick={handlePreview} disabled={previewing}>
                          Check matches
                        </button>
                        {preview && (
                          <p>
                            Would match {preview.match_count} transaction(s);{' '}
                            {preview.would_categorize_count} would be categorized now.
                          </p>
                        )}
                      </InlineEditRow>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>
    </section>
  )
}
