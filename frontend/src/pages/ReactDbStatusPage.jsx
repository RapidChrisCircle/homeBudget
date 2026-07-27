import { useEffect, useState } from 'react'
import { api } from '../services/api'

export default function ReactDbStatusPage() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    const loadStatus = async () => {
      setLoading(true)
      setError('')

      try {
        const response = await api.get('/status')

        if (!cancelled) {
          setData(response.data)
        }
      } catch (err) {
        if (!cancelled) {
          const message = err?.response?.data?.detail || err?.message || 'Unknown error'
          setError(String(message))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadStatus()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section className="card">
      <h2>React DB Verification</h2>
      <p>This page performs a read-only call to /api/status.</p>

      {loading && <p>Loading database status...</p>}

      {!loading && error && (
        <p>
          <strong>DB/API check failed:</strong> {error}
        </p>
      )}

      {!loading && !error && data && (
        <ul>
          <li>DB read: OK</li>
          <li>ID: {String(data.id)}</li>
          <li>Message: {String(data.message)}</li>
        </ul>
      )}
    </section>
  )
}
