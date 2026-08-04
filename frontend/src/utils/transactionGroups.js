// Formats what a merchant group (GET /transactions/groups, TransactionsPage's
// Group by merchant view) actually is, categorization-wise - the one thing
// that visibly changes when "Set category" is used, so a fix that flips the
// underlying data with nothing on screen reacting to it is worth guarding
// against with its own test.
//
// A split row is never counted toward uncategorized_count (see
// services/ledger.py's TransactionGroup docstring - it IS categorized, via
// its allocations) - it only ever shows up here as part of "Mixed".
export function groupCategorySummary(group) {
  const { category_names: categoryNames, uncategorized_count: uncategorizedCount, split_count: splitCount } = group

  if (categoryNames.length === 0 && splitCount === 0) {
    return `${uncategorizedCount} uncategorized`
  }

  if (categoryNames.length === 1 && uncategorizedCount === 0 && splitCount === 0) {
    return categoryNames[0]
  }

  return uncategorizedCount > 0 ? `Mixed · ${uncategorizedCount} uncategorized` : 'Mixed'
}
