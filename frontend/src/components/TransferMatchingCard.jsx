import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Amount from './Amount.jsx'
import Badge from './Badge.jsx'
import Card from './Card.jsx'
import ErrorState from './ErrorState.jsx'
import LoadingState from './LoadingState.jsx'
import { api } from '../services/api'
import { formatDate, transactionIdsLedgerLink } from '../utils/format.js'

// Finding 5: each leg of a transfer is categorized independently, and
// nothing before this confirmed the two legs actually correspond to each
// other - one mis-categorized leg silently inflates both spending and
// income. Matching itself lives in backend/app/services/transfer_
// matching.py; this only SURFACES what it found - it never changes a
// transaction's own category, the same "surface it, don't guess" posture
// as balance-sign inference. Self-fetching (like CommandPalette) so it can
// sit on the ledger without the already-large TransactionsPage owning yet
// another piece of state.
//
// Finding 22 (T5.2): surfacing used to be all this card did - zero links,
// zero buttons, nothing telling a household what to actually DO. Every row
// now links straight into the ledger, scoped to exactly the transactions
// it's talking about (the `transaction_ids` filter, T5.1) - not an inline
// fix, since the user's own call was to link into the ledger and let the
// existing category controls there do the work, not duplicate them here.
export default function TransferMatchingCard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    api.get('/transfers')
      .then((response) => {
        if (!cancelled) {
          setData(response.data)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const message = err?.response?.data?.detail || err?.message || 'Unknown error'
          setError(String(message))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  // Only the two cases worth a household's attention - a confirmed,
  // correctly-categorized pair is not shown, the same way NeedsAttentionWidget
  // only lists over-budget categories rather than every budget line.
  const mismatched = (data?.matches ?? []).filter((match) => !match.both_categorized_as_transfer)
  const unmatched = data?.unmatched ?? []

  return (
    <Card id="transactions-transfer-matching" title="Transfer Matching">
      {loading && <LoadingState message="Loading transfer matches..." />}
      {!loading && error && <ErrorState label="Failed to load transfer matches:" message={error} />}
      {!loading && !error && data && (
        <>
          {mismatched.length === 0 && unmatched.length === 0 && (
            <p>Every transfer looks correctly matched and categorized.</p>
          )}

          {mismatched.length > 0 && (
            <>
              <h4>Looks like a transfer, but isn&rsquo;t fully categorized as one</h4>
              <p>
                Matched by amount and date, not narration &mdash; one or both legs aren&rsquo;t
                categorized as a transfer, which would otherwise inflate spending and income by
                the same amount. <strong>To fix:</strong> give the flagged leg (or both) a
                Transfer-kind category &mdash; or if this pair genuinely isn&rsquo;t a transfer,
                leave it as it is.
              </p>
              <table>
                <caption className="visually-hidden">Candidate transfer pairs with mismatched categorization</caption>
                <thead>
                  <tr>
                    <th scope="col">Leg A</th>
                    <th scope="col">Leg B</th>
                    <th scope="col" className="numeric">Amount</th>
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  {mismatched.map((match) => (
                    <tr key={`${match.leg_a_id}-${match.leg_b_id}`}>
                      <td>
                        {match.leg_a_account_name} &middot; {formatDate(match.leg_a_date)}
                        {!match.leg_a_is_transfer && (
                          <Badge tone="danger" title="Not categorized as a transfer">
                            {' '}{match.leg_a_category_name || 'Uncategorized'}
                          </Badge>
                        )}
                      </td>
                      <td>
                        {match.leg_b_account_name} &middot; {formatDate(match.leg_b_date)}
                        {!match.leg_b_is_transfer && (
                          <Badge tone="danger" title="Not categorized as a transfer">
                            {' '}{match.leg_b_category_name || 'Uncategorized'}
                          </Badge>
                        )}
                      </td>
                      <td><Amount value={match.amount} neutral /></td>
                      <td>
                        <Link to={transactionIdsLedgerLink([match.leg_a_id, match.leg_b_id])}>
                          View in ledger
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {unmatched.length > 0 && (
            <>
              <h4>Unmatched transfers</h4>
              <p>
                Categorized as a transfer, but no matching opposite leg was found in another
                account. Three things can cause this, each with a different fix: the other side
                hasn&rsquo;t been imported yet (import it and this will resolve itself); this
                one isn&rsquo;t really a transfer (give it a real category instead); or the
                counterpart exists but couldn&rsquo;t be matched &mdash; it&rsquo;s split, its
                account isn&rsquo;t linked, it landed more than a few days apart, or the amount
                doesn&rsquo;t exactly match (a fee took a slice).
              </p>
              <table>
                <caption className="visually-hidden">Transfer-categorized transactions with no matching leg</caption>
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">Date</th>
                    <th scope="col">Narration</th>
                    <th scope="col" className="numeric">Amount</th>
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  {unmatched.map((leg) => (
                    <tr key={leg.transaction_id}>
                      <td>{leg.account_name}</td>
                      <td>{formatDate(leg.transaction_date)}</td>
                      <td>{leg.narration}</td>
                      <td><Amount value={leg.amount} /></td>
                      <td>
                        <Link to={transactionIdsLedgerLink([leg.transaction_id])}>
                          View in ledger
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </Card>
  )
}
