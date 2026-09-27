// Turns a /reports/monthly response into a plain-language read of the
// month (T4.2) - a pure function, deliberately: money resolution and the
// "no data is not zero" rules stay in the backend (has_prior_period_data,
// prior_summary, top_movers all come from there, none re-derived here),
// and this only decides WORDING and ORDER, kept as a flat array of typed
// segments rather than JSX so it's testable with no DOM and no React.
//
// DashboardNarrative.jsx is the only thing that turns a segment into an
// actual node - a 'text' segment is a plain string, 'amount' becomes
// <Amount value neutral />, 'percent' a formatted string (via
// utils/format.formatPercent, imported here since it's equally pure),
// and 'link' becomes a react-router <Link>.
import { overBudgetLines } from './budgets.js'
import { formatPercent, lastInclusiveDay, uncategorizedLedgerLink } from './format.js'

function text(value) {
  return { type: 'text', text: value }
}

function amount(value) {
  return { type: 'amount', value }
}

function percent(value) {
  return { type: 'percent', value: formatPercent(value) }
}

function link(label, to) {
  return { type: 'link', text: label, to }
}

function categoryLedgerLink(categoryId, startDate, endDate) {
  return `/transactions?category_id=${categoryId}&date_from=${startDate}&date_to=${lastInclusiveDay(endDate)}`
}

// `report` is the exact GET /reports/monthly response (months=2), so
// there is nothing to reshape - a caller passes it straight through.
export function buildNarrative(report) {
  const segments = [text(`${report.label} — you've spent `), amount(report.summary.total_spending)]

  // "No data is not zero": has_prior_period_data is false on the earliest
  // month in the database (or any month with no real prior data at all) -
  // the comparison clause is omitted entirely rather than compared
  // against a phantom zero prior month, which would otherwise read as
  // "infinitely more than last month".
  if (report.has_prior_period_data && report.prior_summary) {
    const priorSpent = Number(report.prior_summary.total_spending)
    const currentSpent = Number(report.summary.total_spending)
    const delta = currentSpent - priorSpent
    const priorLabel = report.grid.periods[0].label

    if (priorSpent > 0) {
      segments.push(text(', '))
      segments.push(percent(Math.abs(delta) / priorSpent))
      segments.push(text(delta >= 0 ? ' more than ' : ' less than '))
      segments.push(text(`${priorLabel}.`))
    } else if (delta !== 0) {
      // A real prior month that genuinely had zero spending - there's no
      // percentage to express against a zero base, but the absolute
      // change is still real and worth saying.
      segments.push(text(', up from '))
      segments.push(amount(report.prior_summary.total_spending))
      segments.push(text(` in ${priorLabel}.`))
    } else {
      segments.push(text('.'))
    }
  } else {
    segments.push(text('.'))
  }

  // Top movers only make sense alongside a real prior period - without
  // one, "current" vs "prior" reduces to "current vs 0", which isn't a
  // move, it's just this month's only data point.
  if (report.has_prior_period_data && report.top_movers.length > 0) {
    const mover = report.top_movers[0]
    const verb = Number(mover.delta) >= 0 ? 'up' : 'down'

    segments.push(text(' '))
    segments.push(link(mover.category_name, categoryLedgerLink(mover.category_id, report.start_date, report.end_date)))
    segments.push(text(` is the biggest change, ${verb} `))
    segments.push(amount(Math.abs(Number(mover.delta))))
    segments.push(text('.'))
  }

  const overBudgetCount = overBudgetLines(report.budgets).length
  if (overBudgetCount > 0) {
    segments.push(text(' '))
    segments.push(link(
      `${overBudgetCount} ${overBudgetCount === 1 ? 'category is' : 'categories are'} over budget`,
      '/reports',
    ))
    segments.push(text('.'))
  }

  if (report.uncategorized.uncategorized_count > 0) {
    const count = report.uncategorized.uncategorized_count
    segments.push(text(' '))
    segments.push(link(
      `${count} transaction${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} a category`,
      uncategorizedLedgerLink(report.start_date, report.end_date),
    ))
    segments.push(text('.'))
  }

  return segments
}
