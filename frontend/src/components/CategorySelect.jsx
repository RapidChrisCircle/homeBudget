import { groupByParent } from '../utils/categories.js'

// The one category <select> the app uses wherever a transaction, split,
// group or rule needs to name a category. Children render grouped under
// their parent via a native <optgroup> - <optgroup> LABELS are inert by
// construction, which IS the "a parent can never itself be assigned" rule
// (api/categories.py's module docstring) enforced by markup rather than by
// a filter every call site has to remember to apply. Screen readers
// announce the group name with every option inside it, for free.
//
// Leading options (an "Uncategorized" default, a filter's "All
// categories"/"Uncategorized only" pair, a rule's "Select a category"
// placeholder - every call site wants different text here) are the
// caller's own <option> children, rendered before the grouped/plain
// categories rather than baked into a prop, since there is no one right
// wording to default to.
//
// fallbackOption={{id, name}} covers the one case CategorySelect cannot
// solve on its own: the currently assigned category has since been
// archived, so it is absent from `categories` (GET /categories excludes
// archived by default - see api/categories.py). The component cannot
// invent a name for an id it can't see, so the caller passes {id, name}
// read off whatever record it already has in hand (a transaction, a
// split, a rule) - CategorySelect only decides WHETHER that pair needs to
// be shown, by checking it against the current `value` and the known ids.
export default function CategorySelect({ categories, value, onChange, fallbackOption = null, children, ...selectProps }) {
  const { parentless, groups } = groupByParent(categories)

  const knownIds = new Set(categories.map((category) => String(category.id)))
  const needsFallback = (
    fallbackOption?.id != null
    && String(value) === String(fallbackOption.id)
    && !knownIds.has(String(fallbackOption.id))
  )

  return (
    <select value={value} onChange={onChange} {...selectProps}>
      {children}
      {needsFallback && (
        <option value={fallbackOption.id}>{fallbackOption.name} (archived)</option>
      )}
      {groups.map(({ parent, children: kids }) => (
        <optgroup key={parent.id} label={parent.name}>
          {kids.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </optgroup>
      ))}
      {parentless.map((category) => (
        <option key={category.id} value={category.id}>
          {category.name}
        </option>
      ))}
    </select>
  )
}
