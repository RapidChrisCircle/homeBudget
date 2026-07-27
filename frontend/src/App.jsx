import { Link, Route, Routes } from 'react-router-dom'
import './App.css'
import { pages } from './pageRegistry.jsx'

function PageLink({ page }) {
  if (page.external) {
    return (
      <a href={page.href} target="_blank" rel="noreferrer">
        {page.label}
      </a>
    )
  }

  return <Link to={page.path}>{page.label}</Link>
}

function App() {
  return (
    <main className="app-shell">
      <header className="header">
        <h1>Template Verification</h1>
        <nav className="nav-links">
          <Link to="/">Home</Link>
          {pages.map((page) => (
            <PageLink key={page.href || page.path} page={page} />
          ))}
        </nav>
      </header>

      <Routes>
        <Route
          path="/"
          element={
            <section className="card">
              <h2>Verification Pages</h2>
              <p>Use these pages to verify the template behavior in both no-DB and DB-backed modes.</p>
              <ul>
                {pages.map((page) => (
                  <li key={page.href || page.path}>
                    <PageLink page={page} />
                  </li>
                ))}
              </ul>
            </section>
          }
        />
        {pages
          .filter((page) => page.element)
          .map((page) => (
            <Route key={page.path} path={page.path} element={page.element} />
          ))}
      </Routes>
    </main>
  )
}

export default App
