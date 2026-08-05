// Formatting helpers shared across the ledger, account, report and dashboard
// pages. Each of these was previously copied per page; they live here so a
// change to how money or dates render happens once.

export function formatAmount(value) {
  if (value === null || value === undefined) {
    return ''
  }
  return Number(value).toFixed(2)
}

// Shortens a transaction_date/first_date/last_date ('YYYY-MM-DD') to
// DD/MM/YY for narrow table columns - the ledger's own built-in CSV format
// already uses DD/MM/YYYY, so this keeps the same day-first convention
// rather than inventing a new one. Pure string slicing, deliberately NOT
// `new Date(iso)` - that parses as UTC midnight, which renders as the
// PREVIOUS day in any timezone behind UTC (see lastInclusiveDay below,
// which hits the same hazard and works around it with Date.UTC arithmetic
// for the same reason). A plain 'YYYY-MM-DD' string never needs a Date
// object just to be re-ordered.
export function formatDate(isoDate) {
  if (!isoDate) {
    return ''
  }
  const [year, month, day] = isoDate.split('-')
  return `${day}/${month}/${year.slice(2)}`
}

// The ledger stores a transaction as debit XOR credit, never both, never
// neither - services/csv_import.py rejects a row with both populated
// ("row has both Debit and Credit populated") and a row with neither
// ("row has neither Debit nor Credit populated") outright at import time,
// and single-amount-column mode splits by sign into exactly one of the
// two. Collapsing them to one signed value is therefore lossless, not a
// display compromise - whichever of the two is set already carries the
// correct sign (debits negative, credits positive), so <Amount> colours
// the merged value exactly as it would have coloured whichever original
// column actually held it.
export function transactionAmount(transaction) {
  return transaction.debit ?? transaction.credit
}

// Renders an account's current balance, or a distinct message when it has
// none. A null balance means "no transactions yet" - it is NOT 0.00, which is
// a real balance, and the two must never render the same.
export function formatBalance(account) {
  if (account.balance === null || account.balance === undefined) {
    return 'No transactions yet'
  }
  return `${formatAmount(account.balance)} (as of ${account.balance_as_of})`
}

// A report's end_date is EXCLUSIVE (reporting.py's half-open [start, end)
// convention), but the ledger's date_to filter is INCLUSIVE - so any deep
// link from a report into the ledger needs the last actual day of the month,
// not the report's end_date itself. Done with Date.UTC arithmetic so a local
// timezone behind UTC can't shift the result a day.
export function lastInclusiveDay(exclusiveEndDate) {
  const [year, month, day] = exclusiveEndDate.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

// The ledger URL a report's "review uncategorized" link should point at:
// that month's uncategorized rows, with the exclusive end date converted.
export function uncategorizedLedgerLink(startDate, exclusiveEndDate) {
  return `/transactions?uncategorized=true&date_from=${startDate}&date_to=${lastInclusiveDay(exclusiveEndDate)}`
}

// The ledger URL a recurring series' "view in ledger" link should point at.
// Deliberately searches on `merchant` (the text before the padding, e.g.
// "RED ENERGY") rather than the series' narration_key - the key has digit
// runs stripped out of the middle, which is not always a valid substring of
// the real narration and would not reliably match.
export function recurringLedgerLink(accountId, merchant) {
  return `/transactions?account_id=${accountId}&search=${encodeURIComponent(merchant)}`
}
