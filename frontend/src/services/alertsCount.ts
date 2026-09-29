// The Alerts nav badge's count (T5.3), lifted out of App.jsx's own local
// state into a shared module-level store - the same subscribe/getSnapshot
// shape services/toast.ts and services/commandPalette.ts already use for
// exactly this reason: state that has to be reachable and updatable from
// outside whatever subtree renders the thing that displays it.
//
// Before this, App.jsx fetched GET /alerts once on mount and never again,
// so the nav badge went stale the moment a dismissal happened anywhere -
// most visibly after a "Dismiss all" on /alerts, which would otherwise
// still show the old count until a full page reload. AlertsPage now pushes
// the fresh count here after every dismissal (single, per-group, or all),
// and App.jsx reads it with useSyncExternalStore instead of its own
// useState, so the two can never disagree about what the badge should say.

let count: number | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeToAlertsCount(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// null (not 0) means "not yet known" - the same "absence, not a zero"
// distinction App.jsx's own original state already made, preserved here
// so a badge that hasn't loaded yet still renders nothing rather than "(0)".
export function getAlertsCount(): number | null {
  return count;
}

export function setAlertsCount(next: number | null) {
  count = next;
  notify();
}

// Test-only - module-level state otherwise leaks between test cases (and
// test files) that import this module, exactly like toast.ts's own
// _resetToastsForTests.
export function _resetAlertsCountForTests() {
  count = null;
  listeners.clear();
}
