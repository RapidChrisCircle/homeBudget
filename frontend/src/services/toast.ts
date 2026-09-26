// Toast notifications (T3.4, Finding 15: every action reported through
// inline text a user may never scroll back to look at).
//
// State lives here, not in a React component - the same "any call site can
// fire one without needing to be inside whatever subtree renders the
// container" reasoning services/api.ts's own subscribeToBuildIdentity
// already uses for build-mismatch detection. Exposed as a subscribe/
// getSnapshot pair so <ToastContainer> can read it with
// useSyncExternalStore instead of polling.
//
// Deliberately scoped to transient SUCCESS confirmations only ("Imported 42
// transactions", "Budget saved") - never an error a user needs to act on.
// <ErrorState> stays the one place any error appears, exactly as it always
// has; nothing here ever carries error content, so this can never become
// the ONLY place an error shows.

export type ToastTone = "success" | "info";

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

export interface ShowToastOptions {
  tone?: ToastTone;
  durationMs?: number;
}

const DEFAULT_DURATION_MS = 4000;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeToToasts(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToasts(): Toast[] {
  return toasts;
}

export function showToast(message: string, options: ShowToastOptions = {}): number {
  const { tone = "success", durationMs = DEFAULT_DURATION_MS } = options;
  const id = nextId++;

  toasts = [...toasts, { id, message, tone }];
  notify();

  if (durationMs > 0) {
    setTimeout(() => dismissToast(id), durationMs);
  }

  return id;
}

export function dismissToast(id: number) {
  const next = toasts.filter((toast) => toast.id !== id);

  if (next.length === toasts.length) {
    return;
  }

  toasts = next;
  notify();
}

// Test-only - module-level state otherwise leaks between test cases (and
// test files) that import this module, since it's a singleton exactly like
// api.ts's own build-identity state.
export function _resetToastsForTests() {
  toasts = [];
  nextId = 1;
  listeners.clear();
}
