import { useState } from 'react'
import Amount from './Amount.jsx'
import CategorySelect from './CategorySelect.jsx'
import ErrorState from './ErrorState.jsx'
import { api } from '../services/api'
import { categoryPathLabel } from '../utils/categories.js'

// Splitting one category into several, on /categories.
//
// The mirror image of combining, and deliberately not symmetric in
// mechanism: combining knows where everything goes, while a split has to
// decide PER TRANSACTION which new category it belongs to, and the only
// signal available is the narration text. So each part carries a narration
// pattern with the exact semantics a rule's own pattern has (a
// case-insensitive substring), parts match in order with the first match
// winning, and anything matching nothing stays in the source category.
//
// Preview before Split, for the same reason RuleEditor previews a rule's
// match count before saving it: the counts come from the identical matcher
// the split itself runs (services/category_restructure.py), so what the
// preview says is what the split does - and unlike a rule, a split moves
// history, so guessing at a pattern and finding out afterward is expensive.
const EMPTY_PART = { name: '', pattern: '', budget_amount: '', create_rule: false }

export default function CategorySplitter({ categories, onDone }) {
  const [categoryId, setCategoryId] = useState('')
  const [parts, setParts] = useState([{ ...EMPTY_PART }])
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const source = categories.find((category) => String(category.id) === String(categoryId)) || null

  // Any edit invalidates a preview that was computed from the previous
  // values - showing stale counts next to changed patterns is worse than
  // showing none, since the whole point of the preview is that it matches
  // what Split will do.
  const updatePart = (index, field, value) => {
    setPreview(null)
    setMessage('')
    setParts((prev) => prev.map((part, i) => (i === index ? { ...part, [field]: value } : part)))
  }

  const addPart = () => {
    setPreview(null)
    setParts((prev) => [...prev, { ...EMPTY_PART }])
  }

  const removePart = (index) => {
    setPreview(null)
    setParts((prev) => (prev.length === 1 ? prev : prev.filter((_part, i) => i !== index)))
  }

  const handleSourceChange = (event) => {
    setPreview(null)
    setMessage('')
    setCategoryId(event.target.value)
  }

  const isComplete = (
    categoryId !== ''
    && parts.length > 0
    && parts.every((part) => part.name.trim() !== '' && part.pattern.trim() !== '')
  )

  const payload = () => ({
    category_id: Number(categoryId),
    parts: parts.map((part) => ({
      name: part.name.trim(),
      pattern: part.pattern.trim(),
      budget_amount: part.budget_amount === '' ? null : part.budget_amount,
      create_rule: part.create_rule,
    })),
  })

  const handlePreview = async () => {
    setError('')
    setMessage('')
    setBusy(true)
    try {
      const response = await api.post('/categories/split/preview', payload())
      setPreview(response.data)
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || 'Preview failed'
      setError(String(detail))
    } finally {
      setBusy(false)
    }
  }

  const handleSplit = async () => {
    const names = parts.map((part) => part.name.trim()).join(', ')
    if (!window.confirm(
      `Split "${categoryPathLabel(source)}" into ${names}? Matching transactions move to the new `
      + 'categories; anything matching no pattern stays where it is.'
    )) {
      return
    }

    setError('')
    setMessage('')
    setBusy(true)
    try {
      const response = await api.post('/categories/split', payload())
      const { created, transactions_moved: moved, splits_moved: splitsMoved } = response.data
      setMessage(
        `Created ${created.length} categor${created.length === 1 ? 'y' : 'ies'}, `
        + `moved ${moved + splitsMoved} transaction(s).`
      )
      setParts([{ ...EMPTY_PART }])
      setPreview(null)
      await onDone()
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || 'Split failed'
      setError(String(detail))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p>
        Carve one category into several. Each new category takes the transactions whose narration
        contains its pattern &mdash; matched in order, first match wins, exactly like a rule.
        Anything matching nothing stays where it is. New categories inherit the source&apos;s kind
        and parent group.
      </p>

      {error && <ErrorState label="Split failed:" message={error} />}
      {message && <p>{message}</p>}

      <label>
        Category to split
        <CategorySelect categories={categories} value={categoryId} onChange={handleSourceChange}>
          <option value="">Select a category</option>
        </CategorySelect>
      </label>

      <table>
        <caption className="visually-hidden">New categories to split out</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Narration contains</th>
            <th scope="col" className="numeric">Budget</th>
            <th scope="col">Rule</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          {parts.map((part, index) => (
            <tr key={index}>
              <td>
                <input
                  type="text"
                  aria-label={`Name for new category ${index + 1}`}
                  value={part.name}
                  onChange={(event) => updatePart(index, 'name', event.target.value)}
                />
              </td>
              <td>
                <input
                  type="text"
                  aria-label={`Narration pattern for new category ${index + 1}`}
                  value={part.pattern}
                  onChange={(event) => updatePart(index, 'pattern', event.target.value)}
                />
              </td>
              <td>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  aria-label={`Standing budget for new category ${index + 1}`}
                  value={part.budget_amount}
                  onChange={(event) => updatePart(index, 'budget_amount', event.target.value)}
                />
              </td>
              <td>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`Also create a rule for new category ${index + 1}`}
                    checked={part.create_rule}
                    onChange={(event) => updatePart(index, 'create_rule', event.target.checked)}
                  />
                  {' '}Also for future imports
                </label>
              </td>
              <td>
                <button type="button" onClick={() => removePart(index)} disabled={parts.length === 1}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button type="button" onClick={addPart}>Add another</button>
      <button type="button" onClick={handlePreview} disabled={!isComplete || busy}>
        Preview
      </button>
      <button type="button" className="button-primary" onClick={handleSplit} disabled={!isComplete || busy}>
        Split
      </button>

      {preview && (
        <table>
          <caption className="visually-hidden">Split preview</caption>
          <thead>
            <tr>
              <th scope="col">New category</th>
              <th scope="col" className="numeric">Transactions</th>
              <th scope="col" className="numeric">Total</th>
            </tr>
          </thead>
          <tbody>
            {preview.parts.map((part) => (
              <tr key={part.name}>
                <th scope="row">{part.name}</th>
                <td className="numeric">{part.transaction_count}</td>
                <td><Amount value={part.total} /></td>
              </tr>
            ))}
            <tr>
              <th scope="row">Stays in {preview.category_name}</th>
              <td className="numeric">{preview.remaining_count}</td>
              <td><Amount value={preview.remaining_total} /></td>
            </tr>
          </tbody>
        </table>
      )}
    </>
  )
}
