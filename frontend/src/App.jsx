import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import './App.css'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import { pages } from './pageRegistry.jsx'
import { api } from './services/api'
import { useTheme } from './useTheme.js'
import { getAppVersion, getGitSha } from './version.js'

function navLinkClassName({ isActive }) {
  return isActive ? 'active' : undefined
}

function PageLink({ page }) {
  return (
    <NavLink to={page.path} className={navLinkClassName}>
      {page.label}
    </NavLink>
  )
}

// Truncated to 7 characters for display, matching the short form `git`
// itself shows - the full value is still available in the title tooltip.
function shortSha(sha) {
  return sha === 'unknown' ? sha : sha.slice(0, 7)
}

function App() {
  // Parameterised/detail routes (e.g. /accounts/:id) set `hidden: true` so
  // they still get wired into the router below, but don't show up as a
  // literal ":id" link in the nav or the home page list.
  const visiblePages = pages.filter((page) => !page.hidden)

  const appVersion = getAppVersion()
  const gitSha = getGitSha()

  const { mode: themeMode, setMode: setThemeMode } = useTheme()

  const location = useLocation()

  // `apiVersion` starts out `null` (still checking / not yet resolved)
  // rather than an object with blank fields, so "unreachable" and "haven't
  // heard back yet" don't have to be told apart by inspecting empty strings.
  const [apiVersion, setApiVersion] = useState(null)
  const [apiUnreachable, setApiUnreachable] = useState(false)

  useEffect(() => {
    let cancelled = false

    api.get('/version')
      .then((response) => {
        if (!cancelled) {
          setApiVersion(response.data)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setApiUnreachable(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    document.title = `homeBudget v${appVersion}`
  }, [appVersion])

  // A mismatch is only meaningful when both sides actually know their own
  // commit - two builds that both legitimately report "unknown" (e.g. local
  // dev, where neither the frontend nor the backend has GIT_SHA set) must
  // never be flagged as mismatched.
  const mismatch = Boolean(
    apiVersion
    && gitSha !== 'unknown'
    && apiVersion.commit !== 'unknown'
    && apiVersion.commit !== gitSha
  )

  return (
    <main className="app-shell">
      <header className="header">
        <div className="header-brand">
          <h1>homeBudget</h1>
          <span className="version-badge" title={`commit ${gitSha}`}>
            v{appVersion} &middot; {shortSha(gitSha)}
          </span>
          <label className="theme-select">
            Theme
            <select value={themeMode} onChange={(e) => setThemeMode(e.target.value)}>
              <option value="auto">Auto</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
        <nav className="nav-links">
          <NavLink to="/" end className={navLinkClassName}>
            Home
          </NavLink>
          {visiblePages.map((page) => (
            <PageLink key={page.path} page={page} />
          ))}
        </nav>
      </header>

      {/* key={location.pathname} remounts the boundary itself on every
          navigation, clearing state.error along with it - without this, a
          crash on one route would strand the fallback in place forever,
          since changing what <Routes> renders next does not by itself make
          an already-tripped error boundary retry rendering its children. */}
      <ErrorBoundary key={location.pathname}>
        <Routes>
          {/* The dashboard is deliberately not in pageRegistry: the registry
              drives the nav bar, and Home already has its own link there. */}
          <Route path="/" element={<DashboardPage />} />
          {pages.map((page) => (
            <Route key={page.path} path={page.path} element={page.element} />
          ))}
        </Routes>
      </ErrorBoundary>

      <footer className="footer">
        <span>
          {apiUnreachable && 'API version unknown'}
          {!apiUnreachable && !apiVersion && 'Checking API version...'}
          {!apiUnreachable && apiVersion && `API v${apiVersion.version} · ${shortSha(apiVersion.commit)}`}
        </span>
        {mismatch && (
          <span className="version-mismatch">
            Frontend and API are on different builds - one may be stale.
          </span>
        )}
      </footer>
    </main>
  )
}

export default App
