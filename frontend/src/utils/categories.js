// Shared shaping logic for every category <select> in the app - grouping
// children under their parent for hierarchical display. Sub-categories are
// GROUPING ONLY (see backend's Category.parent_id docstring): a category
// with children is never itself assignable, and a category with a
// parent_id never has children of its own (the backend's one-level rule,
// api/categories.py) - so every category in a flat GET /categories list
// falls into exactly one of three roles: a parent (has children), a child
// (has a parent_id), or a plain top-level category (neither).

// The separator between a parent and its child everywhere a category is
// NAMED outside a <select> (whose <optgroup> already shows the hierarchy
// structurally). Exported so a test asserts the rendered string rather
// than hard-coding a character that would then live in a dozen places.
export const CATEGORY_PATH_SEPARATOR = ' › '

// "Food › Groceries" for a child, "Groceries" for a top-level category.
// Every table that names a category goes through this: a bare leaf name is
// ambiguous the moment two groups each own an "Insurance" or a "Fees" (the
// Queensland preset creates exactly that), and the Monthly Budgets card is
// a flat list of leaves with no group headings to disambiguate them.
//
// Takes the {category_name, parent_name} shape the API responses use as
// well as a Category's own {name, parent_name} - the two differ only in
// which key holds the leaf's own name, and every caller would otherwise
// have to remember which kind of record it is holding.
export function categoryPathLabel(category) {
  if (!category) {
    return ''
  }

  const name = category.name ?? category.category_name ?? ''

  return category.parent_name ? `${category.parent_name}${CATEGORY_PATH_SEPARATOR}${name}` : name
}

// {parentless, groups} - parentless is every plain top-level category
// (used by src/components/CategorySelect.jsx's own trailing, ungrouped
// options); groups is one {parent, children} entry per category that has
// children, in list order. A category with a parent_id is never returned
// directly - it only ever appears inside its parent's `children` array.
export function groupByParent(categories) {
  const childrenByParentId = new Map()

  for (const category of categories) {
    if (category.parent_id) {
      const siblings = childrenByParentId.get(category.parent_id) || []
      siblings.push(category)
      childrenByParentId.set(category.parent_id, siblings)
    }
  }

  const parentless = []
  const groups = []

  for (const category of categories) {
    if (category.parent_id) {
      continue // rendered under its parent's group, not here
    }

    const children = childrenByParentId.get(category.id)

    if (children && children.length > 0) {
      groups.push({ parent: category, children })
    } else {
      parentless.push(category)
    }
  }

  return { parentless, groups }
}
