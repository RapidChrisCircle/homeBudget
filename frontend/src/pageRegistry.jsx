import AccountDetailPage from './pages/AccountDetailPage.jsx'
import AccountsPage from './pages/AccountsPage.jsx'
import AlertsPage from './pages/AlertsPage.jsx'
import CategoriesPage from './pages/CategoriesPage.jsx'
import ForecastPage from './pages/ForecastPage.jsx'
import GoalsPage from './pages/GoalsPage.jsx'
import RecurringPage from './pages/RecurringPage.jsx'
import ReportsPage from './pages/ReportsPage.jsx'
import RulesPage from './pages/RulesPage.jsx'
import TransactionsPage from './pages/TransactionsPage.jsx'
import TriageQueuePage from './pages/TriageQueuePage.jsx'
import TrendsPage from './pages/TrendsPage.jsx'
import {
  AccountsIcon,
  AlertsIcon,
  CategoriesIcon,
  ForecastIcon,
  GoalsIcon,
  RecurringIcon,
  ReportsIcon,
  RulesIcon,
  TransactionsIcon,
  TrendsIcon,
} from './navIcons.jsx'

// Single source of truth for browsable pages. Add an entry here and it
// automatically shows up in the sidebar nav, the home page list, and gets
// wired into the router.
//
// `group` is what the nav (App.jsx) clusters pages under - Finding 9: nine
// peers with no hierarchy in one flat row forced a scan every time. A page
// with NO group renders as its own standalone top-level link instead,
// exactly like Home (which isn't in this list at all, for the identical
// reason) - Alerts is the one entry that does this deliberately: it's a
// cross-cutting notification surface, not a content area, so it doesn't
// belong grouped alongside the pages it might be alerting about.
//
// `icon` (Finding 18, T4.1a) is purely decorative - every icon component in
// navIcons.jsx renders `aria-hidden="true"`, so it never affects a link's
// accessible name. Home and Alerts get their icons directly in App.jsx
// instead of here, the same way their special-cased rendering already is.
export const pages = [
  {
    path: '/alerts',
    label: 'Alerts',
    element: <AlertsPage />,
    icon: AlertsIcon,
  },
  {
    path: '/transactions',
    label: 'Transactions',
    element: <TransactionsPage />,
    group: 'Money',
    icon: TransactionsIcon,
  },
  {
    path: '/accounts',
    label: 'Accounts',
    element: <AccountsPage />,
    group: 'Money',
    icon: AccountsIcon,
  },
  {
    path: '/accounts/:accountId',
    label: 'Account Detail',
    element: <AccountDetailPage />,
    hidden: true,
  },
  {
    path: '/transactions/review',
    label: 'Review Uncategorised',
    element: <TriageQueuePage />,
    hidden: true,
  },
  {
    path: '/categories',
    label: 'Categories',
    element: <CategoriesPage />,
    group: 'Plan',
    icon: CategoriesIcon,
  },
  {
    path: '/recurring',
    label: 'Recurring',
    element: <RecurringPage />,
    group: 'Plan',
    icon: RecurringIcon,
  },
  {
    path: '/forecast',
    label: 'Forecast',
    element: <ForecastPage />,
    group: 'Plan',
    icon: ForecastIcon,
  },
  {
    path: '/goals',
    label: 'Goals',
    element: <GoalsPage />,
    group: 'Plan',
    icon: GoalsIcon,
  },
  {
    path: '/reports',
    label: 'Reports',
    element: <ReportsPage />,
    group: 'Insight',
    icon: ReportsIcon,
  },
  {
    path: '/trends',
    label: 'Trends',
    element: <TrendsPage />,
    group: 'Insight',
    icon: TrendsIcon,
  },
  {
    path: '/rules',
    label: 'Rules',
    element: <RulesPage />,
    group: 'Setup',
    icon: RulesIcon,
  },
]

// Fixed display order - not derived by first-appearance in `pages`, so
// adding a new grouped page above doesn't silently reorder the nav.
export const PAGE_GROUP_ORDER = ['Money', 'Plan', 'Insight', 'Setup']
