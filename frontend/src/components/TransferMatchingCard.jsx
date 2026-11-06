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
// matching.py; this card surfaces candidate pairs and unmatched transfer legs.
//
// Users can review and acknowledge confirmed pairs to hide them from screen,
// or edit narration and acknowledge unmatched transfers so they are dismissed.
export default function TransferMatchingCard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [acknowledgingKey, setAcknowledgingKey] = useState(null)
  const [editingNarrationId, setEditingNarrationId] = useState(null)
  const [narrationDraft, setNarrationDraft] = useState('')
  const [savingNarrationId, setSavingNarrationId] = useState(null)
  const [showAcknowledged, setShowAcknowledged] = useState(false)

  const fetchTransfers = async (cancelledRef) => {
    try {
      const response = await api.get('/transfers')
      if (!cancelledRef?.current) {
        setData(response.data)
      }
    } catch (err) {
      if (!cancelledRef?.current) {
        const message = err?.response?.data?.detail || err?.message || 'Unknown error'
        setError(String(message))
      }
    } finally {
      if (!cancelledRef?.current) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    const cancelledRef = { current: false }
    fetchTransfers(cancelledRef)
    return () => {
      cancelledRef.current = true
    }
  }, [])

  const handleAcknowledgePair = async (legAId, legBId) => {
    const key = `pair:${legAId}:${legBId}`
    setAcknowledgingKey(key)
    setActionError('')
    setFeedbackMessage('')
    try {
      await api.post('/transfers/acknowledge', { leg_a_id: legAId, leg_b_id: legBId })
      setData((prev) => {
        if (!prev) return prev
        const match = prev.matches.find((m) => m.leg_a_id === legAId && m.leg_b_id === legBId)
        return {
          ...prev,
          matches: prev.matches.filter((m) => !(m.leg_a_id === legAId && m.leg_b_id === legBId)),
          acknowledged_matches: match
            ? [...(prev.acknowledged_matches || []), match]
            : (prev.acknowledged_matches || []),
        }
      })
      setFeedbackMessage('Transfer match acknowledged and hidden.')
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Failed to acknowledge transfer'
      setActionError(String(message))
    } finally {
      setAcknowledgingKey(null)
    }
  }

  const handleUnacknowledgePair = async (legAId, legBId) => {
    const key = `pair:${legAId}:${legBId}`
    setAcknowledgingKey(key)
    setActionError('')
    setFeedbackMessage('')
    try {
      await api.post('/transfers/unacknowledge', { leg_a_id: legAId, leg_b_id: legBId })
      setData((prev) => {
        if (!prev) return prev
        const match = prev.acknowledged_matches.find((m) => m.leg_a_id === legAId && m.leg_b_id === legBId)
        return {
          ...prev,
          matches: match ? [...(prev.matches || []), match] : (prev.matches || []),
          acknowledged_matches: prev.acknowledged_matches.filter(
            (m) => !(m.leg_a_id === legAId && m.leg_b_id === legBId)
          ),
        }
      })
      setFeedbackMessage('Transfer restored to active view.')
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Failed to restore transfer'
      setActionError(String(message))
    } finally {
      setAcknowledgingKey(null)
    }
  }

  const handleAcknowledgeUnmatched = async (transactionId) => {
    const key = `unmatched:${transactionId}`
    setAcknowledgingKey(key)
    setActionError('')
    setFeedbackMessage('')
    try {
      await api.post('/transfers/acknowledge', { transaction_id: transactionId })
      setData((prev) => {
        if (!prev) return prev
        const leg = prev.unmatched.find((u) => u.transaction_id === transactionId)
        return {
          ...prev,
          unmatched: prev.unmatched.filter((u) => u.transaction_id !== transactionId),
          acknowledged_unmatched: leg
            ? [...(prev.acknowledged_unmatched || []), leg]
            : (prev.acknowledged_unmatched || []),
        }
      })
      setFeedbackMessage('Unmatched transfer acknowledged and hidden.')
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Failed to acknowledge transfer'
      setActionError(String(message))
    } finally {
      setAcknowledgingKey(null)
    }
  }

  const handleUnacknowledgeUnmatched = async (transactionId) => {
    const key = `unmatched:${transactionId}`
    setAcknowledgingKey(key)
    setActionError('')
    setFeedbackMessage('')
    try {
      await api.post('/transfers/unacknowledge', { transaction_id: transactionId })
      setData((prev) => {
        if (!prev) return prev
        const leg = prev.acknowledged_unmatched.find((u) => u.transaction_id === transactionId)
        return {
          ...prev,
          unmatched: leg ? [...(prev.unmatched || []), leg] : (prev.unmatched || []),
          acknowledged_unmatched: prev.acknowledged_unmatched.filter(
            (u) => u.transaction_id !== transactionId
          ),
        }
      })
      setFeedbackMessage('Transfer restored to active view.')
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Failed to restore transfer'
      setActionError(String(message))
    } finally {
      setAcknowledgingKey(null)
    }
  }

  const handleSaveNarration = async (transactionId) => {
    const clean = narrationDraft.trim()
    if (!clean) return
    setSavingNarrationId(transactionId)
    setActionError('')
    setFeedbackMessage('')
    try {
      await api.patch(`/transactions/${transactionId}/narration`, { narration: clean })
      setData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          unmatched: prev.unmatched.map((u) =>
            u.transaction_id === transactionId ? { ...u, narration: clean } : u
          ),
          acknowledged_unmatched: (prev.acknowledged_unmatched || []).map((u) =>
            u.transaction_id === transactionId ? { ...u, narration: clean } : u
          ),
        }
      })
      setEditingNarrationId(null)
      setFeedbackMessage('Narration updated.')
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Failed to update narration'
      setActionError(String(message))
    } finally {
      setSavingNarrationId(null)
    }
  }

  // Candidate pairs where not both legs are categorized as transfers
  const mismatched = (data?.matches ?? []).filter((match) => !match.both_categorized_as_transfer)
  const unmatched = data?.unmatched ?? []
  const acknowledgedMatches = (data?.acknowledged_matches ?? []).filter(
    (match) => !match.both_categorized_as_transfer
  )
  const acknowledgedUnmatched = data?.acknowledged_unmatched ?? []
  const totalAcknowledged = acknowledgedMatches.length + acknowledgedUnmatched.length

  return (
    <Card id="transactions-transfer-matching" title="Transfer Matching">
      {loading && <LoadingState message="Loading transfer matches..." />}
      {!loading && error && <ErrorState label="Failed to load transfer matches:" message={error} />}
      {!loading && !error && data && (
        <>
          {actionError && <ErrorState label="Action failed:" message={actionError} />}
          {feedbackMessage && <p className="success-banner">{feedbackMessage}</p>}

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
                Transfer-kind category &mdash; or if this pair has been reviewed and confirmed,
                acknowledge it to hide it from this list.
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
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <Link to={transactionIdsLedgerLink([match.leg_a_id, match.leg_b_id])}>
                            View in ledger
                          </Link>
                          <button
                            type="button"
                            className="button secondary text-sm"
                            onClick={() => handleAcknowledgePair(match.leg_a_id, match.leg_b_id)}
                            disabled={acknowledgingKey === `pair:${match.leg_a_id}:${match.leg_b_id}`}
                          >
                            Acknowledge
                          </button>
                        </div>
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
                account. Add or edit a narration to record details, or acknowledge the transfer to
                hide it once reviewed.
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
                  {unmatched.map((leg) => {
                    const isEditing = editingNarrationId === leg.transaction_id
                    return (
                      <tr key={leg.transaction_id}>
                        <td>{leg.account_name}</td>
                        <td>{formatDate(leg.transaction_date)}</td>
                        <td>
                          {isEditing ? (
                            <span style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
                              <input
                                type="text"
                                value={narrationDraft}
                                onChange={(e) => setNarrationDraft(e.target.value)}
                                aria-label="Edit narration"
                                autoFocus
                              />
                              <button
                                type="button"
                                className="button text-sm"
                                onClick={() => handleSaveNarration(leg.transaction_id)}
                                disabled={savingNarrationId === leg.transaction_id || !narrationDraft.trim()}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="button secondary text-sm"
                                onClick={() => setEditingNarrationId(null)}
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <span>
                              {leg.narration}{' '}
                              <button
                                type="button"
                                className="button secondary text-sm"
                                aria-label={`Edit narration for ${leg.narration}`}
                                onClick={() => {
                                  setEditingNarrationId(leg.transaction_id)
                                  setNarrationDraft(leg.narration)
                                }}
                              >
                                Edit
                              </button>
                            </span>
                          )}
                        </td>
                        <td><Amount value={leg.amount} /></td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <Link to={transactionIdsLedgerLink([leg.transaction_id])}>
                              View in ledger
                            </Link>
                            <button
                              type="button"
                              className="button secondary text-sm"
                              onClick={() => handleAcknowledgeUnmatched(leg.transaction_id)}
                              disabled={acknowledgingKey === `unmatched:${leg.transaction_id}`}
                            >
                              Acknowledge
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}

          {totalAcknowledged > 0 && (
            <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
              <button
                type="button"
                className="button secondary text-sm"
                onClick={() => setShowAcknowledged((prev) => !prev)}
              >
                {showAcknowledged ? 'Hide' : 'Show'} acknowledged transfers ({totalAcknowledged})
              </button>

              {showAcknowledged && (
                <div style={{ marginTop: '0.75rem' }}>
                  {acknowledgedMatches.length > 0 && (
                    <>
                      <h5>Acknowledged transfer pairs</h5>
                      <table>
                        <thead>
                          <tr>
                            <th scope="col">Leg A</th>
                            <th scope="col">Leg B</th>
                            <th scope="col" className="numeric">Amount</th>
                            <th scope="col"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {acknowledgedMatches.map((match) => (
                            <tr key={`ack-${match.leg_a_id}-${match.leg_b_id}`}>
                              <td>{match.leg_a_account_name} &middot; {formatDate(match.leg_a_date)}</td>
                              <td>{match.leg_b_account_name} &middot; {formatDate(match.leg_b_date)}</td>
                              <td><Amount value={match.amount} neutral /></td>
                              <td>
                                <button
                                  type="button"
                                  className="button secondary text-sm"
                                  onClick={() => handleUnacknowledgePair(match.leg_a_id, match.leg_b_id)}
                                  disabled={acknowledgingKey === `pair:${match.leg_a_id}:${match.leg_b_id}`}
                                >
                                  Restore
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}

                  {acknowledgedUnmatched.length > 0 && (
                    <>
                      <h5>Acknowledged unmatched transfers</h5>
                      <table>
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
                          {acknowledgedUnmatched.map((leg) => (
                            <tr key={`ack-${leg.transaction_id}`}>
                              <td>{leg.account_name}</td>
                              <td>{formatDate(leg.transaction_date)}</td>
                              <td>{leg.narration}</td>
                              <td><Amount value={leg.amount} /></td>
                              <td>
                                <button
                                  type="button"
                                  className="button secondary text-sm"
                                  onClick={() => handleUnacknowledgeUnmatched(leg.transaction_id)}
                                  disabled={acknowledgingKey === `unmatched:${leg.transaction_id}`}
                                >
                                  Restore
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  )
}
