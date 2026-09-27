// Small, deliberately simple inline SVG icons for the sidebar nav
// (pageRegistry.jsx's `icon` field, plus HomeIcon/SearchIcon/MenuIcon used
// directly by App.jsx for the entries that sit outside the registry). No
// icon library - the app has exactly four runtime dependencies (axios,
// react, react-dom, react-router-dom) and this doesn't add a fifth.
//
// Every icon is `aria-hidden="true" focusable="false"` - decorative only,
// so it never contributes to a link's accessible name. `getByRole('link',
// { name })` in App.test.jsx depends on that: an icon that leaked into the
// name would break every grouped link's exact-name match at once. Stroke
// uses `currentColor` so each icon follows the surrounding link's own
// text/active-state color for free, with no new color tokens.
const ICON_PROPS = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false',
}

export function HomeIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10v9a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1v-9" />
    </svg>
  )
}

export function AlertsIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  )
}

export function TransactionsIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 7h13l-3-3" />
      <path d="M20 17H7l3 3" />
    </svg>
  )
}

export function AccountsIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <path d="M16 14h2" />
    </svg>
  )
}

export function CategoriesIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M11 4H6a2 2 0 0 0-2 2v5l9.5 9.5a2 2 0 0 0 2.8 0l5.2-5.2a2 2 0 0 0 0-2.8L11 4Z" />
      <circle cx="8" cy="9" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function RecurringIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 12a8 8 0 0 1 14-5.2M20 5v4h-4" />
      <path d="M20 12a8 8 0 0 1-14 5.2M4 19v-4h4" />
    </svg>
  )
}

export function ForecastIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 17 9.5 10l4 4L20 6" />
      <path d="M15 6h5v5" />
    </svg>
  )
}

export function GoalsIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function ReportsIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M5 20V10" />
      <path d="M12 20V4" />
      <path d="M19 20v-7" />
    </svg>
  )
}

export function TrendsIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 15 10 9l4 4 6-7" />
    </svg>
  )
}

export function RulesIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 5h16" />
      <path d="M4 12h10" />
      <path d="M4 19h6" />
      <circle cx="18" cy="12" r="2" />
      <circle cx="15" cy="19" r="2" />
    </svg>
  )
}

export function SearchIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

export function MenuIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  )
}

export function CollapseIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M9 4v16" />
      <path d="m15 9-3 3 3 3" />
      <rect x="3" y="4" width="18" height="16" rx="2" />
    </svg>
  )
}
