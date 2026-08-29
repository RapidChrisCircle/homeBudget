import StatTile from './StatTile.jsx'
import { monthBounds } from '../../utils/trendsSeries.js'

// Maps a stat_tile widget's own config.metric to which GET /api/reports/kpis
// field it reads, its label/tone, and (when the metric corresponds to a
// real transaction kind) what a click drills into. avg_per_month and
// avg_per_transaction are both spend-rate figures (see
// services/dashboard_metrics.py's own docstring on why), so they drill the
// same way Total Expenses does.
const METRIC_META = {
  total_income: { label: 'Total Income', tone: 'income', kind: 'income', getValue: (k) => k.total_income },
  total_expenses: { label: 'Total Expenses', tone: 'expense', kind: 'expense', getValue: (k) => k.total_expenses },
  avg_per_month: { label: 'Avg Per Month', tone: 'expense', kind: 'expense', getValue: (k) => k.avg_per_month },
  avg_per_transaction: {
    label: 'Avg Per Transaction', tone: 'expense', kind: 'expense', getValue: (k) => k.avg_per_transaction,
  },
  net_saved: { label: 'Net Saved', tone: 'income', kind: null, getValue: (k) => k.net_saved },
  transaction_count: { label: 'Transactions', tone: 'neutral', kind: null, getValue: (k) => k.transaction_count },
}

export const STAT_TILE_METRICS = Object.keys(METRIC_META)

export function statTileLabel(metric) {
  return METRIC_META[metric]?.label || metric
}

// `kpis` is GET /api/reports/kpis' own response, fetched once by
// DashboardPage and shared by every stat_tile/net_worth_change widget on
// the page (see DashboardPage.jsx's own comment on why this is one shared
// fetch, not one per widget).
export default function StatTileWidget({ config, kpis, navigate }) {
  const metric = METRIC_META[config?.metric] || METRIC_META.total_income
  const value = kpis ? metric.getValue(kpis) : null
  const periods = kpis?.periods || []
  const windowLabel = periods.length > 0 ? `${periods[0].label} - ${periods[periods.length - 1].label}` : ''

  const handleClick = metric.kind && periods.length > 0
    ? () => {
        const { from } = monthBounds(periods[0].label)
        const { to } = monthBounds(periods[periods.length - 1].label)
        navigate(`/transactions?kind=${metric.kind}&date_from=${from}&date_to=${to}`)
      }
    : null

  return (
    <StatTile
      label={metric.label}
      value={value}
      period={windowLabel}
      tone={metric.tone}
      onClick={handleClick}
      clickLabel={handleClick ? `View ${metric.label.toLowerCase()} transactions` : null}
    />
  )
}
