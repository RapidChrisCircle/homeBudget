import { Link, Route, Routes } from 'react-router-dom'
import './App.css'
import { pages } from './pageRegistry.jsx'

function PageLink({ page }) {
  return <Link to={page.path}>{page.label}</Link>
}

function App() {
  return (
    <main className="app-shell">
      <header className="header">
        <h1>homeBudget</h1>
        <nav className="nav-links">
          <Link to="/">Home</Link>
          {pages.map((page) => (
            <PageLink key={page.path} page={page} />
          ))}
        </nav>
      </header>

      <Routes>
        <Route
          path="/"
          element={
            <section className="card">
              <h2>Features</h2>
              <ul>
                {pages.map((page) => (
                  <li key={page.path}>
                    <PageLink page={page} />
                  </li>
                ))}
              </ul>
            </section>
          }
        />
        {pages.map((page) => (
          <Route key={page.path} path={page.path} element={page.element} />
        ))}
      </Routes>
    </main>
  )
}

export default App
