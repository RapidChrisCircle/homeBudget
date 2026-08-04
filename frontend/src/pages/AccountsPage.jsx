import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Card from '../components/Card.jsx'
import ErrorState from '../components/ErrorState.jsx'
import InlineEditRow from '../components/InlineEditRow.jsx'
import LoadingState from '../components/LoadingState.jsx'
import { api } from '../services/api'
import { ACCOUNT_TYPE_OPTIONS, accountTypeLabel, isLiabilityType } from '../utils/accountTypes.js'
import { formatBalance } from '../utils/format.js'

const ACCOUNTS_TABLE_COLUMN_COUNT = 7

const EMPTY_FORM = {
  name: '',
  institution: '',
  account_type: '',
  balance_sign: 'natural',
  bsb_number: '',
  account_number: '',
  group_id: '',
}

// Nests grouped accounts under their group's name, one section per group,
// plus a final "Ungrouped" section for the rest - the same shape
// CategoriesPage.buildCategorySections already established for parent/
// child categories. When nothing is grouped yet (the common case), this
// returns exactly the one flat section the page has always rendered, so an
// install that never uses groups sees no change at all.
function buildAccountSections(accounts) {
  const byGroupId = new Map()

  for (const account of accounts) {
    if (account.group_id) {
      const siblings = byGroupId.get(account.group_id) || []
      siblings.push(account)
      byGroupId.set(account.group_id, siblings)
    }
  }

  if (byGroupId.size === 0) {
    return [{ id: 'flat', heading: null, accounts }]
  }

  const ungrouped = accounts.filter((account) => !account.group_id)

  const sections = Array.from(byGroupId.entries()).map(([groupId, members]) => ({
    id: `group-${groupId}`,
    heading: members[0].group_name,
    accounts: members,
  }))

  if (ungrouped.length > 0) {
    sections.push({ id: 'ungrouped', heading: 'Ungrouped', accounts: ungrouped })
  }

  return sections
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  // A SUGGESTION only, fetched when editing an existing liability account -
  // never auto-applied to the form, see startEdit/handleUseInferredSign
  // below and services/net_worth.infer_balance_sign's own docstring.
  const [inference, setInference] = useState(null)
  const [inferenceLoading, setInferenceLoading] = useState(false)

  // Account groups - see AccountGroup in models.py. Independent async
  // state, same reasoning every other secondary card in this app uses: a
  // groups failure never blocks the accounts list itself.
  const [groups, setGroups] = useState([])
  const [groupsError, setGroupsError] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [renamingGroupId, setRenamingGroupId] = useState(null)
  const [renameGroupValue, setRenameGroupValue] = useState('')

  const refresh = async () => {
    const [accountsRes, groupsRes] = await Promise.all([
      api.get('/accounts'),
      api.get('/account-groups'),
    ])
    setAccounts(accountsRes.data)
    setGroups(groupsRes.data)
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

  const handleCreateGroup = async (event) => {
    event.preventDefault()
    if (!newGroupName.trim()) {
      return
    }
    setGroupsError('')
    setCreatingGroup(true)
    try {
      await api.post('/account-groups', { name: newGroupName.trim() })
      setNewGroupName('')
      await refresh()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Create failed'
      setGroupsError(String(message))
    } finally {
      setCreatingGroup(false)
    }
  }

  const startRenameGroup = (group) => {
    setRenamingGroupId(group.id)
    setRenameGroupValue(group.name)
  }

  const cancelRenameGroup = () => {
    setRenamingGroupId(null)
    setRenameGroupValue('')
  }

  const handleRenameGroup = async (event) => {
    event.preventDefault()
    if (!renameGroupValue.trim()) {
      return
    }
    setGroupsError('')
    try {
      await api.put(`/account-groups/${renamingGroupId}`, { name: renameGroupValue.trim() })
      cancelRenameGroup()
      await refresh()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Rename failed'
      setGroupsError(String(message))
    }
  }

  const handleDeleteGroup = async (groupId) => {
    if (!window.confirm('Delete this group? Its accounts are unlinked, not deleted.')) {
      return
    }
    setGroupsError('')
    try {
      await api.delete(`/account-groups/${groupId}`)
      await refresh()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Delete failed'
      setGroupsError(String(message))
    }
  }

  const handleFieldChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }))
  }

  const startEdit = (account) => {
    setEditingId(account.id)
    setInference(null)
    setForm({
      name: account.name,
      institution: account.institution || '',
      account_type: account.account_type || '',
      balance_sign: account.balance_sign || 'natural',
      bsb_number: account.bsb_number || '',
      account_number: account.account_number,
      group_id: account.group_id ? String(account.group_id) : '',
    })

    if (isLiabilityType(account.account_type)) {
      fetchInference(account.id)
    }
  }

  const fetchInference = async (accountId) => {
    setInferenceLoading(true)
    try {
      const response = await api.get(`/accounts/${accountId}/infer-balance-sign`)
      setInference(response.data)
    } catch {
      // The inference is a nice-to-have hint, not core functionality - a
      // failed fetch here just means no hint shows, it must not block
      // editing the account.
      setInference(null)
    } finally {
      setInferenceLoading(false)
    }
  }

  // Re-fetches the inference whenever editing an account and its type is
  // changed TO a liability type (e.g. classifying a previously-unclassified
  // account) - not just when the edit form first opens.
  const handleAccountTypeChange = (event) => {
    const nextType = event.target.value
    setForm((prev) => ({ ...prev, account_type: nextType }))
    setInference(null)
    if (editingId && isLiabilityType(nextType)) {
      fetchInference(editingId)
    }
  }

  const handleUseInferredSign = () => {
    if (inference?.inferred_sign) {
      setForm((prev) => ({ ...prev, balance_sign: inference.inferred_sign }))
    }
  }

  const cancelEdit = () => {
    setEditingId(null)
    setInference(null)
    setForm(EMPTY_FORM)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    setActionError('')
    setSaving(true)

    const payload = {
      name: form.name,
      institution: form.institution || null,
      account_type: form.account_type || null,
      // Only meaningful for a liability - sent regardless (the backend
      // defaults it the same way), so an asset's field just stays "natural".
      balance_sign: form.balance_sign,
      bsb_number: form.bsb_number || null,
      account_number: form.account_number,
      group_id: form.group_id ? Number(form.group_id) : null,
    }

    try {
      if (editingId) {
        await api.put(`/accounts/${editingId}`, payload)
      } else {
        await api.post('/accounts', payload)
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
    if (!window.confirm('Delete this account?')) {
      return
    }
    setActionError('')
    try {
      await api.delete(`/accounts/${id}`)
      if (editingId === id) {
        cancelEdit()
      }
      await refresh()
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Delete failed'
      setActionError(String(message))
    }
  }

  const renderFormFields = () => (
    <>
      <div>
        <label>
          Name
          <input type="text" value={form.name} onChange={handleFieldChange('name')} required />
        </label>
      </div>
      <div>
        <label>
          Institution
          <input type="text" value={form.institution} onChange={handleFieldChange('institution')} />
        </label>
      </div>
      <div>
        <label>
          Account Type
          <select value={form.account_type} onChange={handleAccountTypeChange}>
            <option value="">Unclassified</option>
            {ACCOUNT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p>
          Unclassified accounts are excluded from Net Worth on the Dashboard rather than
          guessed at.
        </p>
      </div>
      {isLiabilityType(form.account_type) && (
        <div>
          <label>
            Balance sign
            <select value={form.balance_sign} onChange={handleFieldChange('balance_sign')}>
              <option value="natural">Natural &mdash; debt shows as a negative balance</option>
              <option value="inverted">Inverted &mdash; debt shows as a positive amount owed</option>
            </select>
          </label>
          <p>
            This decides whether the balance this account reports SUBTRACTS from Net Worth
            correctly &mdash; different banks report a card or loan balance differently.
          </p>
          {inferenceLoading && <p>Checking this account&apos;s own history...</p>}
          {!inferenceLoading && inference?.inferred_sign && inference.sample_size > 0 && (
            <p>
              Inferred from {inference.sample_size} past balance{inference.sample_size === 1 ? '' : 's'}:{' '}
              <strong>{inference.inferred_sign}</strong>.{' '}
              {inference.inferred_sign !== form.balance_sign && (
                <button type="button" className="button-ghost" onClick={handleUseInferredSign}>
                  Use this
                </button>
              )}
            </p>
          )}
        </div>
      )}
      <div>
        <label>
          Group
          <select value={form.group_id} onChange={handleFieldChange('group_id')}>
            <option value="">No group</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <p>
          A group is a SUCCESSION, not a folder - e.g. a card and the replacement it was
          reissued as. Only the newest member whose first transaction has started counts
          toward Net Worth, so grouping two accounts used at the same time would leave only
          the newer one counted. Create a group below, in Account Groups.
        </p>
      </div>
      <div>
        <label>
          BSB Number
          <input type="text" value={form.bsb_number} onChange={handleFieldChange('bsb_number')} />
        </label>
      </div>
      <div>
        <label>
          Account Number
          <input
            type="text"
            value={form.account_number}
            onChange={handleFieldChange('account_number')}
            required
          />
        </label>
      </div>
    </>
  )

  const sections = buildAccountSections(accounts)

  const renderAccountsTable = (sectionAccounts) => (
    <table>
      <caption className="visually-hidden">Accounts</caption>
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Institution</th>
          <th scope="col">Type</th>
          <th scope="col">BSB</th>
          <th scope="col">Account Number</th>
          <th scope="col">Balance</th>
          <th scope="col"></th>
        </tr>
      </thead>
      <tbody>
        {sectionAccounts.map((account) => {
          const editId = `account-edit-${account.id}`
          const isEditing = editingId === account.id

          return (
            <Fragment key={account.id}>
              <tr>
                <td>
                  <Link to={`/accounts/${account.id}`}>{account.name}</Link>
                </td>
                <td>{account.institution}</td>
                <td>{accountTypeLabel(account.account_type)}</td>
                <td>{account.bsb_number}</td>
                <td>{account.account_number}</td>
                <td>{formatBalance(account)}</td>
                <td>
                  <button
                    type="button"
                    aria-expanded={isEditing}
                    aria-controls={editId}
                    onClick={() => startEdit(account)}
                  >
                    Edit
                  </button>
                  <button type="button" className="button-danger" onClick={() => handleDelete(account.id)}>
                    Delete
                  </button>
                </td>
              </tr>
              {isEditing && (
                <InlineEditRow
                  id={editId}
                  colSpan={ACCOUNTS_TABLE_COLUMN_COUNT}
                  onSubmit={handleSubmit}
                  onCancel={cancelEdit}
                  saving={saving}
                >
                  {renderFormFields()}
                </InlineEditRow>
              )}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )

  return (
    <section className="card">
      <h2>Accounts</h2>

      {actionError && (
        <p>
          <strong>Action failed:</strong> {actionError}
        </p>
      )}

      <Card id="accounts-form" title="Add Account">
        {editingId ? (
          <p>Finish editing the account below to add another.</p>
        ) : (
          <form onSubmit={handleSubmit}>
            {renderFormFields()}
            <button type="submit" className="button-primary" disabled={saving}>
              Add Account
            </button>
          </form>
        )}
      </Card>

      <Card id="accounts-list" title="All Accounts">
        {loading && <LoadingState message="Loading accounts..." />}
        {!loading && error && <ErrorState label="Failed to load accounts:" message={error} />}

        {!loading && !error && sections.map((section) => {
          const table = renderAccountsTable(section.accounts)

          // No groups exist anywhere yet - the exact flat table this page
          // has always rendered, with no extra wrapping card.
          if (!section.heading) {
            return <div key={section.id}>{table}</div>
          }

          return (
            <Card key={section.id} id={`accounts-${section.id}`} title={section.heading} level={4}>
              {table}
            </Card>
          )
        })}
      </Card>

      <Card id="account-groups" title="Account Groups">
        <p>
          A group is one logical account across a succession of physical ones - e.g. a card and
          its reissued replacement. It is not a folder: only the newest member whose first
          transaction has started counts toward Net Worth at any given time, so grouping two
          accounts used at the same time would leave only the newer one counted.
        </p>

        {groupsError && <ErrorState label="Action failed:" message={groupsError} />}

        <form onSubmit={handleCreateGroup}>
          <label>
            New group name
            <input
              type="text"
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              required
            />
          </label>
          <button type="submit" className="button-primary" disabled={creatingGroup}>
            Add Group
          </button>
        </form>

        {groups.length === 0 ? (
          <p>No groups yet.</p>
        ) : (
          <table>
            <caption className="visually-hidden">Account groups</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Members</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const memberCount = accounts.filter((account) => account.group_id === group.id).length
                const isRenaming = renamingGroupId === group.id

                return (
                  <tr key={group.id}>
                    <td>
                      {isRenaming ? (
                        <form onSubmit={handleRenameGroup}>
                          <label>
                            Rename {group.name}
                            <input
                              type="text"
                              value={renameGroupValue}
                              onChange={(event) => setRenameGroupValue(event.target.value)}
                              required
                              autoFocus
                            />
                          </label>
                          <button type="submit" className="button-primary">Save</button>
                          <button type="button" onClick={cancelRenameGroup}>Cancel</button>
                        </form>
                      ) : (
                        group.name
                      )}
                    </td>
                    <td>{memberCount}</td>
                    <td>
                      {!isRenaming && (
                        <>
                          <button type="button" onClick={() => startRenameGroup(group)}>
                            Rename
                          </button>
                          <button type="button" className="button-danger" onClick={() => handleDeleteGroup(group.id)}>
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
        )}
      </Card>
    </section>
  )
}
