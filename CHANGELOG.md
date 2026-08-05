# Changelog

All notable changes to homeBudget are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are tracked in the repo-root `VERSION` file (see `README.md`'s [Versioning](README.md#versioning) section) — there are no git tags, so each entry below cross-references the commit that shipped it. `VERSION` was introduced at 0.11.0; commits before that point exist but predate any recorded version number, so this file starts there rather than inventing 0.1–0.10.

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
