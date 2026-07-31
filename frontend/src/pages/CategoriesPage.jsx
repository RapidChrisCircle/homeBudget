import { useEffect, useState } from 'react'
import { api } from '../services/api'

export default function CategoriesPage() {
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)

  const refresh = async () => {
    const response = await api.get('/categories')
    setCategories(response.data)
  }

  useEffect(() => {
    let cancelled = false

    setLoading(true)
    setError('')

    refresh()
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

  const cancelEdit = () => {
    setEditingId(null)
    setName('')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    setActionError('')
    setSaving(true)

    try {
      if (editingId) {
        await api.put(`/categories/${editingId}`, { name })
      } else {
        await api.post('/categories', { name })
      }
      cancelEdit()
      await refresh()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Save failed'
      setActionError(String(message))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this category? Transactions using it will become uncategorized.')) {
      return
    }
    setActionError('')
    try {
      await api.delete(`/categories/${id}`)
      if (editingId === id) {
        cancelEdit()
      }
      await refresh()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Delete failed'
      setActionError(String(message))
    }
  }

  return (
    <section className="card">
      <h2>Categories</h2>

      {actionError && (
        <p>
          <strong>Action failed:</strong> {actionError}
        </p>
      )}

      <div className="card">
        <h3>{editingId ? 'Edit Category' : 'Add Category'}</h3>
        <form onSubmit={handleSubmit}>
          <label>
            Name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <button type="submit" disabled={saving}>
            {editingId ? 'Save Changes' : 'Add Category'}
          </button>
          {editingId && (
            <button type="button" onClick={cancelEdit} disabled={saving}>
              Cancel
            </button>
          )}
        </form>
      </div>

      <div className="card">
        <h3>All Categories</h3>

        {loading && <p>Loading categories...</p>}
        {!loading && error && (
          <p>
            <strong>Failed to load categories:</strong> {error}
          </p>
        )}

        {!loading && !error && (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category.id}>
                  <td>{category.name}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(category.id)
                        setName(category.name)
                      }}
                    >
                      Edit
                    </button>
                    <button type="button" onClick={() => handleDelete(category.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
