import ReactDbStatusPage from './pages/ReactDbStatusPage.jsx'
import ReactNoDbPage from './pages/ReactNoDbPage.jsx'

// Single source of truth for browsable pages. Add an entry here and it
// automatically shows up in the header nav, the home page list, and (for
// internal pages) gets wired into the router.
export const pages = [
  {
    path: '/verify/no-db',
    label: 'React No-DB',
    element: <ReactNoDbPage />,
  },
  {
    path: '/verify/db',
    label: 'React DB',
    element: <ReactDbStatusPage />,
  },
  {
    href: '/pages/no-db',
    label: 'FastAPI No-DB',
    external: true,
  },
  {
    href: '/pages/db-status',
    label: 'FastAPI DB',
    external: true,
  },
]
