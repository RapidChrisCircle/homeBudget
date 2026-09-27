import { Link } from 'react-router-dom'
import Amount from './Amount.jsx'
import { buildNarrative } from '../utils/narrative.js'

// The Dashboard's plain-language read of the month (T4.2) - a fixed block
// above the widget grid, not a removable widget: a story the user can
// delete isn't the app telling it. All the interpretive work (what to say,
// in what order, and when to say nothing at all) already happened in the
// pure utils/narrative.buildNarrative - this only turns its segments into
// actual nodes, one <Amount> for money (so it reads exactly like every
// other money figure in the app) and one <Link> for each drill-down.
export default function DashboardNarrative({ report }) {
  const segments = buildNarrative(report)

  return (
    <p className="dashboard-narrative">
      {segments.map((segment, index) => {
        const key = `${segment.type}-${index}`

        if (segment.type === 'amount') {
          return <Amount key={key} value={segment.value} neutral />
        }

        if (segment.type === 'link') {
          return <Link key={key} to={segment.to}>{segment.text}</Link>
        }

        // 'percent' segments are already formatted (utils/format.formatPercent)
        // and 'text' segments are plain strings - both render as-is.
        return <span key={key}>{segment.text ?? segment.value}</span>
      })}
    </p>
  )
}
