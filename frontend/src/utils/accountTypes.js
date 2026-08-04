// Mirrors backend/app/models.py's ACCOUNT_TYPES / ACCOUNT_CLASSES - kept in
// sync by hand, the same way this app's few other shared enums (category
// kinds, csv amount modes) are. accountClass drives which side of the
// Dashboard's net worth split an account counts toward, and which types
// even offer the balance-sign toggle (only liabilities have a real
// ambiguity to resolve - see services/net_worth.py).
export const ACCOUNT_TYPE_OPTIONS = [
  { value: 'everyday', label: 'Everyday', accountClass: 'asset' },
  { value: 'savings', label: 'Savings', accountClass: 'asset' },
  { value: 'investment', label: 'Investment', accountClass: 'asset' },
  { value: 'credit_card', label: 'Credit Card', accountClass: 'liability' },
  { value: 'loan', label: 'Loan', accountClass: 'liability' },
  { value: 'mortgage', label: 'Mortgage', accountClass: 'liability' },
]

const OPTIONS_BY_VALUE = Object.fromEntries(ACCOUNT_TYPE_OPTIONS.map((option) => [option.value, option]))

export function accountTypeLabel(accountType) {
  return OPTIONS_BY_VALUE[accountType]?.label || 'Unclassified'
}

export function accountClassFor(accountType) {
  return OPTIONS_BY_VALUE[accountType]?.accountClass || null
}

export function isLiabilityType(accountType) {
  return accountClassFor(accountType) === 'liability'
}
