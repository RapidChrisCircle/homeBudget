import { Link, Route, Routes } from 'react-router-dom'
import './App.css'
import DashboardPage from './pages/DashboardPage.jsx'
import { pages } from './pageRegistry.jsx'

function PageLink({ page }) {
  return <Link to={page.path}>{page.label}</Link>
}

function App() {
  // Parameterised/detail routes (e.g. /accounts/:id) set `hidden: true` so
  // they still get wired into the router below, but don't show up as a
  // literal ":id" link in the nav or the home page list.
  const visiblePages = pages.filter((page) => !page.hidden)

  return (
    <main className="app-shell">
      <header className="header">
        <h1>homeBudget</h1>
        <nav className="nav-links">
          <Link to="/">Home</Link>
          {visiblePages.map((page) => (
            <PageLink key={page.path} page={page} />
          ))}
        </nav>
      </header>

      <Routes>
        {/* The dashboard is deliberately not in pageRegistry: the registry
            drives the nav bar, and Home already has its own link there. */}
        <Route path="/" element={<DashboardPage />} />
        {pages.map((page) => (
          <Route key={page.path} path={page.path} element={page.element} />
        ))}
      </Routes>
    </main>
  )
}

export default App
