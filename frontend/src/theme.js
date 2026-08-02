// Light/dark theme resolution and persistence.
//
// "Auto" means TIME OF DAY, not the OS's prefers-color-scheme - the user
// wants the app to switch itself by clock, which prefers-color-scheme
// cannot express (it only reports the OS's own CURRENT setting; it has no
// notion of "later today"). Resolution therefore happens here, in JS, and
// the result is stamped onto <html> as data-theme - see index.css's header
// comment for how that interacts with the no-JS prefers-color-scheme
// fallback.

const STORAGE_KEY = 'homebudget:theme-mode'
const MODES = ['auto', 'light', 'dark']

// Dark from 18:00 up to (not including) 06:00 - an evening/night window
// approximated by a fixed clock boundary, not real sunset/sunrise (no
// geolocation - see the plan's deliberate exclusions). Both boundary hours
// resolve to their "already begun" side: 18:00 is already evening (dark),
// 06:00 is already morning (light).
export function resolveAutoTheme(date = new Date()) {
  const hour = date.getHours()
  return hour >= 18 || hour < 6 ? 'dark' : 'light'
}

// A mode ('auto'|'light'|'dark') resolves to an actual theme ('light'|'dark').
export function resolveTheme(mode, date = new Date()) {
  return mode === 'auto' ? resolveAutoTheme(date) : mode
}

// localStorage can throw (private browsing, disabled storage, a full quota)
// - degrading to "always auto, never persisted" is a far better failure
// than a crash on every page load.
export function readStoredMode() {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return MODES.includes(value) ? value : 'auto'
  } catch {
    return 'auto'
  }
}

export function storeMode(mode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // See readStoredMode - a failed write just means the choice doesn't
    // survive a reload, not a crash.
  }
}

// Stamps the resolved theme onto <html> - data-theme drives
// :root[data-theme] in index.css, and color-scheme keeps native controls
// (scrollbars, date pickers, form controls) in sync with it too.
export function applyTheme(resolved) {
  document.documentElement.setAttribute('data-theme', resolved)
  document.documentElement.style.colorScheme = resolved
}
