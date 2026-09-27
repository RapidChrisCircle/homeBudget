// The one place "is this budget line over budget" is decided, so
// NeedsAttentionWidget and the Dashboard narrative (T4.2) can never
// quietly disagree about which categories count. `difference` is
// budget_amount minus actual - negative means overspent - and null (no
// budget set at all) is explicitly excluded rather than treated as 0,
// the same "no data is not zero" rule the backend already applies to a
// budget line with nothing set.
export function overBudgetLines(budgets) {
  return (budgets || []).filter((line) => line.difference !== null && Number(line.difference) < 0)
}
