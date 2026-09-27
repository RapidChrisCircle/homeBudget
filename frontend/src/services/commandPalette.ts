// A way to open <CommandPalette> from outside itself (T4.1a's sidebar
// search trigger button), without lifting its `open` state into App.jsx.
// CommandPalette.test.jsx renders the component standalone and opens it
// with a synthetic Ctrl+K keydown - if `open` moved up into App, all 17 of
// those tests would need App as their render root instead. This is
// additive to that existing path instead: CommandPalette subscribes here
// once, alongside its own Ctrl+K listener, and setting open still happens
// entirely inside the component.
//
// Same module-level pub-sub shape as services/toast.ts and services/api.ts's
// own subscribeToBuildIdentity - state that has to be reachable from
// anywhere, not just from whatever subtree renders the thing that reacts to
// it.

const listeners = new Set<() => void>();

export function openCommandPalette() {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeToPaletteOpen(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Test-only - the listener set is module-level singleton state, exactly
// like toast.ts's own _resetToastsForTests.
export function _resetCommandPaletteForTests() {
  listeners.clear();
}
