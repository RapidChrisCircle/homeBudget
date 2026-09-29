import { useEffect, useState, useSyncExternalStore } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
// Split from one 1731-line App.css (T4.0) into four files, imported in this
// order so the LAST one - motion.css - always wins by source order for the
// one shared prefers-reduced-motion block, rather than by remembering to
// keep it at the bottom of an ever-growing single file.
import './styles/shell.css'
import './styles/primitives.css'
import './styles/features.css'
import './styles/motion.css'
import CommandPalette from './components/CommandPalette.jsx'
import ToastContainer from './components/ToastContainer.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import { PAGE_GROUP_ORDER, pages } from './pageRegistry.jsx'
import { HomeIcon, MenuIcon, SearchIcon } from './navIcons.jsx'
import { api, getMultipleBuildsDetected, subscribeToBuildIdentity } from './services/api'
import { getAlertsCount, setAlertsCount, subscribeToAlertsCount } from './services/alertsCount.ts'
import { openCommandPalette } from './services/commandPalette.ts'
import { readStoredCollapsed, storeCollapsed } from './sidebar.js'
import { useTheme } from './useTheme.js'
import { getAppVersion, getGitSha } from './version.js'

function navLinkClassName({ isActive }) {
  return isActive ? 'active' : undefined
}

// The badge is still literal text inside the link ` (${badge})`, not a
// separate element - so the link's accessible name is exactly "Alerts (3)",
// unchanged from before this task, while `.nav-badge` styles it as a pill.
// Icons are aria-hidden (see navIcons.jsx), so they never enter the name
// either - a link's name is always just its label plus an optional count.
function PageLink({ page, badge }) {
  const Icon = page.icon

  return (
    <NavLink to={page.path} className={navLinkClassName}>
      {Icon && <Icon />}
      <span className="nav-label">
        {page.label}
        {Boolean(badge) && <span className="nav-badge"> ({badge})</span>}
      </span>
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

  // Grouped nav (Finding 9: nine ungrouped peers forced a scan every time).
  // A page with no `group` (just Alerts, currently) renders as its own
  // standalone link instead, the same way Home does - both are cross-
  // cutting rather than a content area, so grouping them WITH the content
  // they might point at would be the wrong hierarchy, not a missing one.
  const ungroupedPages = visiblePages.filter((page) => !page.group)
  const navGroups = PAGE_GROUP_ORDER
    .map((group) => ({ group, pages: visiblePages.filter((page) => page.group === group) }))
    .filter((entry) => entry.pages.length > 0)

  const appVersion = getAppVersion()
  const gitSha = getGitSha()

  const { mode: themeMode, setMode: setThemeMode } = useTheme()

  const location = useLocation()

  // `apiVersion` starts out `null` (still checking / not yet resolved)
  // rather than an object with blank fields, so "unreachable" and "haven't
  // heard back yet" don't have to be told apart by inspecting empty strings.
  const [apiVersion, setApiVersion] = useState(null)
  const [apiUnreachable, setApiUnreachable] = useState(false)

  // Every response any page's own axios call receives passes through
  // services/api.ts's shared interceptor, which is the only place that can
  // see them all - this just reads its verdict. Unlike `mismatch` below
  // (one comparison, done once `apiVersion` resolves), this can flip true
  // at any point during the session, since it depends on which of
  // possibly-several API containers answered each individual request -
  // useSyncExternalStore is what makes a change there re-render here.
  const multipleBuildsDetected = useSyncExternalStore(subscribeToBuildIdentity, getMultipleBuildsDetected)

  // T5.3 - a shared module-level store (services/alertsCount.ts), not
  // local useState: AlertsPage pushes the fresh count here after every
  // dismissal (single, per-group, or "Dismiss all"), so the badge can
  // never go stale the way it used to when this was fetched once on mount
  // and never again. useSyncExternalStore is what makes a change made
  // elsewhere re-render here, the same reason multipleBuildsDetected above
  // uses it for services/api.ts's own build-identity store.
  const alertsCount = useSyncExternalStore(subscribeToAlertsCount, getAlertsCount)

  // Sidebar collapse-to-icons (T4.1a, Finding 18) - persisted the same
  // try/catch-guarded way theme.js persists the theme mode. Read once on
  // mount rather than as the useState initializer, so every test (which
  // renders straight after `localStorage.clear()`) gets a deterministic
  // "expanded" first render before this effect ever runs, matching what a
  // fresh visit sees too.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    setSidebarCollapsed(readStoredCollapsed())
  }, [])

  function toggleSidebarCollapsed() {
    setSidebarCollapsed((prev) => {
      const next = !prev
      storeCollapsed(next)
      return next
    })
  }

  useEffect(() => {
    let cancelled = false

    // The initial population of the shared store above - AlertsPage takes
    // over keeping it fresh after this, via the same setAlertsCount setter.
    api.get('/alerts')
      .then((response) => {
        if (!cancelled) {
          setAlertsCount(response.data.count)
        }
      })
      .catch(() => {
        // A failed count fetch just means no badge - the /alerts page
        // itself still shows its own real error state.
      })

    return () => {
      cancelled = true
    }
  }, [])

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

  // The drawer (the sidebar's <900px collapsed-into-a-menu form) closes on
  // navigation, the same idea as ErrorBoundary's own key={pathname} reset -
  // otherwise a link tap would leave the drawer sitting open over the page
  // it just navigated to.
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  // Escape closes the drawer - the same idiom HeaderFilter.jsx and
  // SplitEditor.jsx already use for their own open overlays: a document
  // keydown listener, added only while open, removed on cleanup.
  useEffect(() => {
    if (!drawerOpen) {
      return
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setDrawerOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [drawerOpen])

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
    <div className={`app-shell${sidebarCollapsed ? ' app-shell-collapsed' : ''}${drawerOpen ? ' app-shell-drawer-open' : ''}`}>
      <CommandPalette />
      <ToastContainer />

      {/* Always in the DOM, hidden above 900px by CSS (shell.css) rather
          than by a matchMedia/innerWidth check - jsdom implements neither,
          so gating this on viewport would fail every test that mounts App
          rather than merely being invisible to them. */}
      <button
        type="button"
        className="sidebar-toggle"
        aria-expanded={drawerOpen}
        aria-controls="app-sidebar-nav"
        aria-label="Menu"
        onClick={() => setDrawerOpen((prev) => !prev)}
      >
        <MenuIcon />
      </button>

      <aside className="sidebar">
        <div className="sidebar-brand">
          <h1>homeBudget</h1>
          <span className="version-badge" title={`commit ${gitSha}`}>
            v{appVersion} &middot; {shortSha(gitSha)}
          </span>
        </div>

        <button type="button" className="sidebar-search-trigger" onClick={openCommandPalette}>
          <SearchIcon />
          <span className="nav-label">Search</span>
          <span className="sidebar-search-hint" aria-hidden="true">Ctrl+K</span>
        </button>

        <nav className="nav-links" id="app-sidebar-nav">
          <div className="nav-primary">
            <NavLink to="/" end className={navLinkClassName}>
              <HomeIcon />
              <span className="nav-label">Home</span>
            </NavLink>
            {ungroupedPages.map((page) => (
              <PageLink key={page.path} page={page} badge={page.path === '/alerts' ? alertsCount : null} />
            ))}
          </div>
          {navGroups.map(({ group, pages: groupPages }) => (
            <div className="nav-group" key={group}>
              <span className="nav-group-label">{group}</span>
              {groupPages.map((page) => (
                <PageLink key={page.path} page={page} />
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <label className="theme-select">
            <span className="nav-label">Theme</span>
            <select value={themeMode} onChange={(e) => setThemeMode(e.target.value)}>
              <option value="auto">Auto</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <button
            type="button"
            className="sidebar-collapse-toggle"
            aria-pressed={sidebarCollapsed}
            onClick={toggleSidebarCollapsed}
          >
            {sidebarCollapsed ? 'Expand' : 'Collapse'}
          </button>
        </div>
      </aside>

      {/* Clicking outside the drawer (this scrim) closes it, below 900px
          only - see shell.css, it has no size above that breakpoint. */}
      {drawerOpen && <div className="sidebar-scrim" onClick={() => setDrawerOpen(false)} />}

      <main className="app-main">
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
          {multipleBuildsDetected && (
            <span className="version-mismatch">
              Responses are coming from more than one API build - check for a duplicate api container.
            </span>
          )}
        </footer>
      </main>
    </div>
  )
}

export default App
