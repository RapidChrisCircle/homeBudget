import TransactionsPage from './pages/TransactionsPage.jsx'

// Single source of truth for browsable pages. Add an entry here and it
// automatically shows up in the header nav, the home page list, and gets
// wired into the router.
export const pages = [
  {
    path: '/transactions',
    label: 'Transactions',
    element: <TransactionsPage />,
  },
]
