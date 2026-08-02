import Card from './Card.jsx'

// The ledger filter form, shared by the transactions page and the account
// detail page. Filters apply on an explicit button rather than on every
// keystroke - the codebase has no debounce machinery and shouldn't grow any
// for this.
//
// `accounts` is optional: the account detail page omits it because the
// account is implicit from the route, and that is the only structural
// difference between the two filter surfaces.
export default function LedgerFilters({
  values,
  onFieldChange,
  onApply,
  onClear,
  categories = [],
  transactionTypes = [],
  accounts = null,
}) {
  return (
    <Card id="ledger-filters" title="Filters">
      <form onSubmit={onApply}>
        <div className="filter-grid">
          {accounts && (
            <div>
              <label>
                Account
                <select value={values.account_id} onChange={onFieldChange('account_id')}>
                  <option value="">All accounts</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <div>
            <label>
              Category
              <select value={values.category} onChange={onFieldChange('category')}>
                <option value="">All categories</option>
                <option value="uncategorized">Uncategorized only</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <label>
              From date
              <input type="date" value={values.date_from} onChange={onFieldChange('date_from')} />
            </label>
          </div>
          <div>
            <label>
              To date
              <input type="date" value={values.date_to} onChange={onFieldChange('date_to')} />
            </label>
          </div>
          <div>
            <label>
              Narration contains
              <input type="text" value={values.search} onChange={onFieldChange('search')} />
            </label>
          </div>
          <div>
            <label>
              Type
              <select value={values.transaction_type} onChange={onFieldChange('transaction_type')}>
                <option value="">Any type</option>
                {transactionTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <label>
              Min amount
              <input
                type="number"
                step="0.01"
                min="0"
                value={values.min_amount}
                onChange={onFieldChange('min_amount')}
              />
            </label>
          </div>
          <div>
            <label>
              Max amount
              <input
                type="number"
                step="0.01"
                min="0"
                value={values.max_amount}
                onChange={onFieldChange('max_amount')}
              />
            </label>
          </div>
        </div>
        <div className="filter-actions">
          <button type="submit" className="button-primary">Apply filters</button>
          <button type="button" onClick={onClear}>
            Clear filters
          </button>
        </div>
      </form>
    </Card>
  )
}
