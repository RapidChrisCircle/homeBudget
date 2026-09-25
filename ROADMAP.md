# Roadmap

Planned work for homeBudget, with a status against each task so an interrupted session can be picked up later without re-deriving the reasoning behind it.

The three documents at the repo root divide cleanly:

| File | Answers |
|---|---|
| [`README.md`](README.md) | How the app works **today** |
| [`CHANGELOG.md`](CHANGELOG.md) | What **shipped**, and when |
| `ROADMAP.md` (this file) | What's **next**, and how far it got |

Written against **v0.22.1** (`961b5ee`). The review this roadmap came from is condensed in [Appendix A](#appendix-a--review-findings) — every task links back to the finding that justifies it, so the *why* stays attached to the *what*.

## How to use this file

- **Pick any task.** They're grouped in rough value-per-effort order, but each carries its own context and none depends on another unless it says so. Tier order is a recommendation, not a sequence.
- **Mark `[~]` when you start**, and add a one-line note saying where you got to and which files you already touched. That note is the entire point of this file — it is what a cold session reads to resume rather than restart.
- **Mark `[x]` only when merged and green**: both test suites pass, `npx oxlint src` and `npm run build` are clean. Record the version that shipped it beside the tick.
- **Ship it the repo's way**: a `CHANGELOG.md` entry and a `VERSION` bump in the same change (see README's [Versioning](README.md#versioning) section), and a README update if user-visible behaviour changed.
- **Leave completed tasks in place** rather than deleting them — the notes are the history of *why* something ended up the way it did, which the changelog entry alone rarely captures.
- **Task IDs** (`T1.1`, `T2.3`…) are stable. Reference them in commit messages so the connection survives even if this file is reorganised.

### Status legend

| Mark | Meaning |
|---|---|
| `[ ]` | Not started |
| `[~]` | In progress — **must** carry a note: where it got to, which files are touched, what's left |
| `[x]` | Done — carries the version that shipped it |
| `[-]` | Dropped — carries the reason, so it isn't silently re-proposed |

## Scope boundaries

Decided, not overlooked. **Do not propose these again** without the boundary being revisited explicitly:

- **Authentication — out of scope.** This is a local-LAN-only application by explicit decision: no login, no shared password, no reverse-proxy auth layer. The deployment publishes the UI on a host port for a household network and that is the intended model.
- **Multi-currency** — a single-currency household app; every amount is one currency and no conversion exists anywhere.
- **Receipt/document attachments** — a file store, its backups and its lifecycle are a disproportionate amount of machinery for the value here.
- **Tax-deduction flagging** — jurisdiction-specific and better served by exporting to whatever the household's accountant actually uses (see [T1.4](#t14--csvjson-export)).
- **Multi-user / shared households** — no user model exists, and adding one touches every endpoint. A single shared instance on the LAN is the model.
- **Bank/open-banking sync** — already covered in README's [Categorization](README.md#categorization) section: the commercial enrichment APIs are paid per-transaction and require sending spending history to a third party, and there is no credible free or offline equivalent.

---

## Tier 1 — highest value per unit of work

Self-contained, independently shippable, and each one is felt in daily use.

### T1.1 — Manual transaction entry

- **Status:** `[x]` — shipped in **0.23.0**.
- **Why:** [Finding 1](#finding-1). Import is the only data path, so cash spending, a transaction not yet on a statement, or a reimbursement simply cannot be recorded. This caps the app's usefulness mid-month, exactly when a budget should be steering decisions.
- **What shipped:** `POST /transactions` and `PUT /transactions/{id}` (`backend/app/api/transactions.py`), `Transaction.is_manual` (migration `a762ac78878d_add_is_manual_to_transactions`), a new **Add a Transaction** card on `/transactions` (`AddTransactionForm.jsx`) and an **Edit** action on a manual row's Details disclosure (`EditManualTransactionForm.jsx`), plus a "manual" badge on the row.
- **How the constraints below were actually resolved:**
  - **Balance**: computed, not invented - the account's current latest balance (via the existing `services/ledger.account_balance`) plus the new row's own signed amount. This is only correct if the new row *becomes* the latest transaction, so both create and edit **require** the transaction to be dated on or after the account's other latest one - rejected with a 422 naming that date otherwise. Documented in README's new "Manual transactions" section and in `create_transaction`'s own docstring.
  - **Duplicate-on-later-import**: documented as a known caveat rather than solved - a manual row's computed balance will never match a later real statement's own reported balance, so import's duplicate key can't recognize them as the same row. Reconciling is a manual step (delete whichever is redundant). Revisit if this proves painful in practice.
  - **Exactly one of debit/credit**: enforced the same way import enforces it, but the two API fields are deliberately *positive* dollar amounts (a Money out/Money in choice) rather than already-signed values, so a user typing "$45 for groceries" never has to remember to type `-45` - the sign convention is applied once, server-side (`_signed_amount_and_type`).
  - **Cash account companion**: no new machinery needed - `POST /accounts` already creates an account with any account number, `CASH` included.
  - **Editing scope**: deliberately narrower than "every field" - the account itself can't be changed on an existing manual row (that's a balance recomputation on two accounts' sequences at once; delete-and-recreate covers it with far less risk). Every other field can.
- **Tests:** 26 backend (`tests/test_manual_transactions.py`) + 21 frontend (`AddTransactionForm.test.jsx`, `EditManualTransactionForm.test.jsx`, plus 6 new cases in `TransactionsPage.test.jsx`) - full suites (581 backend, 640 frontend) green, lint and build clean.

### T1.2 — Filtered-total summary strip on the ledger

- **Status:** `[x]` — shipped in **0.23.1**.
- **Why:** [Finding 10](#finding-10). `components/Pagination.jsx` reports `(N total)` — a **count**. Filter the ledger to "Groceries, July" and the app will not tell you what it adds up to, which is the single most likely reason someone filtered in the first place.
- **What shipped:** `services/ledger.ledger_totals` (money in/out/net over whatever query object is passed - reused as-is for the plain view) and `transaction_group_totals` (the identical total over the grouped view's own filters, factored through a shared `_grouped_filters` helper so the two can't drift). Both `GET /transactions` and `GET /transactions/groups` gained `total_in`/`total_out`/`net_total`. A new `.ledger-totals` strip renders them between the toolbar and the table in `TransactionsPage.jsx`, reading the plain fetch's own totals regardless of whether Group by merchant is on - the two are proven to always agree for the same filters, so there's no separate group-totals state to keep in sync.
- **A design call worth recording**: totals sum each matching row's own signed debit/credit - the exact figure already shown per row - not a per-allocation split figure. A split transaction matched through only ONE of its several category allocations still contributes its full amount, deliberately consistent with what the ledger already displays for that row rather than the stricter per-category slice `services/allocations.py` gives every report instead. Documented prominently in `ledger_totals`' own docstring so it reads as a decision, not a bug, if revisited.
- **Tests:** 6 new unit tests in `test_ledger.py` (whole-set-not-one-page, sign split, filter-respecting, empty-set, split full-amount, grouped-matches-plain) + 3 HTTP-level tests in `test_transactions.py` + 3 frontend tests in `TransactionsPage.test.jsx`. Full suites (590 backend, 643 frontend) green, lint and build clean.

### T1.3 — Statement continuity / coverage check

- **Status:** `[x]` — shipped in **0.23.2**.
- **Why:** [Finding 4](#finding-4). Import is the only data path, so a missing statement period silently understates every total and nothing notices. This app can **prove** coverage rather than assume it, because it already stores the bank's own running balance.
- **What shipped:** `backend/app/services/coverage.py`'s `account_coverage_gaps(db, account_id)`, a pairwise walk over one account's own transactions ordered by `(transaction_date, id)` checking `balance[n] == balance[n-1] + debit[n] + credit[n]` between adjacent DISTINCT dates only (see below). `GET /accounts/{id}/coverage` (`AccountCoverageResponse`) surfaces it, and a new **Statement Coverage** card on `/accounts/:id` lists any detected gaps with their date range, expected vs. actual balance, and the discrepancy - or a plain reassurance when there are none. Left for [T2.4](#t24--alerts-feed) to also surface as an alert - this task only builds the per-account check and its own page.
- **How the caveats were actually resolved:**
  - **Same-day tolerance**: the pairwise walk simply **skips** any adjacent pair sharing the same `transaction_date` - the check only ever fires between the *last* row of one date and the *first* row of the next distinct one. A real missing-statement gap almost always spans whole days or weeks, so this removes an entire class of false positive (same-day file order not matching import id order) at no real cost to detection.
  - **A brand-new account's first transaction**: falls out for free from the pairwise-zip implementation - the first row is never a "current" being checked against a "previous", so it's never flagged.
  - **Grouped accounts**: never even enters the picture - the function is scoped to one `account_id` and never reads another account's rows at all, so a group's handover between members can't be mistaken for a gap without any group-aware code needing to exist.
- **Tests:** 9 unit tests (`test_coverage.py`, covering all four acceptance criteria plus multi-gap and duplicate/out-of-order cases) + 3 HTTP-level tests in `test_accounts.py` + 3 frontend tests in `AccountDetailPage.test.jsx`. Full suites (602 backend, 646 frontend) green, lint and build clean.

### T1.4 — CSV/JSON export

- **Status:** `[x]` — shipped in **0.23.3**.
- **Why:** [Finding 8](#finding-8). Years of financial history with no way out, behind a Watchtower auto-updater that runs Alembic migrations unattended (see README's own warning in [QNAP Deployment](README.md#qnap-deployment)). Export is both the backup path and the exit.
- **What shipped:** `services/export.py` with two functions - `ledger_csv(query)` (filtered CSV) and `database_snapshot(db)` (whole-database JSON) - and two new endpoints, `GET /transactions/export` (ledger CSV, on the ledger's filter bar) and `GET /export/database` (JSON, on `/accounts`). Both are plain `<a href>` download links on the frontend, not calls through the `api` client, so the browser handles the save itself from `Content-Disposition`. `list_transactions`' own filter validation was factored into a shared `_validated_ledger_query` so the export can never accept a filter combination the ledger view itself would reject.
- **How the round-trip criterion was actually resolved:** documented as a deliberate non-goal rather than engineered around. The CSV's header doesn't match the built-in bank layout (`services/csv_formats.py` matches a layout by *exact* header string) and carries Category/Note/split information no bank format has a column for - a categorized, split-aware export is what makes it useful outside the app, and a second, re-importable bank-shaped export was never asked for and would be a different, more limited file. The JSON backup has no restore endpoint for the same reason: true point-in-time recovery is a Postgres-level restore, which is out of scope for this app to reimplement.
- **A correctness subtlety worth recording**: `database_snapshot`'s per-table dumps mostly validate straight off ORM rows via each schema's own `from_attributes=True` (matching exactly what e.g. `list_csv_formats` already does) - except `savings_goals`, whose `GoalResponse` fields (`current_amount`, `percent`, ...) are computed by `services/goals.goal_progress`, not stored on `SavingsGoal` itself. That one is assembled by hand, mirroring `api/goals.py`'s own private `_serialize_goal` rather than importing it (which would invert this codebase's api → services layering). A test pins that the export's own goal serialization is byte-identical to `GET /goals`.
- **Tests:** 16 tests in `test_export.py` (CSV shape/filtering/pagination-defeat/split-flattening/shared-validation, JSON table completeness/parity-with-live-endpoints/archived-inclusion/empty-database) + 2 frontend tests for the ledger's Export CSV link (`TransactionsPage.test.jsx`) + 1 for the Accounts backup link (`AccountsPage.test.jsx`). Full suites (618 backend, 649 frontend) green, lint and build clean.

### T1.5 — Savings rate and runway tiles

- **Status:** `[x]` — shipped in **0.23.4**.
- **Why:** [Finding 7](#finding-7). The two headline numbers households actually track, and every input already exists.
- **What shipped:** `services/net_worth.liquid_assets()` (new - Everyday + Savings balances, sign-and-group-aware exactly like `net_worth_now`) and two new `dashboard_kpis()` fields, `savings_rate` (`net_saved / total_income`) and `runway_months` (`liquid_assets() / avg_per_month`). Both new `stat_tile` metrics (`savings_rate`, `runway_months`) appear in the Add Widget list automatically - `STAT_TILE_METRICS` is derived from `METRIC_META`'s own keys, so no registry change was needed. `StatTile` gained a `formatValue` prop (defaulting to the existing currency formatter) so a ratio renders as a percentage (`formatPercent`) or a month count (`formatMonths`, new in `utils/format.js`) instead of a dollar figure.
- **The exact definitions used**: savings_rate as specified. Runway divides CURRENT liquid assets by THIS WINDOW's average monthly spend - "at this spend rate, how long would today's cash last", not a projection (that's `services/forecast.py`'s own job, not duplicated here).
- **How the zero-denominator cases were resolved**: both are `None`, not `0` or an error - `savings_rate` when the window had no income at all (a household living off savings has no "rate" to report), `runway_months` when the window had no expenses to divide by. A real answer of exactly zero (expenses exist, liquid assets don't) is left as `0`, distinct from both.
- **Tests:** 12 backend (6 `liquid_assets` cases in `test_net_worth.py` incl. group-contributor and inverted-sign; 6 `dashboard_kpis` cases in `test_dashboard_metrics.py` incl. both zero-denominator paths and a negative rate) + 2 HTTP-level + 10 frontend (`StatTileWidget.test.jsx`, `StatTile.test.jsx`, `format.test.js`). Full suites (632 backend, 662 frontend) green, lint and build clean.

### T1.6 — Global search / command palette

- **Status:** `[x]` — shipped in **0.23.5**. **Tier 1 is now complete.**
- **Why:** [Finding 11](#finding-11). Nine destinations and thousands of transactions, with navigation by scanning a flat link row. The largest perceived-speed gain available in the UI.
- **What shipped:** `frontend/src/components/CommandPalette.jsx`, mounted once in `App.jsx` outside the routed `<Routes>` tree (so it survives navigation rather than remounting and losing its fetched data every route change). `Ctrl+K`/`Cmd+K` opens it from any page; Escape or a click outside closes it; arrow keys move the selection; Enter or a click activates it. Results are grouped (Pages, Categories, Accounts, Merchants) using ARIA `role="group"` with an `aria-label`, inside one `role="listbox"`, with `aria-activedescendant` kept in sync on the input for proper combobox semantics.
- **How "already in memory" was actually resolved:** pages genuinely are (`pageRegistry.jsx`, a static import). Categories and accounts are **not** globally cached anywhere in the app - every page fetches its own copy independently - so the roadmap's assumption didn't quite hold. Resolved by having the palette fetch both itself, but **lazily**: only on the first time it's opened, cached in its own state for the rest of the session, rather than adding two unconditional requests to every single page load for a feature most sessions never open. Merchants have no "list them all" endpoint at all, so they're searched live and debounced (200ms, matching this app's existing no-per-keystroke-request convention) through `GET /transactions/groups?search=`, the identical endpoint the ledger's own Group by merchant view already uses.
- **Tests:** 17 in `CommandPalette.test.jsx` (open/close via every mechanism, each result kind and its navigation target via the `LocationProbe` pattern `TrendsPage.test.jsx` established, lazy single-fetch caching, debounced merchant search via fake timers, keyboard navigation, empty-query and no-matches states) + confirmed `App.test.jsx`'s existing 8 unaffected by the new mount. Full suites (632 backend, 679 frontend) green, lint and build clean.

---

## Tier 2 — the features that change what the app *is*

### T2.1 — Budget carryover and sinking funds

- **Status:** `[ ]`
- **Why:** [Finding 2](#finding-2). The biggest conceptual gap between a spending *reporter* and a budgeting *tool*. Today, $100/month toward $1,200 of annual car registration reads as eleven quiet months and one catastrophic one.
- **Where:** `backend/app/services/budgets.py` — specifically inside `effective_budget`, the single function every caller (`/reports`, `/trends`, `/budgets`) already routes through. Resolving carryover anywhere else would let two callers disagree about the same month, which that function exists to prevent.
- **Design notes:** opt-in per category (a `rolls_over` flag), so ordinary monthly budgets are unchanged. Unspent budget accumulates into the next month's available amount; overspend carries as a deficit. This makes a month's "available" figure depend on **every prior month**, which is a real performance and correctness change from today's independent per-month resolution — decide how far back accumulation starts (category creation? a configurable epoch?) and cache deliberately. Connect it to `/goals`' envelope model rather than introducing a second, parallel notion of "money set aside"; README's [Savings goals](README.md#savings-goals) explains why there is deliberately no separate contribution ledger.
- **Acceptance:** a carryover category accumulates across months and absorbs the annual spike without reading as over budget; a non-carryover category behaves exactly as it does today (existing budget tests unchanged); the Monthly Budgets editor shows accumulated available separately from the month's own amount.

### T2.2 — Pay-period budgeting

- **Status:** `[ ]`
- **Why:** [Finding 3](#finding-3). The preset is a Queensland household, where fortnightly pay is the norm, and three months a year contain three pay cycles — which a calendar-monthly budget mis-states in both directions.
- **Where:** `services/budgets.py` and `services/reporting.py`'s month-bounds helpers (`month_bounds`, `contiguous_periods`), which currently hard-code calendar months throughout.
- **Notes:** this is the most invasive Tier 2 item — "a period" is currently synonymous with "a calendar month" in reporting, trends, budgets and the dashboard. Consider shipping it as an alternative *view* over monthly budgets first (a fortnight-aligned spending pace) before making the budget period itself configurable. Depends on nothing, but overlaps [T2.1](#t21--budget-carryover-and-sinking-funds) heavily — do that one first and reuse its accumulation model.
- **Acceptance:** a configured pay date produces correct fortnight boundaries across a three-pay month and across a year boundary.

### T2.3 — Transfer matching

- **Status:** `[ ]`
- **Why:** [Finding 5](#finding-5). Both legs are excluded from reports by kind, but nothing pairs them — so one leg mis-categorized silently inflates spending *and* income.
- **Where:** new service alongside `backend/app/services/narration.py` (whose merchant-key logic is already shared by recurring detection and the ledger's merchant grouping), surfaced in the ledger and the alerts feed.
- **Notes:** match on equal-and-opposite amount, within a few days, across two different accounts. Never auto-recategorize — flag the candidate pair and let the user confirm, the same "surface it, don't guess" posture as balance-sign inference (README's [Accounts and net worth](README.md#accounts-and-net-worth)). An unmatched transfer leg is the interesting signal, and it's what should reach the alerts feed.
- **Acceptance:** a seeded pair is matched across accounts; a coincidental same-amount pair within one account is not; an unmatched leg is reported.

### T2.4 — Alerts feed

- **Status:** `[ ]`
- **Why:** [Finding 6](#finding-6). Over-budget categories, subscription price rises, a bill that didn't arrive, an account not imported in weeks, coverage gaps ([T1.3](#t13--statement-continuity--coverage-check)), unmatched transfers ([T2.3](#t23--transfer-matching)) — all already computed or cheap to compute, none surfaced unless you visit the right page.
- **Where:** a new assembling service over `services/recurring.py` (which already detects price changes and missed/stopped series), `services/reporting.py` (over-budget) and the two tasks above; surfaced as a header badge and a feed, reusing `NeedsAttentionWidget.jsx`'s existing shape.
- **Notes:** assembly, not new detection — resist adding a second implementation of any signal. Alerts must be dismissible and must not reappear once dismissed, following `RecurringDismissal`'s existing keyed-dismissal pattern.
- **Acceptance:** each signal type appears, is dismissible, stays dismissed, and the badge count matches the feed.

### T2.5 — Navigation, mobile ledger, chart tooltips

- **Status:** `[ ]`
- **Why:** [Findings 9, 13, 14](#appendix-a--review-findings). The three UI changes with the broadest reach; can be done independently but share a release well.
- **Where:** `frontend/src/pageRegistry.jsx` and `App.jsx` (grouped sidebar: *Money* / *Plan* / *Insight* / *Setup*), `pages/TransactionsPage.jsx` and `App.css` (card-per-transaction below ~700px), `components/charts/` (one shared hover/tooltip layer for `LineChart` and `BarChart`).
- **Notes:** the chart tooltip is the single highest-impact visual change — hover is currently a native SVG `<title>` only. Keep it additive in the same way drill-down was: a chart with no tooltip prop renders exactly as it does today. The sidebar must stay keyboard-navigable and collapse sensibly on a phone.
- **Acceptance:** the nav groups all destinations with no orphans; the ledger is usable on a 375px viewport without horizontal scrolling; tooltips work by keyboard focus as well as hover.

---

## Tier 3 — strategic

### T3.1 — Forecast scenarios

- **Status:** `[ ]`
- **Why:** the projection already exists (`services/forecast.py`); the unanswered question is "what if this subscription stops, or this category drops 20%".
- **Notes:** scenarios must be non-destructive overlays on the existing projection, never stored adjustments to real data. README's [Forecast](README.md#forecast) section documents the run-rate/recurring double-count exclusion that is the file's most load-bearing property — a scenario must not break it.

### T3.2 — Rules v2 (multi-condition, regex)

- **Status:** `[ ]`
- **Why:** a rule's narration pattern is a single case-insensitive substring, which cannot express OR — which is exactly why the rule-review feature documents that "merge" can only mean "delete the rule that can never fire" (README's [Rule review](README.md#rule-review)).
- **Notes:** any change here must keep `services/categorization.py`'s one matcher serving import, preview and apply alike — the module's docstring explains that the "preview said 12, apply did 9" class of bug is what a single matcher prevents. Rule review's subsumption analysis assumes substring semantics and will need rethinking.

### T3.3 — Guided first-run onboarding

- **Status:** `[ ]`
- **Why:** [Finding 16](#finding-16). A fresh install is empty cards on every page.
- **Notes:** import a statement → classify accounts → load the Queensland preset → set budgets. Every step already exists as its own feature; this is sequencing and copy, not new machinery.

### T3.4 — Toast notifications

- **Status:** `[ ]`
- **Why:** [Finding 15](#finding-15). Every action reports through inline text a user may never look at.
- **Notes:** must respect `prefers-reduced-motion` (App.css already has the block) and must never be the *only* place an error appears — the existing `<ErrorState>` stays for anything the user needs to act on.

---

## Appendix A — review findings

Condensed from the full review of v0.22.1 on 2026-09-25. Kept here so each task's justification survives with it.

**What's already strong.** Single-source-of-truth resolution (`services/budgets.effective_budget`), one allocation view every money query reads through (`services/allocations.py`), presentation-edge filtering deliberately kept out of SQL, drill-down wired through every chart, a validated categorical chart palette with light/dark/auto theming, and real accessibility discipline (visually-hidden captions, `scope` attributes, keyboard-operable reordering rather than drag-only). The weaknesses below are not in the code's quality — they're in what the app won't let a household record, what it never tells them, and one conceptual gap in how budgets work.

#### Practice gaps

- <a id="finding-1"></a>**Finding 1 — No manual transaction entry.** `api/transactions.py` has import, bulk-categorize, split, note and delete, but no create. Cash spending and anything not yet on a statement are invisible. → [T1.1](#t11--manual-transaction-entry)
- <a id="finding-2"></a>**Finding 2 — Budgets don't carry over.** Per-month figures with overrides and no accumulation, so sinking funds (annual rego, insurance) are impossible to express. → [T2.1](#t21--budget-carryover-and-sinking-funds)
- <a id="finding-3"></a>**Finding 3 — Monthly-only budgeting against fortnightly pay.** Three months a year hold three pay cycles; a calendar-monthly budget mis-states them. → [T2.2](#t22--pay-period-budgeting)
- <a id="finding-4"></a>**Finding 4 — Nothing verifies the ledger is complete.** A missing statement silently understates every total. The stored running `Balance` column makes coverage *provable* rather than assumed — a capability few apps in this category have. → [T1.3](#t13--statement-continuity--coverage-check)
- <a id="finding-5"></a>**Finding 5 — Transfers aren't matched.** Each leg is categorized independently and nothing pairs them. → [T2.3](#t23--transfer-matching)
- <a id="finding-6"></a>**Finding 6 — No alerts; every signal is passive.** Price rises, missed bills and over-budget categories are computed but only found by visiting the right page. → [T2.4](#t24--alerts-feed)
- <a id="finding-7"></a>**Finding 7 — No savings rate, no runway.** The two standard household metrics, absent despite every input existing. → [T1.5](#t15--savings-rate-and-runway-tiles)
- <a id="finding-8"></a>**Finding 8 — Data goes in but never comes out.** No export of any kind. → [T1.4](#t14--csvjson-export)

#### UI

- <a id="finding-9"></a>**Finding 9 — Flat nine-link navigation.** Nine peers with no hierarchy force a scan every time. → [T2.5](#t25--navigation-mobile-ledger-chart-tooltips)
- <a id="finding-10"></a>**Finding 10 — The ledger never totals what you filtered.** It shows a count, never a sum. → [T1.2](#t12--filtered-total-summary-strip-on-the-ledger)
- <a id="finding-11"></a>**Finding 11 — No global search.** → [T1.6](#t16--global-search--command-palette)
- <a id="finding-12"></a>**Finding 12 — Everything except the Dashboard is one vertical column of full-width cards.** `/reports`, `/categories` and `/accounts` would read better with the widget grid's two-column treatment at wide viewports.
- <a id="finding-13"></a>**Finding 13 — The ledger reads as a spreadsheet.** A per-row category `<select>` is heavy; a coloured category pill that becomes a select on click, plus merchant initials, would lift density and scanability.
- <a id="finding-14"></a>**Finding 14 — Charts are static.** Hover is a native SVG `<title>` only — no crosshair, no shared tooltip, no value labels. → [T2.5](#t25--navigation-mobile-ledger-chart-tooltips)
- <a id="finding-15"></a>**Finding 15 — No transient feedback.** No toasts; every result is inline text. → [T3.4](#t34--toast-notifications)
- <a id="finding-16"></a>**Finding 16 — First run is a wall of empty cards.** → [T3.3](#t33--guided-first-run-onboarding)
- <a id="finding-17"></a>**Finding 17 — Mobile is tolerated, not designed.** One 900px breakpoint; the ledger stays a horizontally scrolling table on a phone, which is where a budget actually gets checked. → [T2.5](#t25--navigation-mobile-ledger-chart-tooltips)
