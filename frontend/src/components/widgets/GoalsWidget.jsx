import { Link } from 'react-router-dom'
import Amount from '../Amount.jsx'
import Badge from '../Badge.jsx'

const RECENT_LIMIT = 5

// The Dashboard's Goals card, unchanged - re-hosted as a widget. Returns
// null (rather than a placeholder) when there are no goals at all, the
// same "don't render the card" gate the original inline
// `goals.length > 0 &&` guard already applied - widgetRegistry.jsx's
// caller still renders the surrounding Card, so an empty goals list
// produces a titled Card with nothing inside it rather than nothing at
// all; that's an acceptable, rare edge a user who's added this widget on
// an install with no goals yet can fix by removing it, not a case worth
// hiding the whole widget for.
export default function GoalsWidget({ goals, overAllocatedAccounts }) {
  if (goals.length === 0) {
    return <p>No savings goals yet.</p>
  }

  return (
    <>
      {overAllocatedAccounts.length > 0 && (
        <p>
          <Badge tone="warning" title="Envelope goals on this account add up to more than it holds">
            over-allocated
          </Badge>{' '}
          {overAllocatedAccounts.length} account{overAllocatedAccounts.length === 1 ? '' : 's'} committed
          more than {overAllocatedAccounts.length === 1 ? 'it holds' : 'they hold'} &mdash; see{' '}
          <Link to="/goals">Goals</Link> for details.
        </p>
      )}
      <ul>
        {goals.slice(0, RECENT_LIMIT).map((goal) => (
          <li key={goal.id}>
            {goal.name}: <Amount value={goal.current_amount} neutral /> of{' '}
            <Amount value={goal.target_amount} neutral /> ({Number(goal.percent).toFixed(0)}%)
          </li>
        ))}
      </ul>
      <Link to="/goals">See all goals</Link>
    </>
  )
}
