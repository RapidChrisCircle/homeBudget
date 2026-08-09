# Changelog

All notable changes to homeBudget are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are tracked in the repo-root `VERSION` file (see `README.md`'s [Versioning](README.md#versioning) section) — there are no git tags, so each entry below cross-references the commit that shipped it. `VERSION` was introduced at 0.11.0; commits before that point exist but predate any recorded version number, so this file starts there rather than inventing 0.1–0.10.

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
