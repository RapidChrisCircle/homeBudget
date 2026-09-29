# Changelog

All notable changes to homeBudget are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are tracked in the repo-root `VERSION` file (see `README.md`'s [Versioning](README.md#versioning) section) — there are no git tags, so each entry below cross-references the commit that shipped it. `VERSION` was introduced at 0.11.0; commits before that point exist but predate any recorded version number, so this file starts there rather than inventing 0.1–0.10.

## [0.45.0] - 2026-09-29

Roadmap item T5.4 (`ROADMAP.md`), Finding 23 - the inverse of the original Finding 3: pay-period budgeting was fortnightly-only, and this household is paid monthly, on the last business day.

### Added

- **`PaySchedule.frequency`** (`"fortnightly"` or `"monthly"`, migration `f39a2c7d1e84`), with `anchor_date` made **nullable** - a monthly schedule has no anchor to store at all, since every period boundary is derivable straight from the calendar.
- **`services/pay_periods.last_business_day(year, month)`** - Mon-Fri only, no public-holiday calendar. Deliberate: QLD public holidays essentially never fall on the last weekday of a month, so a holiday calendar would change the computed payday in approximately no real month, for the cost of a new dependency or ~100 lines needing yearly upkeep.
- **`services/pay_periods.next_payday(reference)`** and a generalised `pace(monthly_amount, frequency)` (`fortnightly_pace` kept as a thin alias so its existing tests are untouched) - `PERIODS_PER_YEAR = {"fortnightly": 26, "monthly": 12}`.
- **`GET /pay-periods` gains `frequency`, `payday`, `days_until_next_payday`** on top of the existing period shape - truthful for either frequency, so any API caller (not just this app's own frontend) can ask "when do I get paid next".
- **On `/categories`**: a pay-frequency selector on setup, with the payday date field shown only for fortnightly. **Fortnightly behaviour is completely unchanged** - the existing Pay Period Budgeting card, including its Previous/Next controls, renders exactly as before. **Monthly is folded into Monthly Budgets** rather than shown as a duplicate table: under a calendar-month schedule the per-category pacing table would be identical to Monthly Budgets' own numbers, so Pay Period Budgeting instead shows a short note and a "Change pay schedule" control, and Monthly Budgets itself gains one line stating the next payday and how many days away it is.

### Verification

20 new backend tests (`test_pay_periods.py` - `last_business_day` on a weekday/Saturday/Sunday, `next_payday` including a real year-boundary crossing, the generalised `pace()`, schedule get/set/upsert/switch, monthly-window category totals, and the full API surface for both frequencies including validation) plus 1 new export test. 5 new frontend tests (`CategoriesPage.test.jsx` - a monthly submission with no anchor, the compact monthly message with no duplicate table, switching the "Change pay schedule" form back to fortnightly, and the payday line appearing on Monthly Budgets for monthly but not fortnightly). Full suites (797 backend, 848 frontend) green, lint and build clean.

**This completes Tier 5 — Alerts, transfer follow-through, monthly pay.** All four tasks (T5.1, T5.2, T5.3, T5.4) are shipped, versions 0.42.0 through 0.45.0.

## [0.44.0] - 2026-09-28

Roadmap item T5.3 (`ROADMAP.md`), Findings 20 and 21 - the Alerts page was one flat, ungrouped table with a single one-at-a-time Dismiss button, and nothing on it explained what any alert meant or how to resolve it.

### Added

- **Grouped alerts feed** - `AlertsPage.jsx` now groups alerts into one section per kind, in the same order `collect_alerts()` already returns them. Each section carries a one-sentence explanation of what that kind means and how to resolve it (once per kind, not once per row - the thing that makes an explanation affordable at hundreds of alerts) and its own **Dismiss these N** button. A card-level **Dismiss all** clears the whole feed, behind a confirm.
- **`POST /alerts/dismissals/all`** (optional `{"kind": "..."}`), backed by a new `services/alerts.dismiss_all_alerts()` - routes each currently-outstanding alert through its own dismissal mechanism (the generic `AlertDismissal` table, or the existing `RecurringDismissal` one), since a client-side loop over one generic endpoint cannot correctly split a mixed feed. Dedupes the shared write when a `missed_recurring` and a `price_change` alert for the same series would otherwise both try to insert the identical `RecurringDismissal` row, while still counting both toward the reported total.
- **A live nav badge** - a new `services/alertsCount.ts` (the same module-level pub-sub shape `services/toast.ts`/`services/commandPalette.ts` already use), read by `App.jsx` via `useSyncExternalStore` in place of its own local state. `AlertsPage` pushes the fresh count here after every dismissal, so "Dismiss all" no longer leaves the badge showing a stale number until a reload.

### Verification

7 new backend tests (`test_alerts.py` - clearing every kind, scoping to one kind, not retroactively dismissing a later alert, the shared-series dedup, idempotency, and both at the API layer). 10 new frontend tests (`alertsCount.test.js` x4, `AlertsPage.test.jsx` x6/net - grouping, the explanation text, a scoped group dismiss, Dismiss all both declined and confirmed, the disabled state with nothing to dismiss, and the badge updating after a dismissal) - one existing positional test (`rows[1]`/`rows[2]`) was rewritten to scope by section instead, since group headers change what index a given alert's row sits at; every other existing test passed unmodified, including `App.test.jsx`'s full 11, which needed zero changes for the badge move onto the shared store. Full suites (777 backend, 843 frontend) green, lint and build clean.

## [0.43.0] - 2026-09-28

Roadmap item T5.2 (`ROADMAP.md`), Finding 22 - the Transfer Matching card diagnosed a problem but never said what to do about it, and had zero interactive elements to act on.

### Added

- **Per-leg category breakdown** on `TransferMatch` (`services/transfer_matching.py`) and `GET /api/transfers` - `leg_a_category_name`/`leg_a_is_transfer` and the same for leg B, alongside the existing combined `both_categorized_as_transfer`. The API can now say WHICH leg of a mismatched pair is the problem, not just that one of them is.
- **"View in ledger" on every row** of `TransferMatchingCard.jsx` - a mismatched pair links to both legs at once (`?transaction_ids=<a>&transaction_ids=<b>`), an unmatched leg to itself, built on T5.1's new filter. A new `utils/format.transactionIdsLedgerLink()` helper, alongside the existing `uncategorizedLedgerLink`/`recurringLedgerLink`.
- **A badge naming the offending leg's actual category** on a mismatched pair, and a plain-language statement of the fix in both sections - a mismatched pair's fix (give the flagged leg a Transfer-kind category, or leave it if it isn't really one), and an unmatched leg's three distinct causes and their different fixes (not yet imported / not really a transfer / excluded from matching).
- The `unmatched_transfer` alert's link moved from unfiltered `/transactions` to the same precise `?transaction_ids=<id>` scope.

### Changed

- `README.md`'s Transfer matching section now documents the workflow it previously left unstated three times over ("changes nothing on its own").

### Verification

3 new backend tests (`test_transfer_matching.py`) plus one existing alert test extended with the new link assertion. 5 new frontend tests (`format.test.js` x2, `TransferMatchingCard.test.jsx` x3, which also needed wrapping in `MemoryRouter` now that its rows contain real links). "Surface it, don't guess" holds: nothing here recategorizes a transaction automatically, only a link that the household follows and acts on itself. Full suites (770 backend, 833 frontend) green, lint and build clean.

## [0.42.0] - 2026-09-28

Roadmap item T5.1 (`ROADMAP.md`) - the precision primitive Tier 5's remaining tasks (Transfer Matching's call to action, precise alert links) both build on.

### Added

- **`transaction_ids` ledger filter** - an exact `Transaction.id IN (...)` match, threaded through the same three endpoints `import_batch_id` (T4.3a) touched: `GET /transactions`, `GET /transactions/export`, `GET /transactions/groups`. Accepted as repeated query params (`?transaction_ids=1&transaction_ids=2`), matching how the backend already expects a list-typed query parameter.
- **A new "Transactions" filter chip** on the ledger, the 8th - the one filter with no field to type into. Its popover carries an explanation and a Clear button instead: this filter exists for a caller that already knows exactly which rows it means (a future Transfer Matching link, a precise alert link), never for a person typing ids by hand. Shown as a count ("2 transactions"), never the raw ids. Rendered as a real, visible, clearable chip rather than applied silently - a ledger showing two rows with no visible reason why would be worse than no filter at all.

### Verification

9 new backend tests (`test_ledger.py` x3, `test_transactions.py` x2, `test_transaction_groups.py` x1 - covering the filter alone, combined with another filter, an empty list matching nothing, and both endpoints), 6 new frontend tests (`ledgerFilterParams.test.js` x4, `TransactionsPage.test.jsx` x2), plus the existing "identical filter set before/after Group by merchant" assertion extended from seven names to eight, its intent unchanged. Full suites (767 backend, 828 frontend) green, lint and build clean.

## [0.41.0] - 2026-09-27

Roadmap item T4.1b (`ROADMAP.md`), the last of Tier 4 - no page had a page-header convention; every page was a bare `<h2>` repeated across each of its own loading/error/empty/happy branches.

### Added

- **`<PageHeader>`** (`components/PageHeader.jsx`) - title, an optional subtitle, and an actions slot, generalised from the Dashboard's own pre-existing `.dashboard-header` (already exactly this shape) rather than shipping a second, near-identical pattern alongside it.
- Adopted across all ~31 `<h2>` sites in the app (13 page files, once T4.4's new `TriageQueuePage.jsx` is counted), including every early-return branch on every page - converted together, since converting only the happy path would make a page visibly jump in layout the moment it finishes loading.

### Verification

Every `<h2>` text stayed byte-identical, so **zero existing test assertions needed to change** across the entire sweep - the tightest possible bar, matching T4.1a's own sidebar rewrite. 6 new tests (`PageHeader.test.jsx`). Full suites (761 backend, unaffected; 822 frontend) green, lint and build clean.

**This completes Tier 4 — UI & navigation uplift.** All nine tasks (T4.0, T4.1a, T4.5b, T4.3a, T4.3b, T4.2, T4.4, T4.5a, T4.1b) are shipped, versions 0.33.0 through 0.41.0.

## [0.40.0] - 2026-09-27

Roadmap item T4.5a (`ROADMAP.md`), Finding 13 - the ledger's per-row category `<select>` had no visual identity of its own.

### Added

- **`Category.color`** (migration `e28fb4860a15`, nullable `VARCHAR(20)`) - a per-category colour, stored as a design token NAME (e.g. `"category-3"`), not a hex literal, so it resolves per theme like every other colour in the app. `null` means no colour chosen, not a default one.
- **A 10-swatch colour picker** on the Categories page's add/edit form, backed by a new `--category-1`..`--category-10` token family in `index.css` (all four theme blocks) - deliberately separate from the `--series-*` chart palette, and sized as a *chooser* rather than a cycler: a household can have far more categories than any cycled palette could keep visually distinct.
- **The ledger's category pill** - the per-row control stays the same `<select>` (dozens of tests key off its accessible name), now tinted with a left border in the assigned category's colour. A split transaction (no select at all) gets a small colour dot per allocation instead. Three cases render neutral rather than a guessed colour: no colour chosen, an archived category (absent from the lookup list), and (for splits) a split line with no colour of its own.

### Known limitation, recorded rather than silently skipped

The `--series-*` chart palette was independently validated (colourblind separation, chroma floor, contrast) with the dataviz skill's `validate_palette.js`; that tool wasn't available in this environment, so the new `--category-*` family was hand-authored as an evenly-spaced HSL hue wheel instead. A real validation pass is a good candidate for a follow-up if that tooling becomes available. Similarly, the migration was verified to load and chain correctly onto the current head, and the backend test suite (which builds its schema from the ORM model directly) confirms the column works end-to-end - but `alembic upgrade`/`downgrade` were not run against a live Postgres, since no Postgres instance was reachable in this sandbox.

### Verification

5 new backend tests (`test_categories.py` - default/set/update/clear/length-validation) + 12 new frontend tests (`categoryColors.test.js` x4, `CategoriesPage.test.jsx` x3, `TransactionsPage.test.jsx` x5 covering a coloured category, an uncoloured one, an uncategorized row, an archived category, and mixed-colour splits). Full suites (761 backend, 816 frontend) green, lint and build clean.

## [0.39.0] - 2026-09-27

Roadmap item T4.4 (`ROADMAP.md`), Finding 19 - after an import, nothing distinguished "still needs a category" from the rest of the ledger except manually filtering to Uncategorized.

### Added

- **Ledger triage queue** (`pages/TriageQueuePage.jsx`, its own hidden route at `/transactions/review`, linked from the ledger's filter bar) - a keyboard-driven, one-merchant-at-a-time review of uncategorised merchant groups, largest first. No new backend endpoint: it reads the same `GET /transactions/groups` and writes through the same `POST /transactions/bulk-category` the ledger's own Group by merchant view already uses.
- `j`/`k` (or the arrow keys) step through the queue without assigning anything; a live-filtering category combobox (typing narrows, Enter assigns) reuses the exact clamped-`activeIndex`/Arrow/Enter shape `CommandPalette.jsx` already established; `u` undoes the last assignment, restoring the merchant to the queue and re-nulling its category.
- An **Also create a rule from this merchant** checkbox, best-effort - a rejected rule (e.g. a duplicate) never blocks progress through the queue.
- A progress readout tracking the whole remaining queue, not just the current merchant.

### Why a separate route, not a `?review=1` mode on the ledger

Applying any ledger filter rebuilds the URL's search params from scratch (`ledgerFilterParams.searchParamsFromFilters`) - a mode flag living there would be silently dropped the moment a filter changed. Keyboard handling is bound to the queue's own container, never `document`, for the same reason every other document-level shortcut in this app is Escape-only: a bare letter key on `document` would fire while typing into the ledger's note field, a filter popover, or the command palette's own search box.

### Verification

12 new frontend tests (`TriageQueuePage.test.jsx`) covering largest-first ordering, j/k navigation without side effects, category filtering and assignment (by keyboard and by click), the "also create a rule" checkbox both ways, undo, a parent category correctly excluded from the assignable list, and an inline error that leaves the merchant in the queue. Full suites (756 backend, unaffected; 804 frontend) green, lint and build clean.

## [0.38.0] - 2026-09-27

Roadmap item T4.2 (`ROADMAP.md`) - the Dashboard now leads with a plain-language read of the month, not just charts of it.

### Added

- **Dashboard narrative** (`components/DashboardNarrative.jsx`, `utils/narrative.js`) - a fixed sentence or two above the widget grid: total spent, the month-over-month change, the biggest-moving category, an over-budget count, and an uncategorized count - each a real drill-down link into the ledger or `/reports` where relevant. Fixed rather than a removable widget.
- **`services/trends.top_movers(periods, grid_rows)`** (backend) - the categories with the largest |delta| between the last two periods, ranked and limited, alongside `monthly_summaries`/`budget_totals` in the same module and following the same "derived from `category_grid`'s own rows, never a second query" contract.
- **`GET /reports/monthly` gained three fields**: `top_movers`, `prior_summary` (the prior period's own income/spending/net, via `trends.monthly_summaries`), and `has_prior_period_data` (whether the prior period has any real transaction anywhere in the ledger - `category_grid` zero-fills every period regardless, so this is what tells "a real zero month" apart from "before the ledger existed"). No new endpoint; the Dashboard's existing `/reports/monthly` call moved from `months=1` to `months=2`.
- `utils/budgets.overBudgetLines()` - the over-budget filter lifted out of `NeedsAttentionWidget` into a shared function, so the narrative's over-budget count can never quietly disagree with the widget that already shows the same categories.

### Verification

"No data is not zero" holds throughout: on the earliest month in the database, the comparison clause and the biggest-mover sentence are both omitted rather than compared against a phantom zero prior period; a real, genuinely zero-spend prior month still gets a comparison, just as an absolute change rather than a percentage against a zero base. 9 new backend tests (`test_trends.py` x4, `test_reports.py` x5) + 20 new frontend tests (`narrative.test.js` x12, `DashboardNarrative.test.jsx` x2, `budgets.test.js` x3, `DashboardPage.test.jsx` x3). Full suites (756 backend, 792 frontend) green, lint and build clean.

## [0.37.0] - 2026-09-27

Roadmap item T4.3b (`ROADMAP.md`) - the frontend half of T4.3a's backend filter, plus quicker access to the ledger's existing chips.

### Added

- **Quick filter presets** above the ledger's filter chips - This month, Last month, Uncategorised, This import - each calling the exact same `applyFilterPatch` path a chip itself uses. "This import" scopes to the most recently imported batch (`/import-batches`' own newest-first order) and is disabled when nothing has been imported.
- **Import batch chip** - a seventh filter chip, scoping the ledger to one CSV import by filename, from the batch list already fetched for the History table (no new request). Labelled "Import batch" rather than "Import" to avoid colliding with the Import card's own title.
- **A clear (×) button on every active chip** (`HeaderFilter.jsx`), beside the chip rather than inside it - a chip is itself a `<button>`, and nested interactive controls are invalid HTML. A third way to clear one filter, alongside the popover's own Clear and the toolbar's Clear all filters - worth the single click since it's the one reached from most often.
- `currentMonthRange()` / `previousMonthRange()` (`utils/format.js`) - the calendar-month bounds behind the two date presets, using the same UTC-safe date arithmetic `lastInclusiveDay` already established.

### Verification

16 new frontend tests (`HeaderFilter.test.jsx` x2, `ledgerFilterParams.test.js` x5, `format.test.js` x5, `TransactionsPage.test.jsx` x4) plus one existing `TransactionsPage.test.jsx` assertion extended from six filter names to seven. Full suites (747 backend, unaffected; 772 frontend) green, lint and build clean.

## [0.36.0] - 2026-09-27

Roadmap item T4.3a (`ROADMAP.md`) - backend groundwork for T4.3b's "This import" filter chip and T4.4's ledger triage queue. No UI change yet.

### Added

- **`import_batch_id` ledger filter** (`services/ledger.TransactionFilters`, `build_transaction_query`) - an exact match against a transaction's own import batch, threaded through all three endpoints that build a ledger query: `GET /transactions`, `GET /transactions/export`, and `GET /transactions/groups` (which builds its own separate `TransactionFilters` and needed the parameter added there too). A hand-entered transaction has no batch to match, so scoping to a batch id simply excludes it - the correct behaviour with no special case.

### Verification

5 new backend tests (`test_ledger.py`, `test_transactions.py` x2, `test_transaction_groups.py` x2) covering the filter at the service layer and across all three endpoints, including that it composes correctly with the grouped view's own uncategorized-override. Full backend suite (742 + 5 = 747) green; frontend untouched.

## [0.35.0] - 2026-09-27

Roadmap item T4.5b (`ROADMAP.md`) - Finding 12: everything except the Dashboard was one vertical column of full-width cards.

### Added

- **Two-column layout on `/reports`, `/categories` and `/accounts`** (`.page-columns` in `shell.css`) at viewports wider than 1100px, for the independent, narrow top-level cards on each page - Reports' Month/Monthly Summary/Uncategorized Review, Categories' Presets/Add Category and its separate Combine/Split/Unused/Archived group, Accounts' Backup/Add Account. Wide per-category tables (Budget vs Actual, Category Totals Over Time, All Categories, Monthly Budgets, Pay Period Budgeting, All Accounts) stay full-width, outside the grid - squeezing a many-column table into a half-width space would make it illegible rather than denser.

### Verification

`.page-columns` is not a `.card`, so every existing `.closest('.card')` scoping helper across the three pages' test files - the dominant test idiom in this codebase - finds the same nearest card exactly as before. Full suites (742 backend, unaffected; 756 frontend) green with zero assertion changes, lint and build clean.

## [0.34.0] - 2026-09-27

Roadmap item T4.1a (`ROADMAP.md`) - Finding 18: eleven destinations had outgrown a single wrapping link row.

### Added

- **Sidebar navigation** replaces the top header/nav row - a persistent left rail with the app's brand and version, a search entry point into the command palette, Home and Alerts as standalone links, and the four page groups (Money/Plan/Insight/Setup) each with an inline icon (`navIcons.jsx` - decorative, `aria-hidden`, so no link's accessible name changes). The theme selector moves to the bottom of the rail.
- **Collapse-to-icons**, toggled from the rail and persisted in `localStorage` (`sidebar.js`, the same read/store shape `theme.js` already uses for the theme mode) - link text is hidden with the same clip technique `.visually-hidden` uses, never unmounted, so nothing queryable about a link changes when it collapses.
- **An off-canvas drawer below 900px**, behind a hamburger button always present in the DOM (shown only below that width by CSS) - closes on Escape, an outside click, or navigating to a new page.
- `services/commandPalette.ts`, a small pub-sub module (mirroring `services/toast.ts`'s own shape) letting the sidebar's search button open `<CommandPalette>` without lifting its `open` state out of the component - its existing Ctrl+K path and all 17 of its tests are unaffected.

### Changed

- `--sidebar-width`, `--sidebar-width-collapsed` and `--table-scroll-reserve` added to `index.css` as single, un-themed structural tokens (alongside the spacing/radius scales, not repeated per theme). The ledger's `.table-scroll` now reads its scroll-region height from `--table-scroll-reserve` instead of a literal `220px` baked in for the old top header - with a `max(320px, ...)` floor so a short viewport can no longer collapse the scrollport toward nothing - and the token is overridden inside the 900px breakpoint, where the sidebar becomes a top bar again.
- `<main className="app-shell">` (which wrapped the nav) split into a plain `<div className="app-shell">` grid with `<aside>` and `<main>` as proper siblings - a landmark correctness fix, made while already touching this structure.

### Verification

Full suites green with **zero assertion changes** to `App.test.jsx` (all 11 tests) or `CommandPalette.test.jsx` (all 17 tests) - the sidebar rewrite was scoped tightly enough that nothing existing needed to move. 750 frontend tests plus 6 new (`sidebar.test.js`) = 756; 742 backend, unaffected. Lint and build clean.

## [0.33.0] - 2026-09-27

Roadmap item T4.0 (`ROADMAP.md`), the first of Tier 4 - UI & navigation uplift. Purely internal: no user-visible behaviour changed.

### Changed

- **`frontend/src/App.css` split into four files** (`src/styles/shell.css`, `primitives.css`, `features.css`, `motion.css`), imported from `App.jsx` in that order. Every rule moved verbatim - no selector, property or class renamed - verified by comparing the non-blank line contents of the four new files against the original as a multiset (exact match) and confirming brace counts agree (215/215). Done ahead of the rest of Tier 4 because the single shared `prefers-reduced-motion` block only worked by being *last* in a 1731-line file; from this file split's `motion.css` being imported last, that ordering is now structural rather than something a large append could silently violate. Tier 4 goes on to add a drawer animation, a narrative block and a triage queue, any of which could otherwise have landed after that block by accident.

## [0.32.0] - 2026-09-26

Roadmap item T3.4 (`ROADMAP.md`), the last of Tier 3 - Finding 15: every action reported through inline text a user may already have scrolled past.

### Added

- **Toast notifications** (`services/toast.ts`, `components/ToastContainer.jsx`) - a transient, bottom-right confirmation for an action that just succeeded ("Imported N transaction(s)", "Budget saved", a preset/rule-apply summary). State lives in a module-level pub-sub store outside React, the same pattern `services/api.ts`'s own build-mismatch detection already uses, so any call site can fire one via `showToast()`. Scoped to success confirmations only - `<ErrorState>` remains the one place any error appears. Respects `prefers-reduced-motion`.
- Wired into a representative set of call sites (ledger import, a budget save, the Queensland preset, Apply rules now) alongside their existing inline messages, not instead of them - this is additive polish, not a replacement for anything a user needs to actually read and act on.

## [0.31.0] - 2026-09-26

Roadmap item T3.3 (`ROADMAP.md`) - Finding 16: a fresh install was a wall of empty cards on every page, with no sequencing to say what to do first.

### Added

- **Getting Started checklist** on `/` (`components/OnboardingChecklist.jsx`) - four steps (import a statement, classify accounts, set up categories, set a budget), each linking straight to the page that does it. Every step is an existing feature; this is sequencing and copy, not new machinery. Self-fetches just enough to know what's already done, and renders nothing once every step is complete.

## [0.30.0] - 2026-09-26

Roadmap item T3.2 (`ROADMAP.md`) - a rule's narration pattern was a single case-insensitive substring with no OR, which is exactly why rule review's "merge" could only ever mean "delete the rule that can never fire".

### Added

- **Rules v2** - a rule can now OR in extra narration patterns (**Also match**) and/or treat every pattern as a case-insensitive regular expression (**Treat patterns as regular expressions**), both opt-in and fully additive - a rule using neither behaves exactly as it always has. `services/categorization.py`'s single matcher (`rule_patterns`/`narration_matches`) still serves import, preview and apply alike, unchanged in that respect.
- Rule review's subsumption analysis was generalized (not rewritten) to the same containment rule applied to two OR'd pattern sets instead of two bare strings; a regex rule (either side) is deliberately excluded from the analysis entirely, since containment between two arbitrary regexes isn't decidable in general.
- An invalid regex is rejected with a 422 at save time and by Check matches, naming the specific pattern that failed - never saved silently as a rule that matches nothing.

## [0.29.0] - 2026-09-26

Roadmap item T3.1 (`ROADMAP.md`), the first Tier 3 item - the forecast projection already existed; the unanswered question was "what if this subscription stops, or this category drops 20%".

### Added

- **Forecast scenarios** - a non-destructive "what if" overlay on `/forecast`'s existing projection (`services/forecast.py`), never a stored adjustment to real data. Stop a recurring commitment for this projection only (deliberately not the same as dismissing it - a scenario-stopped series still counts toward the everyday run-rate exclusion, since it genuinely did happen), and/or adjust a category's everyday spending by a percentage, decomposed from the exact same run-rate window `daily_run_rates()` already computes (`category_daily_rates()`) so it can never silently disagree with the baseline figure.
- `POST /api/forecast/scenario` - same response shape as `GET /forecast`, so the frontend can diff the two directly. Nothing is ever written to the database; the identical scenario always returns the identical answer.
- The Forecast page's chart swaps to a direct baseline-vs-scenario comparison (baseline muted) while a scenario is active, plus a one-line summary of the projected difference.

## [0.28.0] - 2026-09-26

Roadmap item T2.5 (`ROADMAP.md`), the last of Tier 2 - Findings 9, 13/17, 14: a flat nine-link nav, a ledger that only ever horizontally-scrolled on a phone, and charts whose only hover feedback was a native, unstyled, mouse-only `<title>` tooltip.

### Added

- **Grouped navigation** - `pageRegistry.jsx` pages now declare a `group` (*Money*, *Plan*, *Insight*, *Setup*); the nav clusters them accordingly, with Home and the new Alerts link (both cross-cutting, not content areas) staying standalone. Stacks into full-width rows below 900px.
- **Responsive ledger tables** - the ledger's plain and grouped-by-merchant tables both become one card per row below 700px instead of forcing horizontal scroll, via a visually-hidden `<thead>` (still real column headers for a screen reader) and per-`<td>` `data-label`s restored as `::before` content.
- **Shared chart tooltip** (`components/charts/ChartTooltip.jsx`) for `LineChart`/`BarChart` - a themed HTML tooltip layered over the existing native `<title>` (left untouched), positioned from the hovered element's real screen rect. Fires on hover for every point/bar, and additionally on keyboard focus for whichever are already focusable (the drill-down-enabled ones) - a keyboard user gets the same tooltip a mouse user does, without adding a new Tab stop to every chart.

## [0.27.0] - 2026-09-26

Roadmap item T2.4 (`ROADMAP.md`) - Finding 6: over-budget categories, a subscription's price rise, a missed bill, a coverage gap, an unmatched transfer are all already computed somewhere in the app, but none of them is surfaced unless you happen to visit the right page.

### Added

- **Alerts feed** (`/alerts`, plus an "Alerts (N)" badge on the nav link) - `services/alerts.py` assembles four EXISTING computations (over-budget categories, `recurring.detect_series`'s missed/stopped and price-change signals, `coverage.account_coverage_gaps`, `transfer_matching.unmatched_transfer_legs`) into one feed. No new detection anywhere - this module only queries and wraps.
- **Dismissible, and stays dismissed.** A recurring-sourced alert reuses the *existing* `POST /recurring/dismissals` mechanism verbatim, rather than a second, parallel dismissal system for something `/recurring` already has one of. The other three kinds share one new, generic `AlertDismissal` table, keyed on a deterministic string built from the alert's own identity (e.g. `over_budget:{category_id}:{year}:{month}`) - a different occurrence of the same *kind* of problem is never silently suppressed by an old dismissal of a different one.
- `GET /api/alerts`, `POST`/`DELETE /api/alerts/dismissals` (the generic path); the recurring path is the pre-existing `/api/recurring/dismissals`.

## [0.26.0] - 2026-09-26

Roadmap item T2.3 (`ROADMAP.md`) - Finding 5: each leg of a transfer is categorized independently and nothing pairs them, so a single mis-categorized leg silently inflates both spending and income.

### Added

- **Transfer Matching** card on `/transactions` (`GET /api/transfers`) - surfaces candidate transfer pairs whose categorization doesn't (yet) agree they're a transfer, and any transfer-categorized transaction with no matching counterpart. Never recategorizes anything automatically - the same "surface it, don't guess" posture as balance-sign inference.
- `services/transfer_matching.py` - matches two transactions across two *different* accounts with exactly opposite amounts within a few days of each other, by amount and date proximity alone (deliberately not narration - each side of a real transfer is usually worded differently by its own bank). A same-account equal-and-opposite pair (a purchase and its refund) is never matched, and each transaction is used in at most one pair.
- `GET /api/transfers` returns both signals in one response: `matches` (candidate pairs, flagged `both_categorized_as_transfer`) and `unmatched` (transfer-categorized legs with no counterpart).

## [0.25.0] - 2026-09-26

Roadmap item T2.2 (`ROADMAP.md`) - Finding 3: the preset household is paid fortnightly, and three months a year hold three pay cycles, which a strictly calendar-monthly budget mis-states in both directions.

### Added

- **Pay Period Budgeting** card (`/categories`, below Monthly Budgets) - a fortnightly VIEW over the existing monthly budgets, not a second, independently-edited budget period (per the roadmap's own recommendation, since making the budget period itself configurable would touch reporting/trends/dashboard's month-bounds assumptions throughout). Set one household-wide payday (`PaySchedule.anchor_date`, a new single-row table) and every expense category's standing monthly budget is rescaled to a fortnightly pace (`amount * 12 / 26`, the real pay-calendar convention) and compared against that fortnight's actual spending, with Previous/Next navigation between periods.
- `services/pay_periods.py` - `pay_period_bounds()` counts whole 14-day steps forward/backward from the anchor, correct across a three-pay month and a calendar-year boundary alike (both are exactly what the roadmap's own acceptance criteria asked for). Pacing deliberately reads only a category's STANDING budget, never a monthly override - a fortnight can straddle two different months, each with its own override, and there's no principled way to pick one; documented as a limitation, not an oversight.
- `GET`/`PUT /api/pay-schedule` and `GET /api/pay-periods` (optional `reference_date`) - the latter always answers `{"configured": false}` rather than 404ing when no payday has been set, so the frontend never needs special-case error handling for "not set up yet". The pay schedule is included in the JSON database backup ([T1.4](README.md#exporting)).

## [0.24.0] - 2026-09-25

Roadmap item T2.1 (`ROADMAP.md`) - Finding 2, the biggest conceptual gap between a spending reporter and a budgeting tool: $100/month toward $1,200 of annual car registration used to read as eleven quiet months and one catastrophic one, because nothing accumulated.

### Added

- **Budget rollover (sinking funds)** - a per-category opt-in ("Roll unspent budget into next month" on `/categories`). Unspent budget accumulates into next month's available amount; overspend carries forward as a deficit. `Category.rolls_over` plus `rollover_start_year`/`rollover_start_month` (stamped automatically the moment it's switched on, cleared when switched off - not the category's creation date, which could predate opting in by years and would make the very first accumulation walk arbitrarily expensive and arbitrarily large).
- `services/budgets.rollover_available()` / `rollover_history()` - a new, deliberately separate resolver from `effective_budget()`: "what's available including everything carried forward" is a different question from "what's this month's own nominal budget," and every existing caller of `effective_budget()` is completely unaffected by rollover's existence. `CategoryPeriodTotal.available_amount` (new, `None` for every non-rollover category) and `difference` (now computed against `available_amount` when present) carry this into `/reports` and `/budgets` - a rollover category's over/under-budget reading reflects its accumulated carry-in, which is the entire point of the feature.
- Monthly Budgets (`/categories`) gained an **Available** column and a "rolls over" badge, shown alongside - never instead of - the month's own standing/effective figures, so the two numbers can't be confused with each other. `/reports`' Budget vs Actual table gained the same badge with its accumulated figure inline, since its Difference column is silently computed against that number for a rollover category, not the bare Budget figure shown next to it.
- **Known scope limit, recorded rather than solved**: `/trends`' multi-month grid (`category_grid`) still shows the nominal, non-accumulated budget line for a rollover category - it has no "difference"/over-under concept to begin with, unlike `/reports` and `/budgets`, so extending it wasn't part of what this task's acceptance criteria actually needed.



Roadmap item T1.6 (`ROADMAP.md`), and the last of the Tier 1 roadmap items - Finding 11: nine destinations and thousands of transactions, with navigation by scanning a flat link row.

### Added

- **Command palette** (`Ctrl+K`/`Cmd+K`, `frontend/src/components/CommandPalette.jsx`) - the one UI element in the app that exists purely for keyboard users, since it has no pointer-only path to reach it at all. Searches pages (`pageRegistry.jsx`), categories, accounts and merchants, grouped by kind; arrow keys move the selection, Enter activates it, Escape or clicking outside closes it. Mounted once in `App.jsx`, outside the routed `<Routes>` tree, so it survives navigation instead of remounting (and losing its lazily-fetched categories/accounts) on every route change. Categories and accounts are fetched once, lazily, the first time the palette opens - not eagerly on every page load, which would add two requests to every single page view for a feature most sessions never open. Merchants are searched live, debounced 200ms, through the same `GET /transactions/groups?search=` the ledger's own Group by merchant view already uses, since there is no "list every merchant" endpoint to fetch upfront.

## [0.23.4] - 2026-09-25

Roadmap item T1.5 (`ROADMAP.md`) - Finding 7: the two headline numbers households actually track, and every input already existed.

### Added

- **Savings Rate and Runway stat tiles** on the Dashboard. Savings Rate (`net_saved / total_income`) and Runway (current Everyday + Savings balances - `services/net_worth.liquid_assets`, a new function - against the window's own average monthly spend) join the existing stat tile metrics, reading through the same `GET /api/reports/kpis` fetch every tile already shares - no new per-widget request. Both are ratios, rendered as a percentage or a count of months (`utils/format.js`'s new `formatPercent`/`formatMonths`) rather than a dollar figure; `StatTile` gained a `formatValue` prop for exactly this, defaulting to the existing currency formatting so every other metric is unaffected. Both are **undefined, not zero**, on the one denominator that makes them meaningless - no income to rate, or no expenses to divide runway's assets by - the same "no data is not zero" convention an account's null balance already follows elsewhere in the app. Neither is clickable, since a ratio has no transactions of its own to open the ledger to.

## [0.23.3] - 2026-09-25

Roadmap item T1.4 (`ROADMAP.md`) - Finding 8: years of financial history with no way out, behind a Watchtower auto-updater that runs Alembic migrations unattended (0.21.5's own README warning).

### Added

- **Export CSV** on the ledger's filter bar (`GET /api/transactions/export`) - the filtered ledger, unpaginated, sharing its filter validation with `GET /transactions` itself (`api/transactions._validated_ledger_query`, factored out so the two can never accept a filter combination differently). Categories resolve to names, and a split transaction's several allocations flatten into one cell rather than either an arbitrary pick or a second CSV row per allocation. Deliberately NOT designed to round-trip through import - its header and extra columns (Category, Note) don't match any bank layout, which `services/csv_formats.py` matches by exact string; a categorized, split-aware export is the whole point, at the cost of not being the bank's own shape.
- **Download backup (JSON)** on `/accounts` (`GET /api/export/database`) - every table, unfiltered, built from the same response schemas the API's own list endpoints already return (`services/export.py`), so a record in the snapshot can never describe itself differently than the app would. No restore-from-snapshot endpoint exists on purpose - true point-in-time recovery is a Postgres-level restore.
- Both are plain `<a href>` download links, not calls through the frontend's own `api` client - the browser saves the file from the response's `Content-Disposition` header.

## [0.23.2] - 2026-09-25

Roadmap item T1.3 (`ROADMAP.md`) - Finding 4: import is the only way a transaction enters the ledger, so a forgotten statement period silently understates every total with no signal anything is missing.

### Added

- **Statement coverage checking.** A new **Statement Coverage** card on `/accounts/:id` (`GET /api/accounts/{id}/coverage`, `services/coverage.py`) proves an account's imported history is arithmetically continuous, using the bank's own running Balance every transaction already carries: a later transaction's balance must equal the earlier one's plus its own signed amount, an identity rather than a heuristic. A break is reported with the date range on either side and the size of the discrepancy - almost always a missing statement, though a duplicate or corrupted row produces the identical signature. The check deliberately never compares two transactions on the *same day* (file order for one date doesn't reliably become import id order) and never crosses *accounts* (a grouped account's members are genuinely different bank accounts in succession - see [Account groups](README.md#account-groups) - so each is checked purely on its own transactions).

## [0.23.1] - 2026-09-25

Roadmap item T1.2 (`ROADMAP.md`) - Finding 10: the ledger showed a row count for a filtered view but never what it added up to, the one number a household actually wants after narrowing to "Groceries, July".

### Added

- **A totals strip on the ledger** - money in, money out and net for the *whole filtered set*, not just the current page (`services/ledger.ledger_totals`, `GET /api/transactions`'s new `total_in`/`total_out`/`net_total` fields). Sums each matching row's own signed amount - the exact figure already shown per row - so a split transaction matched via only one of its allocations still contributes its full amount, consistent with what the table itself displays rather than the narrower per-category figure `/reports` uses. Identical above both the plain and the grouped-by-merchant table (`services/ledger.transaction_group_totals`, `GET /api/transactions/groups`'s matching fields) - grouping only changes how the same filtered set is shown, never what it totals to.

## [0.23.0] - 2026-09-25

Roadmap item T1.1 (`ROADMAP.md`) - the first practice-gap finding from a full review of the app against household-budgeting norms: import was the only way money could enter the ledger, so cash spending, a reimbursement, or anything not yet on a statement simply couldn't be recorded.

### Added

- **Manual transaction entry.** A new **Add a Transaction** form on `/transactions` (`POST /api/transactions`) records a row by hand against any existing account. Unlike an imported row, its balance is **computed** - the account's own current balance plus the new row's signed amount - which only holds together if the entry becomes the account's new latest transaction, so a manual entry must be dated on or after the account's current latest one (documented in the new "Manual transactions" README section, with the reasoning in `create_transaction`'s own docstring). A row with no category chosen is auto-categorized by a matching rule immediately, same as on import. Every manual entry shares one `ImportBatch` ("Manually added"), so frequent cash entry doesn't flood the batch history with one-row imports.
- **Editing a manual transaction.** `PUT /api/transactions/{id}` lets a manual row's own date, narration, amount, category, note and type be changed after creation - a new **Edit** action on its Details disclosure, alongside Split/Make rule/Delete. An imported row is unaffected: it has no Edit action and stays editable only via category/note/splits, exactly as before (`Transaction.is_manual`, migration `a762ac78878d`). Editing re-validates the same "must still be the latest" rule against the account's *other* transactions.
- A **"manual"** badge on a hand-entered row's narration cell, so provenance is visible without opening Details.

## [0.22.1] - 2026-08-10

### Changed

- **The ledger's filter toolbar is one consistent row of chips, the same whether or not Group by merchant is on.** Filtering lived on the column headers it narrowed, Excel-style — which had no answer for the grouped view, whose table has none of those columns, so the same five popovers were duplicated inline and appeared only while grouped. Toggling the view therefore rearranged the toolbar (and moved the filters) exactly when someone reached for them. Now every filter is a chip above the table in both views, the table headers keep sorting only, and the duplicated popover bodies collapse into one definition (`filterChips` in `TransactionsPage.jsx`).
- An active chip **shows its value** — `Narration: woolworths`, `Date: 01/07/26 – 31/07/26`, `Account: Joint Everyday` — so a glance at the row says what the view is narrowed to. Previously the only indication was a dot next to a `▾`, which said that *something* was set but never what. Ids are resolved to names (including account groups and category paths) by `describeFilters` in `components/ledgerFilterParams.js`, falling back to the raw value for an id it can't resolve rather than rendering an empty chip that would read as "no filter".
- **Transaction type is a chip like the rest.** Having no column of its own used to make it the one filter rendered as a bare `<select>` among the popovers; that stopped meaning anything once the chips were no longer tied to columns.
- **Clear all filters** stays put and greys out when nothing is filtered, rather than sitting there always-enabled, and carries the number of filters in force — where a date or amount *range* counts once, not twice, because one range is one thing the reader set.
- `HeaderFilter`'s `as="div"` flavour is now a proper chip: the whole pill is the button, so the click target is the word "Account" rather than a 20px caret beside it, with the label, the value and the caret inside one control. The `as="th"` flavour (the account-detail ledger, where the header also sorts) is unchanged.

## [0.22.0] - 2026-08-10

Three changes, prompted by a screenshot of another finance app's reports dashboard used as UI inspiration.

### Added

- **A customisable Dashboard.** `/` is now a grid of widgets a user can add, remove, resize and reorder (**Edit dashboard**/**Add new widget**) instead of a fixed list of cards — layout is server-side state (`GET`/`POST`/`PUT`/`DELETE /api/dashboard/widgets`, `backend/app/api/dashboard.py`, `DashboardWidget` in `models.py`), reordered the same swap-priority way `/rules` already reorders itself, and seeded with today's layout by the migration that creates the table (`e4a2c9f1b7d3_add_dashboard_widgets`) so a fresh install looks exactly as before. Every widget still reads live from the same endpoints the page always used — one shared fetch per data source (e.g. one `GET /api/reports/kpis` call however many stat tiles are on the page), not one per widget instance. `src/widgetRegistry.jsx` is the single source of truth for what a widget *is*, mirroring `pageRegistry.jsx`'s "one entry, wired in everywhere" idiom for pages.
- **Four new widget families**: **Stat tiles** (Total Income, Total Expenses, Avg Per Month, Avg Per Transaction, Net Saved, or a plain count, from a new `GET /api/reports/kpis`), **Net Worth Change** (a delta over a window, sourced from data `/trends` already fetches), **Transaction Calendar** (a day-by-day grid, green/red bars by net direction, from a new `GET /api/reports/daily`), and **Spending Pace** (this month's cumulative spend against last month, a 3-month average, or a budget paced evenly across the month, with the gap as the headline figure).
- **Drill-down on every remaining chart** — Dashboard's Cash Flow (by kind and month) and Net Worth (by month), and `/accounts/:id`'s balance history (by month, scoped to that account) — completing what `/trends` already had. `BarChart` gained a per-bar `onSelectBar` (mirroring `LineChart`'s own per-point `onSelectPoint`), replacing the whole-column `onSelectPeriod` `/trends`' income-vs-spending and budget-vs-actual charts used before; those two now drill by kind straight into the filtered ledger instead of jumping to `/reports`. The ledger's Category filter gained Income/Expenses/Transfers options (a new `kind` filter, `services/ledger.py`), so a chart's drill-down target is a real, clearable filter in the UI too. `LineChart` also gained a `muted: true` per-series style (a dashed, `--text-muted` line) for the "one series is the point, the rest are context" case, used by Spending Pace's own comparison line.
- Pending card authorisations are dropped at import: a row whose narration starts with `AUTHORISATION ONLY - ` and carries a numeric Debit is skipped (not imported) as a bank's pre-authorisation hold that later settles as its own row — importing both would double-count the spend (`services/csv_import._is_pending_authorisation`). Skipped before that row's own fields are validated, so a hold with an incomplete export (e.g. no Balance) can't reject the whole file; a settled transaction reusing similar wording (a refund) is unaffected, since a blank Debit never matches. Reported as `skipped_authorisation_count` in the import result, the batch history table, and the CSV mapping preview panel. Applies to future imports only.

## [0.21.5] - 2026-08-10

**The actual root cause, found by reviewing the compose file for multi-app suitability — and it supersedes 0.21.2, 0.21.3 and 0.21.4's workarounds.** Docker's embedded DNS is **per-network**: a container resolves only the names of containers on networks it is itself attached to. So a `web` container on nothing but its own Compose project network resolves `api` to exactly one thing — that project's own API — no matter how many other applications on the NAS also name a service `api`. The intermittent 404s were only ever possible because the deployed `web` could see the shared `dbnet`, where every application's api service claims the generic alias `api`. Renaming services (0.21.2), declaring explicit aliases (0.21.3) and pinning `container_name` (0.21.4) were all treating the symptom; the two services just needed to talk over the project-private network.

### Fixed

- **`docker-compose.qnap.yml` could not serve a single request as written.** The api service was attached to `dbnet` only while `web` fell through to the project default, so the two shared no network and `web` could not reach `api` by any name — and separately, the web image's default upstream (`homebudget-api`) named a container that no longer existed once `container_name:` was removed. The api service is now on `[dbnet, default]`, and `web` explicitly on `[default]` with a comment marking that line as load-bearing.
- `frontend/Dockerfile`'s default is now `API_UPSTREAM=api:8000` — the compose **service** name, which resolves on the project network for any stack built from this template. This removes the image/compose version coupling entirely, which matters more than it sounds: Watchtower replaces the web image unattended, with no way to update the compose file in the same action, so a default that only worked with one specific compose file was a scheduled outage.
- Assorted drift in the compose file: an orphaned comment describing a `container_name:` that had been removed, a `DATABASE_HOST` error message naming the retired `DB_NETWORK_NAME` variable, and trailing whitespace.

### Changed

- README's QNAP section leads with the structural rule (**`api` joins `dbnet`, `web` never does**) and gains a **"Running several apps from this template on one NAS"** section: distinct application name and `WEB_PORT` per app, only `api` on `dbnet`, no `container_name:` (host-global, so two apps sharing one means the second refuses to start), plus the residual note that a service is always reachable by its own name on every network it joins — so this app's `api` still offers that generic alias on `dbnet` to any neighbour that wrongly resolves it.
- A prominent warning on **Watchtower + unattended Alembic migrations**: `:latest` plus auto-update means a release containing a migration alters the live schema at whatever hour Watchtower runs, with nobody watching — keep backups, or pin the api image to a commit SHA for that release.
- Both troubleshooting sections rewritten around the per-network explanation; the "Reading the container names" section is gone (its premise was the reverted `container_name:` pinning), with the useful `<project>-<service>-<index>` arithmetic folded into the 502 section as a diagnostic. The variables table drops `DB_NETWORK_NAME`, `API_PORT`, `ALLOWED_ORIGINS`, `DEBUG_SQL` and `API_UPSTREAM`, none of which the compose file references any more.

## [0.21.4] - 2026-08-09

**Correction to 0.21.3's diagnosis.** The container names on the actual deployment (`homebudget-api-1` / `homebudget-web-1` — Compose's `<project>-<service>-<index>` naming, meaning the services are called `api`/`web`) prove the 0.21.2 rename never reached it: the deployed `docker-compose.qnap.yml` is a hand-maintained copy in Container Station, not a live pull from this repo, so it still had services `api`/`web` while the 0.21.2 web image already proxied to `homebudget-api` — a name that plainly did not exist in that deployment, hence `Host not found` on every call. 0.21.3 read the same symptom as a Container Station networking quirk (Compose's service-name-alias behaviour "not guaranteed on every setup") and added an `aliases:` workaround for a problem that was actually just a stale deployed file. That claim is removed from `frontend/nginx.conf` and `docker-compose.qnap.yml`'s own comments, and from README's "502 Bad Gateway" section, which now gives the corrected account.

### Changed

- `docker-compose.qnap.yml`'s services are **`api`/`web` again**, not `homebudget-api`/`homebudget-web` — matching the file actually deployed, and removing the 0.21.3 `aliases:` workaround along with it. What actually fixes the original 404 collision (a *different* application's service also named `api` on the shared network) without a service rename: each service now sets an explicit **`container_name:`** (`homebudget-api` / `homebudget-web`) — unique per Docker host by construction, unlike a network alias, which is exactly what let two same-named services collide. `frontend/nginx.conf`'s `$API_UPSTREAM` default targets that pinned name.
- README gains a **"Reading the container names"** section (linked from both troubleshooting entries) giving the naming table that distinguishes a current deployment (`homebudget-api`), a stale pre-`container_name:` one (`homebudget-api-1`), and an uncleanly-created one (a doubled `homebudget-homebudget-...` prefix) — the doubled-prefix note previously read as describing what 0.21.2's *correct* rename would itself have produced, which is no longer a live concern now the rename is reverted, but needed correcting so it never causes a needless delete-and-recreate again.
- `API_UPSTREAM` (the override escape hatch) and the self-explaining `502` JSON body added in 0.21.3 are unchanged — their value never depended on the wrong diagnosis, and they are exactly what turns any *future* image/compose mismatch into a one-field Container Station change instead of another release.

## [0.21.3] - 2026-08-09

0.21.2's rename shipped, and after a clean recreate of the Container Station application — both containers confirmed running — `homebudget-api` still came back `Host not found` from the web container, now consistently rather than intermittently (a `502 Bad Gateway` on every call instead of the previous 404s). The rename assumed a Compose service's own name always becomes its network alias; that assumption doesn't hold on every setup, and there was no way to correct it short of another release.

### Fixed

- `docker-compose.qnap.yml` now states the API service's network alias explicitly (`aliases: [homebudget-api]` on both `dbnet` and `default`) instead of relying on it being inferred from the service name.
- A new `API_UPSTREAM` compose variable (default `homebudget-api:8000`) is read by nginx at container start via the `nginx:1.27-alpine` base image's own template-substitution entrypoint (`frontend/Dockerfile` now copies `nginx.conf` to `/etc/nginx/templates/default.conf.template` rather than `conf.d/` directly, with `NGINX_ENVSUBST_FILTER` scoped to just that one variable so nginx's own `$host`/`$uri`/`$request_uri`/`$remote_addr` are untouched). A future mismatch between the configured name and whatever actually resolves is now a one-field change in Container Station, not another image build.
- A bare `502 Bad Gateway` explains nothing about which upstream failed or why. `frontend/nginx.conf` now returns a JSON body naming the configured `API_UPSTREAM` and pointing at the new README section whenever nginx's own proxy to the API fails (`error_page 502 504`) — rendered by the frontend the same way any other API error is, so the failure is legible on the page itself rather than requiring a container log.
- README gains a "Troubleshooting: 502 Bad Gateway" section covering this incident and how to find a working `API_UPSTREAM` value from a shell in the web container.

## [0.21.2] - 2026-08-09

0.21.1's diagnostics worked on the first reload after deploying — and showed the actual cause was different from what that release assumed. The API build answering some requests was reporting `v0.1.0 · 884ba6d`: a version and commit that appear nowhere in this repository's history, meaning the container involved isn't a stale or duplicated homeBudget deployment at all, but a **different application** whose service also happens to be named `api` on the shared Docker network — Compose makes a service reachable on its own service name as a network alias on every network it joins, and `api` is generic enough for a collision. Docker's DNS then hands back both containers' addresses for the name `api`, and nginx (resolving that name once at startup) round-robins across them for the life of the process.

### Fixed

- `docker-compose.qnap.yml`'s services are renamed `api`/`web` → `homebudget-api`/`homebudget-web`, and `frontend/nginx.conf` points at the new name — removing the collision-prone generic alias from the shared network entirely. **Requires recreating the Container Station application** from the updated compose file; the rename cannot be applied to a running app in place.
- `frontend/nginx.conf` also resolves the API's address **per request** now (an nginx `resolver` directive plus a `proxy_pass` target held in a variable) instead of once at container startup — a literal upstream name is cached for the worker process's lifetime, so even after fixing the DNS collision, the running `web` container would have kept talking to the wrong address until restarted.
- The enriched error message introduced in 0.21.1 named the wrong path: `error.config.url` is relative to `baseURL` ("/api") by design, so an error read as `GET /accounts` when the actual request was `GET /api/accounts` — worse than no path at all, since it pointed at a frontend routing bug that didn't exist. It now reads the real requested path (`services/api.ts`'s `requestedPath`), and additionally names which build answered when the response carries the `X-App-Version`/`X-App-Commit` headers 0.21.1 added, e.g. `404 Not Found — GET /api/accounts did not match any route on the API that answered (answered by build 0.1.0 · 884ba6d)` — the exact fact that took a manual `git log` check to recover this time.
- README's "API returns 404 but the page loads" section is rewritten to lead with this confirmed cause (a foreign container claiming the same name, identified by a version/commit that isn't in this repo's history) ahead of the previously-documented doubled-container-name case, which remains as a secondary possibility.

## [0.21.1] - 2026-08-08

Diagnostics for an intermittent "Not Found" reported across every page on a QNAP deployment, traced to two `api` containers left running behind Docker's round-robin DNS after an unclean Container Station app creation (the same root cause as the existing "API returns 404 but the page loads" note, but without the tell-tale doubled container name — see README's expanded troubleshooting section). No application code was at fault; these changes make the next occurrence identifiable from the UI itself instead of a guess.

### Added

- Every API response now carries `X-App-Version`/`X-App-Commit` headers (`backend/app/main.py`'s `add_build_identity_headers`), including a 404 for an unmatched route — the one response a per-route dependency would never run for, and the most likely to have come from a stale container. Sourced from the same `app/version.py` values `GET /api/version` already reports; no new resolution logic.
- The frontend compares that header across every response it receives (`frontend/src/services/api.ts`'s `recordBuildIdentity`) and shows *"Responses are coming from more than one API build"* in the footer the moment two responses disagree — reusing the existing frontend/API version-mismatch banner's slot rather than adding a second one. A build that consistently sends no header at all (this feature not yet deployed there) is never flagged; only a response that departs from what came before it is.
- An ambiguous API error — no `detail` field, or FastAPI's own generic route-matching body — is now enriched with the method, path and status that actually failed (e.g. `404 Not Found — GET /api/transactions did not match any route on the API that answered`), via one `axios` response interceptor in `services/api.ts` rather than editing the ~60 call sites that render `err.response.data.detail`. A real, specific `detail` from one of this app's own endpoints (`"Category not found"`) is returned completely unchanged.

## [0.21.0] - 2026-08-08

### Added

- **Combining and splitting categories** (`POST /api/categories/merge`, `POST /api/categories/split` and its `/preview`, `backend/app/services/category_restructure.py`), as two new cards on `/categories`. Combining moves every transaction, split allocation, rule and budget onto the category you keep and deletes the rest — deleting the duplicate instead detaches its history rather than moving it, which is the whole reason this exists; standing budgets and same-month overrides sum. Splitting carves one category into several new ones that inherit its kind and parent, each taking the transactions whose narration contains its own pattern (first match wins, same semantics as a rule), with **Preview** running the identical matcher before anything moves and an optional rule created per part for future imports. Combining refuses a group on either side or mixed kinds rather than guessing; anything a split's patterns don't match stays where it is.
- **Drill-down on every `/trends` chart.** Spending by category now charts sub-categories rolled up into their **group**, and clicking a group (a point or its legend entry) drills into that group's own children; clicking a leaf's point opens the ledger filtered to that category and month. The two bar charts drill by month, opening that month's `/reports`. The drilled-into group lives in the URL (`?group=`), and `/reports` now reads its month from the URL (`?year=&month=`), so both views are reloadable and shareable. `LineChart` gained `onSelectPoint`/`onSelectSeries` and `BarChart` gained `onSelectPeriod`/`periodSelectLabel` — all opt-in, so a chart without them renders exactly as before, and a series can opt out of a dead affordance with `selectable: false` (the summed "Other" line does).

### Changed

- Every table that names a category as a row of its own — the Monthly Budgets editor and Unused/Archived cards on `/categories`, both `/reports` tables, Dashboard's over-budget card, the `/rules` table — shows its full path (`Food › Groceries`) rather than a bare leaf name, and sorts by that same path. This is what the Monthly Budgets card was missing: a flat list of leaves with no group headings can't otherwise tell two `Insurance` rows apart, which the Queensland preset creates on the first press. `parent_id`/`parent_name` now ride along on every response that names a category (budgets, category usage, budget lines, the category grid, and a rule's own category); the ledger's per-transaction pickers are unchanged, since `<CategorySelect>`'s `<optgroup>` already shows the hierarchy.

## [0.20.0] - 2026-08-05

Follow-ups against v0.19.0's UI pass, from a dark-mode screenshot of `/transactions` with Group by merchant on.

### Changed

- Ledger dates render as `DD/MM/YY` (e.g. `31/07/26`) instead of raw ISO (`2026-07-31`), across the main ledger, `/accounts/:id`, Dashboard's Recent Activity, the CSV mapping preview, and the grouped view's date range — a new `formatDate` helper in `utils/format.js`. Prose and period labels (report months, "imported up to …") are unaffected.
- Debit and Credit are shown as one **Amount** column in the same four tables. Import already guarantees exactly one of the two is ever populated per transaction, so the merge is lossless; the column keeps the same sign-based colour it already had. The main ledger and account-detail pages each collapse two header filters/sorts into one shared `Amount` header. Dashboard's Recent Activity now sorts by magnitude, matching the definition the ledger's own amount filter already uses.
- `CategoryQuickAdd` gained a `hideSelect` prop — an affordance-only mode (just "+ New category", no select) for a caller with nothing for a select to apply to.

### Fixed

- The grouped-by-merchant view's Set-category cell was clipped at the card edge, with rows roughly 140px tall — a regression from v0.19.0's `white-space: nowrap` default, which stopped a long per-row label from wrapping. Each row now shows a plain category select and a compact **Set** button; **+ New category** moved to the toolbar (once per page, not once per row — restoring the intent `CategoryQuickAdd`'s own docstring already described). The grouped table also dropped its inner scroll box, so the page scrolls as one and its column headers stick to the viewport instead of a box that never grew tall enough to need its own scrollbar.

## [0.19.0] - 2026-08-05

### Added

- `CHANGELOG.md` itself, backfilled to 0.11.0 — this entry is the first one written alongside its own version bump, per the new process note in `README.md`'s [Versioning](README.md#versioning) section.
- Skeleton loading rows (`LoadingState`'s `rows` prop) on the ledger and merchant-groups tables, so a fetch no longer collapses the table to one line of "Loading..." text and jumps the page when it resolves.

### Changed

- UI foundation pass across the whole app, prompted by a screenshot review of `/transactions`:
  - Every page's outer section is a plain layout wrapper (`.page`) rather than itself being a `.card` — nested cards were rendering one level deeper than intended, showing as flat grey panels instead of elevated white ones. The modal and header-filter popover pick up the correct elevated surface as a result.
  - Table cells default to `white-space: nowrap` (opting back into wrapping only for genuinely long free-text columns — ledger narration, a rule's pattern, a recurring/forecast merchant name), fixing the ledger's date/account cells wrapping onto two lines and roughly doubling row height.
  - Numeric/money columns right-align their header, not just their figures, via a `numeric` prop on `SortableHeader`/`HeaderFilter`.
  - The header-filter `▾` toggle is a properly sized, bordered button with a visible resting and open state, rather than reading as a stray character next to the column label.
  - The ledger's filter bar and data-action toolbar are visually separated (Type/Clear all filters/Group by merchant above a rule, bulk actions below), rather than one ragged wrapping row mixing both.
  - The Import card's native file input is wrapped in a labelled, bordered control instead of sitting as raw browser chrome, and **Wipe all** now sits with the batch-history table it acts on rather than beside the upload control.
  - Table headers stick to the top of their scroll region (`.table-scroll` is now a bounded, genuinely scrollable container) so they stay visible on a long page like the ledger at 200 rows.
  - Base font size dropped from 18px to 16px with tracking reset to normal, tightening a dense financial app's default type without touching padding or hit areas.
  - `--shadow-md`/`--radius-lg`/`--space-6` (previously defined but unused) now style the modal, popover, card corners and top-level card spacing; short transitions on card collapse/popover open/modal entry, disabled under `prefers-reduced-motion`.

### Fixed

- `.badge-info` (the `auto`/`split` pills) used a hardcoded light-mode accent color instead of a themed token, rendering with the wrong contrast in dark mode. Now uses a new `--accent-bg` token, defined for both themes like every other badge color.

## [0.18.0] - 2026-08-05

Commit `63a849f`.

### Added

- Every table in the app is sortable by clicking a column header, cycling ascending → descending → off. The ledger and account-detail tables sort in SQL (they're paginated, so client-side sorting would silently only reorder the visible page); every other table sorts client-side. `/rules` is the deliberate exception — its row order is its evaluation order.
- Excel-style column filtering on the ledger and account-detail tables: a `▾` on a header opens a small popover with that column's filter and its own Apply/Clear, replacing the old standalone Filters card. Debit and Credit share one Min/Max amount filter, reflected on both headers.
- The grouped-by-merchant view is now paginated (10 per page, client-side over the already-fetched groups).

### Changed

- Import CSV and Import History merged into one card.

### Fixed

- Picking the category already showing in a merchant group's category dropdown (e.g. the alphabetically-first option) now enables **Set category** immediately — previously the browser displayed a category while React's own state stayed empty, so the guarded button never enabled until you picked something else first.

## [0.17.1] - 2026-08-05

Commit `29bc181`.

### Changed

- Merchant groups now report a **Categorized** column (`N uncategorized` / a category name / `Mixed`) so **Set category**'s effect is visible before you act, and scope correctly to the ledger's own Category and account-group filters.

## [0.17.0] - 2026-08-04

Commit `cbaf52a`.

### Added

- Accounts, Categories and Rules gained in-place row editing (`InlineEditRow`) — Edit opens a form directly beneath the row instead of scrolling you to a top-of-page card.
- **Make rule**, from a ledger row or a merchant group, opens an in-place rule editor with a live match-count preview and creates + applies the rule without leaving the ledger.
- **Review Rules** (`/rules`) surfaces rules that are shadowed, redundant, or otherwise unreachable given evaluation order, without changing anything itself.
- Account groups: accounts can be grouped, filtered and reported on as one unit.
- Amount parsing in CSV import now tolerates currency codes/symbols, thousands separators and accounting-style parentheses for negatives.

## [0.16.0] - 2026-08-04

Commit `a14a5da`.

### Added

- Savings goals (`/goals`) — account-balance or envelope-tracked, with progress and over-allocation warnings when envelope totals exceed what an account actually holds.
- Account **type** and **balance sign**, and a proper **net worth** calculation (`assets - liabilities`) built on them — replacing the earlier "combined balance" figure, which could misrepresent a liability account. Sign can be inferred from an account's own balance history.
- Dashboard's balance chart became **Net Worth**, sign-aware rather than a straight sum.

## [0.15.0] - 2026-08-04

Commit `8d5f9e8`.

### Added

- Category archiving — reversible, keeps all history intact, just removes the category from dropdowns and default lists. `/categories` gained **Unused** and **Archived** cards.
- Reports and Trends now show an archived category if it had real activity in the period, rather than silently dropping it.
- Dashboard gained a **Cash Flow** chart alongside the balance chart.

## [0.14.0] - 2026-08-03

Commit `a566597`.

### Added

- Mapped CSV import: a bank export with an unrecognized header no longer flatly rejects — a mapping panel lets you match its columns to the required fields, preview the result, and save the mapping for next time.
- Split transactions — one transaction can be allocated across several categories, with a live remainder gate before Save.
- Transaction notes, free-text, independent of splitting.
- `<ErrorBoundary>` around the routed page area, so a crash on one page doesn't take down navigation.

## [0.13.0] - 2026-08-02

Commit `7525bcc`.

### Added

- Theme selector (Light / Dark / Auto) in the header, persisted in `localStorage`. Auto follows time of day (dark 18:00–06:00), not the OS setting.
- Collapsible cards (`<Card>`) app-wide, remembering open/closed state per card.
- Sub-categories — a category may have one parent, one level deep, for grouping and display only.
- **Load Queensland household preset** on `/categories` — a starting chart of categories and indicative budgets, safe to run more than once.

## [0.12.0] - 2026-08-02

Commit `caca729`.

### Added

- **Group by merchant** on the ledger — replaces the per-row table with one row per merchant, with bulk **Categorize** and rule-creation actions, scoped to whatever filters are currently applied.
- Inline category creation (**+ New category**) from the ledger toolbar or a group's own row.

## [0.11.0] - 2026-08-01

Commit `766c09e`.

### Added

- Version reporting: the frontend header/footer and `GET /api/version` now show the running build's version and commit, with a mismatch notice if the frontend and API disagree.
- Shared `<Amount>`, `<Badge>`, `<LoadingState>`/`<ErrorState>`/`<EmptyState>` components, standardizing money formatting, status markers and loading/error/empty states across every page.
- Design token system (`index.css`) — colors, spacing, radii and shadows as CSS custom properties, with light and dark values defined together.

---

Commits before `766c09e` predate the `VERSION` file and are not individually numbered here.
