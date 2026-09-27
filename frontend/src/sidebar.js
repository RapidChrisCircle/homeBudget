// Sidebar collapse-to-icons persistence (T4.1a). Same shape as theme.js's
// own readStoredMode/storeMode: a single boolean, degrading to "always
// expanded, not persisted" rather than throwing when localStorage itself
// is unavailable (private browsing, disabled storage, a full quota).

const STORAGE_KEY = 'homebudget:sidebar-collapsed'

export function readStoredCollapsed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function storeCollapsed(collapsed) {
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? 'true' : 'false')
  } catch {
    // See readStoredCollapsed - a failed write just means the choice
    // doesn't survive a reload, not a crash.
  }
}
