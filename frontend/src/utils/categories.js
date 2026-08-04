// Shared shaping logic for every category <select> in the app - grouping
// children under their parent for hierarchical display. Sub-categories are
// GROUPING ONLY (see backend's Category.parent_id docstring): a category
// with children is never itself assignable, and a category with a
// parent_id never has children of its own (the backend's one-level rule,
// api/categories.py) - so every category in a flat GET /categories list
// falls into exactly one of three roles: a parent (has children), a child
// (has a parent_id), or a plain top-level category (neither).

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
