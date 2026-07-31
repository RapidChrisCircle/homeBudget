// Formatting helpers shared across the ledger, account, report and dashboard
// pages. Each of these was previously copied per page; they live here so a
// change to how money or dates render happens once.

export function formatAmount(value) {
  if (value === null || value === undefined) {
    return ''
  }
  return Number(value).toFixed(2)
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
