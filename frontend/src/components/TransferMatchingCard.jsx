import { useEffect, useState } from 'react'
import Amount from './Amount.jsx'
import Card from './Card.jsx'
import ErrorState from './ErrorState.jsx'
import LoadingState from './LoadingState.jsx'
import { api } from '../services/api'
import { formatDate } from '../utils/format.js'

// Finding 5: each leg of a transfer is categorized independently, and
// nothing before this confirmed the two legs actually correspond to each
// other - one mis-categorized leg silently inflates both spending and
// income. Matching itself lives in backend/app/services/transfer_
// matching.py; this only SURFACES what it found - it never changes a
// transaction's own category, the same "surface it, don't guess" posture
// as balance-sign inference. Self-fetching (like CommandPalette) so it can
// sit on the ledger without the already-large TransactionsPage owning yet
// another piece of state.
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
                the same amount.
              </p>
              <table>
                <caption className="visually-hidden">Candidate transfer pairs with mismatched categorization</caption>
                <thead>
                  <tr>
                    <th scope="col">Leg A</th>
                    <th scope="col">Leg B</th>
                    <th scope="col" className="numeric">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {mismatched.map((match) => (
                    <tr key={`${match.leg_a_id}-${match.leg_b_id}`}>
                      <td>{match.leg_a_account_name} &middot; {formatDate(match.leg_a_date)}</td>
                      <td>{match.leg_b_account_name} &middot; {formatDate(match.leg_b_date)}</td>
                      <td><Amount value={match.amount} neutral /></td>
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
                account &mdash; the other side may not have been imported yet, or this one may not
                really be a transfer.
              </p>
              <table>
                <caption className="visually-hidden">Transfer-categorized transactions with no matching leg</caption>
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">Date</th>
                    <th scope="col">Narration</th>
                    <th scope="col" className="numeric">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {unmatched.map((leg) => (
                    <tr key={leg.transaction_id}>
                      <td>{leg.account_name}</td>
                      <td>{formatDate(leg.transaction_date)}</td>
                      <td>{leg.narration}</td>
                      <td><Amount value={leg.amount} /></td>
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
