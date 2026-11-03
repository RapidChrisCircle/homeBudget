import { useCallback, useEffect, useState } from 'react'
import Card from './Card.jsx'
import ErrorState from './ErrorState.jsx'
import { api } from '../services/api'

export default function MerchantNicknamesCard({ refreshToken, onChanged }) {
  const [nicknames, setNicknames] = useState([])
  const [error, setError] = useState('')
  const [newPattern, setNewPattern] = useState('')
  const [newNickname, setNewNickname] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingKey, setEditingKey] = useState(null)
  const [editingValue, setEditingValue] = useState('')

  const loadNicknames = useCallback(async () => {
    try {
      const response = await api.get('/merchants/nicknames')
      if (Array.isArray(response?.data)) {
        setNicknames(response.data)
      }
    } catch (err) {
      if (err?.response?.data?.detail) {
        setError(String(err.response.data.detail))
      }
    }
  }, [])

  useEffect(() => {
    loadNicknames()
  }, [loadNicknames, refreshToken])

  const handleAdd = async (event) => {
    event.preventDefault()
    if (!newPattern.trim() || !newNickname.trim()) {
      return
    }
    setError('')
    setSaving(true)
    try {
      await api.put('/merchants/nickname', {
        narration: newPattern.trim(),
        nickname: newNickname.trim(),
      })
      setNewPattern('')
      setNewNickname('')
      await loadNicknames()
      onChanged?.()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Failed to save merchant nickname'
      setError(String(message))
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (item) => {
    setEditingKey(item.narration_key)
    setEditingValue(item.nickname || '')
  }

  const cancelEdit = () => {
    setEditingKey(null)
    setEditingValue('')
  }

  const handleSaveEdit = async (item) => {
    setError('')
    setSaving(true)
    try {
      await api.put('/merchants/nickname', {
        narration_key: item.narration_key,
        nickname: editingValue.trim() || null,
      })
      cancelEdit()
      await loadNicknames()
      onChanged?.()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Failed to update merchant nickname'
      setError(String(message))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (item) => {
    setError('')
    try {
      if (item.id != null) {
        await api.delete(`/merchants/nicknames/${item.id}`)
      } else {
        await api.put('/merchants/nickname', {
          narration_key: item.narration_key,
          nickname: null,
        })
      }
      if (editingKey === item.narration_key) {
        cancelEdit()
      }
      await loadNicknames()
      onChanged?.()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Failed to delete merchant nickname'
      setError(String(message))
    }
  }

  return (
    <Card id="rules-merchant-nicknames" title="Merchant Nicknames">
      <p>
        Assign friendly display names to normalized bank merchant descriptions. Nicknames appear in
        the Ledger, Merchant Groups, and Trends merchant breakdown.
      </p>

      {error && <ErrorState label="Merchant nickname error:" message={error} />}

      <form onSubmit={handleAdd}>
        <div>
          <label>
            Merchant pattern
            <input
              type="text"
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              placeholder="e.g. WOOLWORTHS or UBER *EATS"
              required
            />
          </label>
        </div>
        <div>
          <label>
            Nickname
            <input
              type="text"
              value={newNickname}
              onChange={(e) => setNewNickname(e.target.value)}
              placeholder="e.g. Woolies"
              required
            />
          </label>
        </div>
        <button type="submit" className="button-primary" disabled={saving}>
          Add Nickname
        </button>
      </form>

      {nicknames.length === 0 ? (
        <p className="text-muted">No merchant nicknames configured yet.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <caption className="visually-hidden">Configured merchant nicknames</caption>
            <thead>
              <tr>
                <th scope="col">Nickname</th>
                <th scope="col">Merchant Pattern</th>
                <th scope="col" className="numeric">Matching Transactions</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {nicknames.map((item) => {
                const isEditing = editingKey === item.narration_key
                const label = item.merchant || item.narration_key

                return (
                  <tr key={item.narration_key}>
                    <td className="cell-wrap">
                      {isEditing ? (
                        <input
                          type="text"
                          aria-label={`Nickname for ${label}`}
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              handleSaveEdit(item)
                            } else if (e.key === 'Escape') {
                              cancelEdit()
                            }
                          }}
                        />
                      ) : (
                        <strong>{item.nickname}</strong>
                      )}
                    </td>
                    <td className="cell-wrap">
                      <code>{label}</code>
                      {item.sample_narration && item.sample_narration !== label && (
                        <span className="text-muted"> ({item.sample_narration})</span>
                      )}
                    </td>
                    <td className="numeric">{item.transaction_count ?? 0}</td>
                    <td>
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            className="button-primary"
                            onClick={() => handleSaveEdit(item)}
                            disabled={saving}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="button-ghost"
                            onClick={cancelEdit}
                            disabled={saving}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            aria-label={`Edit nickname for ${label}`}
                            onClick={() => startEdit(item)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="button-danger"
                            aria-label={`Delete nickname for ${label}`}
                            onClick={() => handleDelete(item)}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

