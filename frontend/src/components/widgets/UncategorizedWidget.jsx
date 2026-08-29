import { Link } from 'react-router-dom'
import Amount from '../Amount.jsx'
import { uncategorizedLedgerLink } from '../../utils/format.js'

// The Dashboard's Uncategorized card, unchanged - re-hosted as a widget.
// `report` is the same GET /reports/monthly?months=1 response the page has
// always fetched.
export default function UncategorizedWidget({ report }) {
  const { uncategorized } = report

  return (
    <>
      <p>
        {uncategorized.uncategorized_count} of {uncategorized.transaction_count} transaction(s) this
        month are uncategorized (net <Amount value={uncategorized.net_total} />). They are excluded from
        the summary above.
      </p>
      <Link to={uncategorizedLedgerLink(report.start_date, report.end_date)}>
        Review uncategorized transactions
      </Link>
    </>
  )
}
