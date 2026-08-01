import { formatAmount } from '../utils/format.js'

// Renders a money value with tabular numerals (so a column of amounts
// actually lines up) and sign-aware colour. Wraps formatAmount() rather than
// replacing it - chart tick labels and <title> hover text still need the
// raw string, not an element.
//
// Colour follows the sign because this app's own convention already does:
// debits are stored negative, credits positive, and the same holds for
// derived figures (a negative "difference" means over budget, a negative
// forecast change means the balance is falling). `neutral` opts a column
// out where "positive" isn't really "good" - a standing budget amount, say.
export default function Amount({ value, neutral = false, className = '' }) {
  const text = formatAmount(value)
  const numeric = value === null || value === undefined ? null : Number(value)

  let signClass = ''
  if (!neutral && numeric !== null && Number.isFinite(numeric)) {
    if (numeric < 0) signClass = 'amount-negative'
    else if (numeric > 0) signClass = 'amount-positive'
  }

  return <span className={['amount', signClass, className].filter(Boolean).join(' ')}>{text}</span>
}
