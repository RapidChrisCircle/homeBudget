// Shaping /trends' category data into the chart series the page draws, and
// the two levels its spending chart drills between. Kept out of
// TrendsPage.jsx so the shaping is unit-testable on its own - the page
// itself only decides what a click means.

// The category chart shows at most this many individual lines; everything
// else is summed into a single "Other" line rather than cluttering the
// chart - the Reports grid remains the complete, un-summarized view.
export const TOP_CATEGORY_LIMIT = 6

// The spending-by-category chart's two levels.
//
// Level 1 (groupId falsy) is the chart /trends always showed, except that a
// category belonging to a group is rolled up INTO that group rather than
// competing with its siblings for one of the six lines: "Food" as one line
// beats "Groceries", "Takeaway" and "Alcohol" as three, and a preset chart
// of accounts has enough leaves that the six-line limit otherwise buries
// most of the household's spending in "Other".
//
// Level 2 is one group's own children, same chart, same limit. There is no
// level 3 - categories are one level deep by construction (see the backend's
// Category.parent_id) - so a LEAF's drill target is the ledger instead.
// That is what each row's `drill` says: {kind: 'group', id} rolls the chart
// down a level, {kind: 'category', id} leaves for the filtered ledger.
export function buildLevel(periods, categories, groupId) {
  const expenses = categories.filter((c) => c.kind === 'expense')

  const asRow = (category) => {
    const total = Number(category.total)
    const transactionCount = Number(category.transaction_count ?? 0)
    const averageSpend =
      category.average_spend !== undefined && category.average_spend !== null
        ? Number(category.average_spend)
        : transactionCount > 0
          ? Number((total / transactionCount).toFixed(2))
          : 0

    return {
      label: category.category_name,
      amounts: Object.fromEntries(periods.map((p) => [p.label, Number(category.amounts[p.label])])),
      total,
      transaction_count: transactionCount,
      first_date: category.first_date || null,
      last_date: category.last_date || null,
      average_spend: averageSpend,
      drill: { kind: 'category', id: category.category_id },
    }
  }

  if (groupId) {
    return expenses.filter((c) => String(c.parent_id) === String(groupId)).map(asRow)
  }

  const rows = []
  const groupRows = new Map()

  for (const category of expenses) {
    if (!category.parent_id) {
      rows.push(asRow(category))
      continue
    }

    let group = groupRows.get(category.parent_id)

    if (!group) {
      group = {
        label: category.parent_name,
        amounts: Object.fromEntries(periods.map((p) => [p.label, 0])),
        total: 0,
        transaction_count: 0,
        first_date: null,
        last_date: null,
        average_spend: 0,
        drill: { kind: 'group', id: category.parent_id },
      }
      groupRows.set(category.parent_id, group)
      rows.push(group)
    }

    for (const period of periods) {
      group.amounts[period.label] += Number(category.amounts[period.label])
    }
    group.total += Number(category.total)
    group.transaction_count += Number(category.transaction_count ?? 0)
    if (category.first_date && (!group.first_date || category.first_date < group.first_date)) {
      group.first_date = category.first_date
    }
    if (category.last_date && (!group.last_date || category.last_date > group.last_date)) {
      group.last_date = category.last_date
    }
    group.average_spend =
      group.transaction_count > 0
        ? Number((group.total / group.transaction_count).toFixed(2))
        : 0
  }

  return rows
}

// One drillable series per row, plus a summed "Other" once there are more
// rows than lines. `rows` is already scoped to the level being shown, so
// this knows nothing about the hierarchy itself.
export function buildSeries(periods, rows) {
  const sorted = [...rows].sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
  const top = sorted.slice(0, TOP_CATEGORY_LIMIT)
  const rest = sorted.slice(TOP_CATEGORY_LIMIT)

  const series = top.map((row) => ({
    label: row.label,
    values: periods.map((p) => row.amounts[p.label]),
    drill: row.drill,
  }))

  if (rest.length > 0) {
    series.push({
      label: 'Other',
      values: periods.map((p) => rest.reduce((sum, row) => sum + row.amounts[p.label], 0)),
      // A sum of several categories has nothing to drill into - see
      // LineChart's own note on why a dead affordance is worse than none.
      selectable: false,
    })
  }

  return series
}

// The name of the group a drilled-in chart is showing, or null when the
// group isn't in this window's data at all (no activity in the window, or
// deleted since a drilled-in URL was shared). Null is what makes the page
// fall back to the top level rather than render an empty chart under a
// breadcrumb naming a group that isn't there.
export function drilledGroupName(categories, groupId) {
  if (!groupId) {
    return null
  }

  return categories.find((c) => String(c.parent_id) === String(groupId))?.parent_name || null
}

// The expense category a merchant drill-down is showing, or null when the
// category isn't in this window's data.
export function drilledCategory(categories, categoryId) {
  if (!categoryId) {
    return null
  }

  return categories.find((c) => c.kind === 'expense' && String(c.category_id) === String(categoryId)) || null
}

// The inclusive first/last day of a "YYYY-MM" period label, for a ledger
// date filter - the ledger's date bounds are inclusive on both ends (see
// components/ledgerFilterParams.js), unlike reporting's own half-open
// month bounds.
export function monthBounds(label) {
  const [year, month] = label.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()

  return { from: `${label}-01`, to: `${label}-${String(lastDay).padStart(2, '0')}` }
}
