// The category colour picker's fixed palette (T4.5a) - matches
// index.css's --category-1..10 tokens exactly (token name, not a literal
// hex, so a category's colour resolves per theme like every other colour
// in the app). A category's own `color` field stores one of these token
// names, or null for "no colour chosen" - never a guessed default.
export const CATEGORY_COLOR_TOKENS = [
  { token: 'category-1', label: 'Red' },
  { token: 'category-2', label: 'Orange' },
  { token: 'category-3', label: 'Olive' },
  { token: 'category-4', label: 'Green' },
  { token: 'category-5', label: 'Teal' },
  { token: 'category-6', label: 'Cyan' },
  { token: 'category-7', label: 'Blue' },
  { token: 'category-8', label: 'Indigo' },
  { token: 'category-9', label: 'Purple' },
  { token: 'category-10', label: 'Magenta' },
]

const TOKEN_SET = new Set(CATEGORY_COLOR_TOKENS.map((c) => c.token))

// The one place a category's `color` field becomes a CSS custom property
// reference - so a typo'd or stale token name (an older build with fewer
// swatches, a hand-edited API call) falls back to no colour rather than
// emitting a `var(--nonexistent)` that silently renders as nothing.
export function categoryColorVar(token) {
  return token && TOKEN_SET.has(token) ? `var(--${token})` : null
}
