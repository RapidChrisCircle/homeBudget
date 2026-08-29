import { Link } from 'react-router-dom'
import Amount from '../Amount.jsx'

// The Dashboard's Monthly Summary card, unchanged - re-hosted as a widget.
// `report` is the same GET /reports/monthly?months=1 response the page has
// always fetched. The month shown is the most recent one WITH data, not
// necessarily the current calendar month, which is why widgetRegistry.jsx
// still folds report.label into this widget's OWN title (via getTitle) -
// a fixed "Summary" heading would silently stop saying which month.
export default function SummaryWidget({ report }) {
  const { summary } = report

  return (
    <>
      <table>
        <caption className="visually-hidden">Monthly summary</caption>
        <tbody>
          <tr>
            <th scope="row">Total income</th>
            <td><Amount value={summary.total_income} neutral /></td>
          </tr>
          <tr>
            <th scope="row">Total spending</th>
            <td><Amount value={summary.total_spending} neutral /></td>
          </tr>
          <tr>
            <th scope="row">Net saved</th>
            <td><Amount value={summary.net_saved} /></td>
          </tr>
        </tbody>
      </table>
      <Link to="/reports">See full report</Link>
    </>
  )
}
