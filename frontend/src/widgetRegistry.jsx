import AccountsWidget from './components/widgets/AccountsWidget.jsx'
import CashFlowWidget from './components/widgets/CashFlowWidget.jsx'
import ComparisonSparklineWidget, { COMPARISON_BASES } from './components/widgets/ComparisonSparklineWidget.jsx'
import GoalsWidget from './components/widgets/GoalsWidget.jsx'
import NeedsAttentionWidget from './components/widgets/NeedsAttentionWidget.jsx'
import NetWorthChange from './components/widgets/NetWorthChange.jsx'
import NetWorthChartWidget from './components/widgets/NetWorthChartWidget.jsx'
import RecentActivityWidget from './components/widgets/RecentActivityWidget.jsx'
import RecurringWidget from './components/widgets/RecurringWidget.jsx'
import StatTileWidget, { STAT_TILE_METRICS, statTileLabel } from './components/widgets/StatTileWidget.jsx'
import SummaryWidget from './components/widgets/SummaryWidget.jsx'
import TransactionCalendarWidget from './components/widgets/TransactionCalendarWidget.jsx'
import UncategorizedWidget from './components/widgets/UncategorizedWidget.jsx'
import { monthBounds } from './utils/trendsSeries.js'

// Single source of truth for what a Dashboard widget IS - mirrors
// pageRegistry.jsx's own "one entry, wired in everywhere" idiom. Every
// widget_type DashboardPage can render is here, and only here; adding one
// is one entry in this file plus one component under components/widgets/.
//
// DashboardPage owns ALL data fetching for widgets that read from data it
// already fetches for its own always-on sections (accounts, report,
// trends, netWorth, goals, recent, recurring, kpis) - see its own comment
// on why one shared fetch per data source, not one per widget instance,
// mirrors the same "no dashboard-specific endpoint" principle the page
// has always followed. Only the two widgets with a genuinely per-instance
// window (transaction_calendar, comparison_sparkline) fetch their own data
// - see their own components' docstrings.
//
// `bare: true` means the widget supplies its own label/framing (StatTile's
// own heading text) and should NOT be wrapped in the standard <Card
// title>; every other widget_type renders inside one.
export const WIDGET_TYPES = {
  stat_tile: {
    // The generic "Add new widget" name - distinct from getTitle, which is
    // the specific INSTANCE's own title once a metric is actually chosen.
    label: 'Stat Tile',
    getTitle: (config) => statTileLabel(config?.metric),
    bare: true,
    Component: StatTileWidget,
    getProps: (config, data) => ({ config, kpis: data.kpis, navigate: data.navigate }),
    defaultWidth: 'quarter',
    configFields: [{ key: 'metric', label: 'Metric', type: 'select', options: STAT_TILE_METRICS, optionLabel: statTileLabel }],
  },
  net_worth_change: {
    label: 'Net Worth Change',
    getTitle: () => 'Net Worth Change',
    bare: true,
    Component: NetWorthChange,
    getProps: (config, data) => {
      const balances = data.trends?.balances || []
      const periods = data.trends?.periods || []
      const windowLabel = periods.length > 0 ? `${periods[0].label} - ${periods[periods.length - 1].label}` : ''
      return {
        balances,
        windowLabel,
        onClick: periods.length > 0 ? () => {
          const { from } = monthBounds(periods[0].label)
          const { to } = monthBounds(periods[periods.length - 1].label)
          data.navigate(`/transactions?date_from=${from}&date_to=${to}`)
        } : null,
      }
    },
    defaultWidth: 'quarter',
    configFields: [],
  },
  cash_flow: {
    label: 'Cash Flow',
    getTitle: () => 'Cash Flow',
    Component: CashFlowWidget,
    getProps: (config, data) => ({ trends: data.trends, monthlyTrend: data.trends?.monthly || [], navigate: data.navigate }),
    defaultWidth: 'half',
    configFields: [],
  },
  net_worth_chart: {
    label: 'Net Worth',
    getTitle: () => 'Net Worth',
    Component: NetWorthChartWidget,
    getProps: (config, data) => ({ balanceHistory: data.trends?.balances || [], navigate: data.navigate }),
    defaultWidth: 'half',
    configFields: [],
  },
  transaction_calendar: {
    label: 'Transaction Calendar',
    getTitle: () => 'Transaction Calendar',
    Component: TransactionCalendarWidget,
    getProps: (config, data) => ({ config, navigate: data.navigate }),
    defaultWidth: 'full',
    configFields: [{ key: 'months', label: 'Months', type: 'number', min: 1, max: 6 }],
  },
  comparison_sparkline: {
    label: 'Spending Pace',
    getTitle: () => 'Spending Pace',
    Component: ComparisonSparklineWidget,
    getProps: (config, data) => ({ config, navigate: data.navigate }),
    defaultWidth: 'half',
    configFields: [{ key: 'comparisonBasis', label: 'Compare against', type: 'select', options: COMPARISON_BASES }],
  },
  accounts: {
    label: 'Accounts',
    getTitle: () => 'Accounts',
    Component: AccountsWidget,
    getProps: (config, data) => ({ accounts: data.accounts, netWorth: data.netWorth }),
    defaultWidth: 'half',
    configFields: [],
  },
  goals: {
    label: 'Goals',
    getTitle: () => 'Goals',
    Component: GoalsWidget,
    getProps: (config, data) => ({ goals: data.goals, overAllocatedAccounts: data.overAllocatedAccounts }),
    defaultWidth: 'half',
    configFields: [],
  },
  summary: {
    label: 'Summary',
    // The month shown is the most recent one WITH data, not necessarily
    // the current calendar month - the title has to say which.
    getTitle: (config, data) => (data.report ? `Summary — ${data.report.label}` : 'Summary'),
    Component: SummaryWidget,
    getProps: (config, data) => ({ report: data.report }),
    defaultWidth: 'half',
    configFields: [],
  },
  needs_attention: {
    label: 'Needs Attention',
    getTitle: () => 'Needs Attention',
    Component: NeedsAttentionWidget,
    getProps: (config, data) => ({ report: data.report }),
    defaultWidth: 'half',
    configFields: [],
  },
  recurring: {
    label: 'Recurring',
    getTitle: () => 'Recurring',
    Component: RecurringWidget,
    getProps: (config, data) => ({
      series: data.recurringSeries, summary: data.recurringSummary, asOf: data.recurringAsOf,
    }),
    defaultWidth: 'half',
    configFields: [],
  },
  uncategorized: {
    label: 'Uncategorized',
    getTitle: () => 'Uncategorized',
    Component: UncategorizedWidget,
    getProps: (config, data) => ({ report: data.report }),
    defaultWidth: 'half',
    configFields: [],
  },
  recent_activity: {
    label: 'Recent Activity',
    getTitle: () => 'Recent Activity',
    Component: RecentActivityWidget,
    getProps: (config, data) => ({ recent: data.recent }),
    defaultWidth: 'full',
    configFields: [],
  },
}

export const WIDGET_TYPE_KEYS = Object.keys(WIDGET_TYPES)

export const WIDGET_WIDTHS = ['quarter', 'half', 'full']

// The generic name for a widget_type, independent of any instance's own
// config/data - what the "Add new widget" form lists. Distinct from a
// registry entry's own getTitle, which is what a REAL instance's Card
// title shows once it has real config and data (Summary's own month,
// a stat_tile's own chosen metric).
export function widgetTypeLabel(widgetType) {
  return WIDGET_TYPES[widgetType]?.label || widgetType
}
