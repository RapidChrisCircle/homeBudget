import { useEffect, useState } from 'react'
import { applyTheme, readStoredMode, resolveTheme, storeMode } from './theme.js'

// Re-resolves 'auto' on an interval so a session left open across the
// 18:00/06:00 boundary actually flips instead of only ever resolving once
// at mount. A minute is frequent enough to feel immediate without being
// wasteful - the boundary only matters twice a day.
const AUTO_RECHECK_MS = 60_000

// {mode, resolved, setMode} - mode is the user's choice ('auto'|'light'|
// 'dark', default 'auto', persisted via theme.js); resolved is the actual
// theme currently applied ('light'|'dark'), which for 'auto' depends on the
// clock and can change without the user doing anything.
export function useTheme() {
  const [mode, setModeState] = useState(readStoredMode)
  const [resolved, setResolved] = useState(() => resolveTheme(readStoredMode()))

  useEffect(() => {
    const recompute = () => setResolved(resolveTheme(mode))
    recompute()

    if (mode !== 'auto') {
      return undefined
    }

    const interval = setInterval(recompute, AUTO_RECHECK_MS)
    return () => clearInterval(interval)
  }, [mode])

  useEffect(() => {
    applyTheme(resolved)
  }, [resolved])

  const setMode = (nextMode) => {
    storeMode(nextMode)
    setModeState(nextMode)
  }

  return { mode, resolved, setMode }
}
