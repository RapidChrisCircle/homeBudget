# homeBudget

A household budget tool. Import bank transactions from a CSV export, categorize them (by hand or automatically), set budgets, and see where the money went.

Backend: FastAPI + SQLAlchemy + Postgres, schema managed by Alembic. Frontend: React + Vite, served by nginx in production.

## Pages

| Page | What it does |
|---|---|
| `/` | Dashboard — account balances, net worth, a 6-month cash flow chart and a net worth chart, this month's totals, over-budget categories, goals summary, uncategorized count, recent activity |
| `/transactions` | Import CSVs, and the filterable, paginated ledger |
| `/accounts` | Manage accounts, their type, balance sign, and groups; `/accounts/:id` is one account's balance and transactions |
| `/categories` | Manage categories, their kind, and their monthly budgets (standing + per-month overrides); combine duplicates and split one category into several |
| `/rules` | Auto-categorization rules |
| `/reports` | Monthly summary, budget vs actual, category totals over time |
| `/recurring` | Detected subscriptions and regular bills, next due dates, price changes |
| `/trends` | Multi-month charts: spending by category, income vs spending, budget vs actual — clickable, drilling from a group to its sub-categories, then out to the ledger or that month's report |
| `/forecast` | Projected account balances for the next few months |
| `/goals` | Savings goals — account-balance or envelope-tracked, with progress and over-allocation warnings |

## UI conventions

- **Design tokens** (`frontend/src/index.css`) — colors, spacing, radii, and shadows are CSS custom properties, with light and dark values defined together under `prefers-color-scheme` rather than as a second stylesheet. Element-level styling (buttons, forms, tables, cards, focus states) lives in `frontend/src/App.css` and applies by tag/class, so most pages carry no page-specific CSS at all.
- **`<Amount>`** (`frontend/src/components/Amount.jsx`) renders every money value app-wide: tabular numerals, two decimals, right-aligned in table cells. It colors by sign unless `neutral` is passed — `neutral` is for any figure that's a pure magnitude rather than a directional value (a budget, a spend total); combining `neutral` with an explicit `className` is for the rarer case where a raw value's sign doesn't match its domain meaning (e.g. an already-absolute "over budget" figure, or a recurring outflow that's always positive but should still read as a cost).
- **`<Badge>`** (`frontend/src/components/Badge.jsx`) is the one status-marker component (`auto`, `overridden`, `(over)`, recurring status), with five tones (`neutral`/`info`/`success`/`danger`/`warning`).
- **`<LoadingState>` / `<ErrorState>` / `<EmptyState>`** (`frontend/src/components/`) standardize the loading/error/empty markup every page needs, in place of each page hand-rolling its own `<p>`. `LoadingState`'s optional `rows` prop swaps the plain text line for that many shimmering skeleton row bars instead — for a table whose loading state would otherwise collapse it to one line and jump the whole page once it resolves — without changing what's announced to a screen reader: `message` is still there in the same `role="status"` region, just visually hidden rather than the only thing on screen.
- **`<Card>`** (`frontend/src/components/Card.jsx`) is every nested card's heading — collapsible, defaulting open, with the open/closed state remembered in `localStorage` per card. The outer page section each page itself lives in is a plain `.page` (layout only — no border, shadow or background, so real cards are genuinely the first `.card` in their ancestor chain rather than nesting one level deeper than they look), not a `<Card>` — collapsing a whole page reads as a broken page, not a tidied one. A `<Card>` needs an explicit `id` distinct from its title, since some titles change with the data they show (a month, an account name) and a title-derived storage key would lose the user's choice the moment that text changes.
- **Theme** — light, dark, or auto (the header's Theme selector; `frontend/src/theme.js` / `useTheme.js`), persisted in `localStorage`. Auto means **time of day** (dark 18:00–06:00 by a fixed clock, not geolocation), not the OS's `prefers-color-scheme` — the two are independent, and an explicit Light/Dark choice always overrides the OS setting. Both palettes were already fully defined in `index.css`; this only adds a way to choose between them instead of always following the system.
- **`<ErrorBoundary>`** (`frontend/src/components/ErrorBoundary.jsx`) wraps the routed page area only, not the header/nav/footer, so a render crash on one page leaves navigation to a working page intact. Keyed on the route path in `App.jsx`, so navigating away from a crashed page always gets a fresh attempt rather than staying stuck on the same fallback.
- **Every data table** has a visually-hidden `<caption>` and `scope="col"`/`scope="row"` on its header cells — the surrounding heading is enough context for a sighted user, but a screen reader user jumping straight into table navigation mode never passes it, so the table needs its own accessible name too.
- **Table cells default to `white-space: nowrap`** — a table is mostly short fields (dates, account names, types, figures), and without this the odd long value wraps onto a second line and drags every short neighbouring cell in the row down with it. The handful of genuinely long free-text columns opt back into wrapping explicitly via `.cell-wrap` (a rule's pattern, a recurring/forecast merchant name, Dashboard's Recent Activity narration; the ledger's own narration column has always had this via `.ledger-narration`, its original name). A money or count column's **header** right-aligns too, not just its figures — a `numeric` prop on `SortableHeader`/`HeaderFilter`, or the `.numeric` class by hand on a plain `<th>`/`<td>` that never passes through either. `.table-scroll` (the ledger, and CsvFormatMapper's preview tables) is a bounded, genuinely scrollable region so its column headers can stick to the top while it scrolls, not just scroll horizontally.
- **`<CategorySelect>`** (`frontend/src/components/CategorySelect.jsx`) is the one category `<select>` the app uses everywhere a transaction, split, group or rule needs to name a category. Children render grouped under their parent via a native `<optgroup>` — the label is inert by construction, which **is** the "a parent can never itself be assigned" rule, enforced by markup instead of a filter every call site has to remember. A `fallbackOption` prop covers a category that's since been archived: it's absent from the normal list, so the component can't look its name up itself and the caller passes `{id, name}` from whatever record (a transaction, a split, a rule) already has it.
- **In-place editing** (`InlineEditRow.jsx`) — Accounts, Categories and Rules all edit a row by opening a form **directly beneath it**, not in a card at the top of the page: click Edit, a row expands with Save/Cancel, full width via `colSpan`. This is the same disclosure idiom the ledger's own Details row already established (`aria-expanded`/`aria-controls` on the toggle, a sibling `<tr>` for the content), reused rather than inventing a second one. The top-of-page form card is Add-only on all three pages now — editing never scrolls you away from the row you were looking at, and only one row is editable at a time.
- **Chart series colors** (`frontend/src/components/charts/chartConstants.js`) are `--series-1` through `--series-7` in `index.css`, not literal hex values — a chart's series colors follow the active theme the same way every other themed color does. Each set (light default, the no-JS `prefers-color-scheme` fallback, and both explicit Light/Dark picks) is independently validated for colorblind separation, a chroma floor, and contrast against its own surface, rather than chosen by eye. Deliberately a *different* palette from the semantic `--danger`/`--success`/`--warning` tokens that color `<Amount>` and `<Badge>` — series identity and status are different jobs, and conflating them is how an earlier palette ended up pairing income-green against spending-red at a contrast level indistinguishable under deuteranopia.

## Importing

Upload a bank export on `/transactions`. One layout is built in and auto-detected with no setup:

```
BSB Number,Account Number,Transaction Date,Narration,Cheque Number,Debit,Credit,Balance,Transaction Type
```

(`Transaction Date` in `DD/MM/YYYY`.) Any other bank's export can be **mapped**: if a file's header doesn't match a known layout, the API responds with the raw header and a few sample rows instead of a flat rejection, and `/transactions` opens a mapping panel — a dropdown per field, populated from that file's own column names. **Preview** parses a candidate mapping and shows the resulting rows (or errors) without writing anything, however many times you need to adjust it; **Save mapping and import** then saves the mapping and imports for real. The next file with the same header auto-detects it, exactly like the built-in format — there's no annual "re-teach it your bank" step.

Two amount layouts are supported per mapping: separate Debit/Credit columns (the built-in format's own convention), or a single signed Amount column, split by sign at parse time (negative → debit, positive → credit) so nothing downstream of import ever knows which kind a file was.

Amount cells tolerate common bank-export formatting rather than requiring a bare number: a leading/trailing currency code (`AUD 3,742.37`), a currency symbol (`$`, `£`, `€`, `¥`), thousands separators, and accounting-style parentheses for negative (`(3,742.37)` → `-3742.37`) — the sign is recognized on either side of a currency code. This only widens what's *accepted*; a cell that's still not a valid number after that normalization is rejected exactly as before, quoting the original raw text in the error so a genuinely malformed row stays identifiable (`services/csv_import._clean_amount`).

**A running Balance column is always required**, for every format, mapped or built in. The app never sums debits and credits to derive a balance — it reads the bank's own figure — because there's no captured opening balance and a derived one would just be net change, not a balance (see `services/ledger.py`). A bank export with no balance column (some CommBank, Up and NAB exports) is out of scope for this reason, not an oversight; deriving one would quietly break the Accounts page, the balance-history chart, and the forecast, all three of which trust `Transaction.balance` completely.

If **any** row fails validation the whole file is rejected with a per-row error list — nothing is imported until the file is clean. Rows exactly matching an already-imported transaction (same account, date, narration, debit, credit, and balance) are skipped as duplicates and counted separately.

Accounts are created automatically from the account numbers in the file. Every upload is recorded as a batch, listed in the same **Import** card as the upload control itself — the file input and its result/rejection on top, batch history (with **Wipe all**) below, one card rather than two. Deleting a batch cascades to its transactions. **Wipe all** clears every transaction and batch — there's no undo.

Saved mappings are managed via `GET`/`POST`/`DELETE /api/csv-formats` (`backend/app/models.py`'s `CsvFormatMapping`, `backend/app/services/csv_formats.py`) — there's no settings page for them yet, only the mapping panel's own save action.

## The ledger

`/transactions` shows transactions newest first (`transaction_date DESC, id DESC`), paginated at **10 per page by default** (20/50/100/200 also selectable, max 200 either way — chosen deliberately low so the common case fits a screen with no scroll). Filters, sort, and the chosen page size all live in the URL, so a filtered, sorted, sized view is reloadable and shareable, and other pages deep-link into it.

Filters live on the columns they narrow, Excel-style, rather than a separate form: a small **▾** next to a header opens that column's own popover, with **Apply**/**Clear** inside it — nothing filters per keystroke, only on Apply — and Esc or clicking away closes it without applying. A column with an active filter shows a small dot next to its ▾.

| Header | Filter it carries |
|---|---|
| Date | From / To, **inclusive on both ends**. Shown as `DD/MM/YY` in the table itself (`utils/format.js`'s `formatDate`) — prose elsewhere in the app (report periods, "imported up to …") stays the full date |
| Account | exact match to one account, **or** one account group (see [Account groups](#account-groups)) — one dropdown, mapped to either `account_id` or `account_group_id` depending on which kind of thing is picked; a grouped account's individual members aren't separately selectable here, only their group |
| Narration | contains, case-insensitive; `%` and `_` are literal, not wildcards |
| Amount | **positive dollars** compared against the absolute value of the debit or credit. A transaction is stored as debit *or* credit, never both (import rejects a row with either both or neither populated), so the ledger shows them as one signed **Amount** column (`utils/format.js`'s `transactionAmount`) rather than two columns where one is always empty — still colored by sign the same way `<Amount>` always has been |
| Category | exact match, and also matches a **split** transaction with an allocation in that category (see Splits, below); **Uncategorized only** is a distinct mode from "all categories" and excludes split transactions entirely — a split row is never uncategorized even though its own `category_id` is null |

**Transaction type** (case-insensitive exact match) has no column of its own here — it lives behind each row's Details disclosure, below — so it gets a small filter bar of its own above the table instead, alongside one **Clear all filters**. Contradictory filter combinations are rejected with a 422 rather than quietly returning nothing — `uncategorized` with a `category_id`, `account_id` with `account_group_id`, an inverted date range, or an inverted amount range.

Every column is also sortable — click its label to cycle ascending → descending → off (`aria-sort` tracks the state). The ledger and the account-detail table (`/accounts/:id`) are paginated, so they sort **in SQL** (`services/ledger.py`'s `sort`/`direction` params, validated against a fixed column list, with `id` as a final tiebreaker so a tied sort never duplicates or drops a row across pages) rather than in the browser, which would silently only reorder the page on screen. Every other table in the app sorts client-side. `/rules` is the one deliberate exception, everywhere: its row order **is** its evaluation order (first match wins by priority), so it has no sortable headers — the existing move up/down controls are how its order changes.

Rows can be categorized individually or in bulk. Selection applies to the current page only and clears when you change pages, so a bulk assign can never touch rows you can't see.

**Group by merchant**, a toggle on the ledger toolbar, replaces the per-row table with one row per merchant (`GET /api/transactions/groups?include_categorized=true`, `services/ledger.transaction_groups`) — count, total, date range, a **Categorized** column, expandable to the sample narration and involved accounts, with a category select **and Set** button, plus **Make rule**, per group. Unlike the plain ledger view, it covers categorized rows too, not just uncategorized ones — the point is bulk categorization *and* bulk rule-making from whatever's already on screen. The Categorized column is what makes **Set** visibly work: it reads `N uncategorized` while any rows still need one, a single category's name once the whole group agrees, or `Mixed` (with the remaining uncategorized count, if any) once it doesn't — a split transaction counts toward neither bucket, since it's categorized via its own allocations, never "uncategorized", and is included in the mixed count instead. A group is scoped to whatever the ledger's own filters currently show, including Category and an account group — narrowing to Uncategorized only, an account group, or any other filter shrinks both the group counts and what a group's bulk actions can reach to match; a group's `transaction_ids` never include a row the caller couldn't already see. Grouping is computed server-side over the whole filtered set, not just the current page — groups aren't themselves paginated, so "the top merchants by count" doesn't depend on which page you asked for — but **how many groups are shown at once is**, at the same 10-per-page default as the plain ledger (component state, not the URL, and resets to page 1 whenever a filter changes or the toggle flips). Merchant/Count/Total are sortable the same way as the plain ledger's columns, client-side, seeded to the same count-desc order the view always used. Grouping is off by default — the plain per-row table is unaffected either way, and so are its own filter popovers: the grouped table has no Date/Account/Narration/Amount/Category columns of its own, so those filters fall back to the same popovers rendered inline above the table instead of disappearing while grouped.

The account-detail table (`/accounts/:id`) gets the same column-header filters and sorting, minus a leftover bar: **Account** is implicit from the route, and that table already has a **Type** column, so Type filters from its own header there instead. **Balance** is sortable but not filterable — there's no balance filter, and this doesn't add one.

A category that doesn't exist yet can be created inline from the ledger toolbar (present, with just this affordance and no select of its own, while grouped too — one **+ New category** for the whole page rather than one per group row) or the rule editor below — it's available in every category dropdown on the page immediately, no reload or trip to `/categories` required.

Each row's Balance, Type, filename, note, and Split/Make rule/Delete actions sit behind a **Details** disclosure rather than always on screen — low-frequency and text-heavy, and what used to push every row to three lines tall and the whole table into horizontal scroll. The category picker and its badges (`auto`, `split`) stay visible without opening anything, since categorizing is what the ledger is for.

**Make rule**, from either a row's Details or a merchant group, opens an in-place rule editor (`RuleEditor.jsx`) instead of navigating away to `/rules`: narration pattern prefilled from the merchant name (not the raw, reference-number-laden narration), type and category prefilled from the row (amount bounds stay blank — one transaction is a poor guess at a range), with a live match count (`POST /api/category-rules/preview`) before you commit. Saving creates the rule **and** applies it (`POST /api/category-rules` then `/apply`) without leaving the ledger. `/rules` still has its own full editor for reordering and bulk management — this is the fast path, not a replacement.

### Splits and notes

A transaction is either **unsplit** (its own single category, as above) or **split** across several — a supermarket run that's part groceries, part alcohol, part homewares. **Split** on a ledger row opens an editor: one row per allocation (category, amount, optional note), a live remainder, and Save disabled until the remainder is exactly zero. Splits must sum to **exactly** the transaction's own signed amount — a partial allocation is rejected outright, never saved, because every report reads through the same allocation view (`backend/app/services/allocations.py`) that this invariant makes safe to trust rather than re-check on every read.

Splitting and direct categorization are mutually exclusive: setting a category directly (singly or in bulk) clears any existing split, and saving a split clears the transaction's own `category_id`. A split transaction's `category_id` is therefore always null — same as an uncategorized one — but it is **not** uncategorized: `/reports`, the ledger's `uncategorized` filter, and the category filter all treat a split row as categorized via its allocations, not as missing a category. A rule never touches a split transaction either, for the same reason it never touches one you categorized by hand: splitting is a manual decision.

Every transaction can also carry a free-text **note**, independent of splitting, editable inline in the ledger (saved on blur, not per keystroke).

The account detail page (`/accounts/:id`) shows a split transaction's badge and per-category breakdown read-only — it has no split editor of its own; use the main ledger to edit one.

## Categorization

Categories have a **kind** (`expense`, `income`, or `transfer`) and expense categories may carry a **budget**. Transfers are excluded from spending and income totals so moving money between your own accounts doesn't register as either.

**On auto-categorization from an external source:** nothing is integrated, and nothing free is worth integrating. The commercial merchant-enrichment APIs (Basiq, Plaid Enrich, Ntropy, Yodlee) are all paid per-transaction and require sending narration text — effectively your spending history — to a third party; there's no credible free or offline equivalent, since the value in those services is a proprietary merchant-name dataset that can't be self-hosted. The strongest no-cost option — suggesting a category from your own past categorizations of the same merchant — is not built, but the merchant-key logic it would need (`services/narration.py`) already exists and is shared with both recurring detection and the ledger's own transaction grouping above.

Rules on `/rules` auto-categorize on import and can be re-run over existing transactions from the ledger's **Apply rules now**. A rule matches on narration, transaction type, and/or an amount range; rows it categorizes are marked `auto`. Setting a category by hand clears that marker, so a later rule run won't overwrite your decision.

### Rule review

Rules are evaluated **top to bottom, first match wins** (`services/categorization.py`), so a rule can end up permanently unreachable — shadowed by a broader one ranked above it — with no way to notice short of reading the whole list by hand. The **Review Rules** card on `/rules` (`GET /api/category-rules/review`, `services/rule_review.py`) reads that same ordering and reports what it makes provable, changing nothing on its own. Three kinds of finding, keyed off whether an earlier rule's pattern is a substring of a later one's *and* that earlier rule's other criteria are absent-or-broader (its type is null-or-equal, its min is null-or-lower, its max is null-or-higher — a narrower amount band is never reported, however generic the pattern):

| Kind | Meaning | Action |
|---|---|---|
| `duplicate` | Identical pattern (case-insensitive), type, amount range **and** category as an earlier rule | Safe to remove — provably a no-op |
| `subsumed` | An earlier, broader-or-equal rule already targets the **same** category | Safe to remove — dead code, the earlier rule already catches everything this one would |
| `shadowed` | Same shape, but the earlier rule targets a **different** category | **Never auto-removed** — this is almost certainly a bug (the rule was written intending to win and silently doesn't), reported with the blocking rule named so it can be reordered with the existing move up/down controls |

Because a rule's narration pattern is a single case-insensitive substring with no OR, two rules with genuinely unrelated patterns can't be combined — the schema can't express it. "Merge" therefore means *remove the rule that can never fire*, the only merge these semantics honestly support. **Remove all duplicate/subsumed rules** (`POST /api/category-rules/review/remove-redundant`) deletes every `duplicate`/`subsumed` finding in one action and never touches a `shadowed` one; each finding can also be removed individually. Since both auto-removable kinds are provably no-ops, deleting them cannot change how a single transaction categorizes — re-running **Apply rules now** afterward recategorizes exactly the same rows.

### Sub-categories

A category may have a **parent** — `/categories` shows a Parent dropdown on the add/edit form, and groups the All Categories table under parent headings once anything has one. This is **grouping only**, one level deep:

- A parent's own budget is always blank, and a parent can never be assigned to a transaction directly (the API rejects both) — its role is purely to group its children for display; totals and reports still work entirely on leaf categories, exactly as before parents existed.
- One level: a category that already has children can't itself be given a parent, and a category can't be given a parent that already has one. There is no deeper tree.
- **Deleting** a category, by default, promotes its children to top-level rather than deleting them (`DELETE /api/categories/{id}`). Adding `?cascade=true` deletes the group and every child with it instead — the Delete button on a group's own row does this and confirms with the child count first. **Bulk delete** (checkboxes on the category table, `POST /api/categories/bulk-delete`) never cascades, regardless of what's selected: a selected group has its children promoted, matching the single-delete default. Either way, every transaction, split allocation and rule referencing a deleted category is detached first (never left pointing at a row that no longer exists), through one shared backend routine so single, cascade and bulk delete can't drift apart on what "removing a category cleanly" means.

Everywhere a category is **named as a row of its own** — the Monthly Budgets editor, Unused, Archived, `/reports`' two tables, Dashboard's over-budget card, the `/rules` table — it reads as its full path, `Food › Groceries`, not a bare `Groceries` (`utils/categories.js`'s `categoryPathLabel`, fed by a `parent_name` now carried on every response that names a category). A bare leaf name is ambiguous the moment two groups each own an `Insurance` or a `Fees`, which the Queensland preset below creates on the first press; the Monthly Budgets card is the sharpest case, being a flat list of leaves with no group headings of its own. Those tables sort by the same path they display, so sorted order matches rendered order. The per-transaction category pickers in the ledger are deliberately unchanged — `<CategorySelect>` already shows the hierarchy structurally, via `<optgroup>`.

### Combining and splitting categories

A chart of accounts is never right first time, and neither problem it develops is expressible as plain CRUD (`backend/app/services/category_restructure.py`, whose module docstring is the full reasoning):

- **Combine** (`POST /api/categories/merge`, the Combine Categories card on `/categories`) moves every transaction, split allocation, rule and budget from the selected categories onto the one you keep, then deletes the others. Deleting the duplicate instead would **uncategorize** its history rather than move it — `_detach_category` detaches every reference before a delete, which is right for a delete and wrong for a merge. It acts on the same row checkboxes bulk delete uses; the target is picked from the ticked rows themselves. Standing budgets **sum**, and so does a per-month override against the target's override for the same month — merging two categories merges the money they were each allowed. Refused, rather than guessed at: a group (a category with children) on either side, and mixed kinds (merging income into expense would flip the sign of its whole history). An **archived** category is a fine source — absorbing a leftover into the live category that replaced it is the tidy-up this exists for.
- **Split** (`POST /api/categories/split`, with `POST /api/categories/split/preview` alongside it) carves one category into several new ones, which inherit its kind and parent group. Each new category takes the transactions whose narration contains **its pattern** — the same case-insensitive substring a rule's `narration_pattern` is, matched in order with the first match winning, the same way rules themselves are evaluated. Anything matching no pattern **stays in the source**: a transaction the user hasn't described is one the app has no basis to move, and there is deliberately no "distribute the remainder" mode. **Preview** runs the identical matcher and writes nothing, so the counts shown are the counts the split performs. A part can carry its own standing budget, and can optionally also create a real rule from its pattern (appended after every existing rule, so it never silently outranks one already there) — so the same narration lands in the same place on the next import, not only retroactively.

**Load Queensland household preset** (also on `/categories`) creates a starting chart of accounts for a typical Queensland family of four — parent groups (Housing, Utilities, Food, Transport, Health, Children, Financial, Lifestyle, Income, Transfers) with sub-categories and indicative monthly budgets (`backend/app/services/category_presets.py`). It's a starting point to edit, not a claim about any particular household — the figures are sized for two adults and two children (one in paid care, one at school; delete whichever leaf doesn't apply) and total roughly $10,500/month of indicative expense budget. Safe to press more than once: matching is case-insensitive by name against your whole category list, and anything that already exists — anywhere, under any parent or none — is left completely untouched, never duplicated or overwritten.

### Archiving and unused categories

**Archiving is not deleting.** An archived category keeps every historical transaction, split and rule assignment exactly as-is — only its *availability* changes: `GET /categories` excludes archived categories by default, so every dropdown in the app gets clean data for free, and `/categories` itself gets **Unused** and **Archived** cards to manage the rest.

- **Unused** lists categories with zero transactions and zero rules pointing at them — candidates to archive and get out of the way, with an **Archive all unused** shortcut. This deliberately includes budgeted-but-never-used categories (excluding them would empty the card of exactly what the Queensland preset's ~35 unused rows need it for), and deliberately excludes a category a rule still targets even with no transactions yet — a rule existing is active intent, not clutter. Usage is computed across the *whole* ledger and reads through the same allocation view `/reports` does, so a category used only via a split still counts as used.
- **Archived** lists everything archived, each with a **Restore**.
- Archiving a parent cascades to its whole group, and restoring reverses that — an `<optgroup>`-based select can't coherently show a hidden parent with visible children (they'd fall into the ungrouped block, which reads as data loss). Archiving one child directly touches only that row.
- **Reports and Trends never silently drop real money.** An archived category is excluded from the budget-vs-actual table and the multi-month grid *only* when it has no activity in the period shown — one with real spending or income that period still appears (with an archived badge), and `total_spending`/`total_income` are computed from the complete data before any archived filtering, never the filtered view. That filter lives entirely in Python at the point of display, deliberately never pushed into the SQL query itself — see `services/reporting.py`'s module docstring before "simplifying" it. The Monthly Budgets **editor** (`/categories`) is the one exception and excludes archived unconditionally: it's a forward-looking editing surface, not a historical total, and archiving is reversible.

## Budgets

A category's budget has two parts, both edited in the **Monthly Budgets** card on `/categories`:

- A **standing** amount (`Category.budget_amount`) that applies to every month by default.
- An optional **override** for one specific month, stored as its own row rather than as an edit to the standing amount. December being different from every other month doesn't change what February sees.

Resolving "the budget for month X" is override-if-present-else-standing-else-none, and that resolution happens in exactly one function (`services/budgets.effective_budget`) that every caller — `/reports`, `/trends`, `/budgets` itself — routes through, so the same month can never resolve two different ways in two different places.

Two things worth knowing:

- **An override of `0.00` is a real budget of zero**, not "no override" — spending against it reads as over budget. There is no separate "no budget this month" state; clearing an override reverts to the standing amount, and to have no budget at all the standing amount itself has to be cleared.
- **Copy from previous month** writes the source month's *resolved* figures as explicit overrides on the target month, not a reference back to the standing amount — so a later change to the standing amount doesn't reach back and silently change a month that was already copied and is being edited independently.

## Balances and reports

An account's balance is the `balance` column of its most recent transaction — **most recent by date, not by id**, so importing an older statement after a newer one doesn't rewrite the current balance. An account with no transactions has a balance of `null`, which renders as "No transactions yet"; that is deliberately distinct from a real `0.00`.

`/reports` covers one month at a time: summary totals, budget vs actual per category, a category-by-month grid, and an uncategorized review that links straight into the filtered ledger.

Note that reporting uses **half-open** month bounds (`[start, end)`) internally while the ledger's date filters are **inclusive** on both ends. Both are documented in their modules; they serve different callers and are not meant to match.

## Accounts and net worth

Every account has a **type** (`/accounts` — Everyday, Savings, Investment, Credit Card, Loan, Mortgage) and a **balance sign** (`services/net_worth.py`), and these decide two genuinely different things:

- **Type** is which side of the balance sheet an account counts toward — an asset (Everyday, Savings, Investment) or a liability (Credit Card, Loan, Mortgage) — and the inferred default for the field below.
- **Balance sign** (`natural` or `inverted`) is what actually does the arithmetic. Banks disagree on how they report a liability: some (this app's own sample data) report a card's balance as **negative when you owe money** — "natural", the raw figure already subtracts correctly. Others report the amount owed as a **positive** number — "inverted", which must be negated to subtract correctly. These are kept as two separate fields specifically because collapsing them into one "type implies sign" rule can't express both conventions at once.

An account can also be **unclassified** (no type set — the default for anything just imported). An unclassified account is **excluded from net worth entirely, never guessed into it** — an incomplete figure the app admits to beats a complete one it invented. The Dashboard names how many accounts are excluded when any are.

**Inferring the sign**: editing a liability account (`GET /accounts/{id}/infer-balance-sign`) looks at that account's own balance history and suggests whichever convention predominates, showing "Inferred from N past balances: natural/inverted" with a **Use this** button. It is never applied automatically — the account keeps its own stored value until you explicitly accept the suggestion.

**Net worth** (`GET /api/net-worth`, `services/net_worth.py`) is the one place any signed sum of account balances happens — `assets - liabilities = net`, both display buckets shown as positive-reading figures, with `net` the only figure that has to be exactly right (the two buckets can never disagree with the total they're drawn from, by construction). The Dashboard's Accounts card and its Net Worth chart both read from this service, so they can never disagree with each other either — there is no second, independent "combine the balances" implementation anywhere in the frontend.

### Account groups

An **account group** (`/accounts`, `AccountGroup` in `models.py`) is one logical account across a **succession** of physical ones — e.g. a credit card and the replacement it was reissued as. It is deliberately **not a folder**: grouping is for accounts that supersede each other, not for accounts you simply want filed together, and using it that way produces the surprising behaviour described next.

The reason it isn't display-only: without a rule, an old card and its replacement both reporting a balance would double-count the same debt (an account and its replacement each showing -$500 would read as -$1,000 owed, not -$500). The rule that prevents it — at any given period, **exactly the newest member whose first transaction has started counts toward net worth** (`services/net_worth.group_contributors_now` / `group_contributors_by_period`) — is derived live from each member's own first transaction date, never a stored "is current" flag there'd be no way to keep in sync. A replacement supersedes its predecessor from the moment it starts being used, in `net_worth_now`, `net_worth_history`, and the Dashboard's Net Worth chart alike, since all three read through the same service.

Two more places this reaches:

- **`/accounts/:id` for a grouped account shows the group's stitched balance history** — for each month, whichever member was the period's contributor, so a reissued card's chart is one continuous line across the handover rather than two lines that don't meet. Every member of the same group shows this identical stitched series.
- **The ledger's Account filter** offers a group alongside every ungrouped account (`account_group_id`, alongside the existing `account_id`) — filtering to "every transaction from this logical account" regardless of which physical account number it landed under.

Deleting a group unlinks its member accounts rather than deleting them (`DELETE /api/account-groups/{id}`) — a group is a label over otherwise-ordinary accounts, not a container that owns them.

## Trends

`/trends` charts the same data `/reports` shows for one month, across many: spending by category (the top 6 by total, everything else summed as "Other" — the Reports grid remains the complete, un-summarized view), income vs spending vs net, and budget vs actual. An account's balance-history chart lives on its own detail page (`/accounts/:id`) instead, since it's the only place that needs it.

### Drilling down

Every chart on `/trends` is clickable, in whichever direction has more detail to give (`utils/trendsSeries.js` shapes the levels; the charts themselves only report **what** was clicked, via `onSelectPoint`/`onSelectSeries` on `LineChart` and `onSelectPeriod` on `BarChart` — a chart with none of those props passed renders exactly as it always did, with nothing focusable and no pointer cursor).

- **Spending by category** shows one line per **group**, with a [grouped](#sub-categories) category's children rolled up into their parent rather than competing with their siblings for one of the six lines — a preset chart of accounts has enough leaves that the limit otherwise buries most of a household's spending in "Other". Clicking a group (a point on its line, or its name in the legend) drills into that group's own children, same chart. There is no third level, since categories are one level deep, so clicking a **leaf's** point opens the ledger filtered to that category and that month — which transactions made a month expensive is invariably the next question, and no chart can answer it. The drilled-into group lives in the URL (`?group=`) next to `?months=`, so a drilled-in chart is reloadable and shareable; changing the window resets it, since a group with no activity in the new window isn't in the data at all. The summed "Other" line is deliberately **not** clickable — it stands for several categories at once and has nothing to drill into.
- **Income vs spending** and **budget vs actual** drill by **month**, not by bar: a grouped bar chart's column means one month compared several ways, so "March" is the thing with more detail behind it, and a click opens `/reports?year=&month=` for that month — the full per-category table these two charts are the summary of. (`/reports` reads its month from the URL for this, making a report shareable the way a filtered ledger already was.) The hit area is the whole column rather than a 20px bar, and because it necessarily sits over its own bars, it carries that month's figures in its tooltip and accessible name.

The multi-month numbers are derived from the **same** query the single-month Reports grid uses (`services/reporting.category_grid`), not a second independent query — so `/trends` and `/reports` can never quietly disagree about the same month. Budget vs actual is scoped to only the categories that actually have a budget set, on both sides of the comparison; comparing total spending against total budgeted would always look "over" the moment any unbudgeted category has activity, which isn't a useful signal. The budgeted line is genuinely per-period, not one figure repeated across the window — a [monthly override](#budgets) steps the line for that month only.

Charts are hand-rolled SVG (`src/components/charts/`), not a library — this keeps the frontend at four runtime dependencies. Two things worth knowing if you're extending them: a `null` value in a series is a genuine gap (no data for that period) and breaks the line rather than drawing through it as zero — this is how an account's balance history renders the months before its first transaction; and bar charts always include zero in their scale so a negative month (a refund, a loss) draws sensibly below the baseline instead of needing special-case handling.

`GET /api/trends` also returns `balances` — every classified account's own balance history (`services/trends.account_balance_history`), combined sign-aware per period by `services/net_worth.net_worth_history` (see [Accounts and net worth](#accounts-and-net-worth) below) rather than a straight sum. `/trends` itself doesn't chart this (an account's own balance history already lives on its detail page); it's there for the Dashboard's own **Net Worth** chart, below.

The Dashboard (`/`) shows two charts sharing the same months rather than combining them: **Cash Flow** (income and spending as a bar chart, spending drawn as a negative value so it falls below the zero line opposite income) and **Net Worth** (the sign-aware line above — genuinely net worth, not a caveated straight sum). Deliberately never one dual-axis chart — cash flow (thousands) and net worth (tens of thousands) are different scales, and a shared axis would invent a correlation from an arbitrary alignment rather than show a real one. The two gate independently: a quiet month with no categorized activity can still show a balance trend, and vice versa.

## Recurring payments

`/recurring` finds subscriptions and regular bills by grouping same-account transactions with matching narrations and checking whether the gaps between them are consistent enough to be weekly, fortnightly, monthly, quarterly, or yearly — at least 3 occurrences, ordinary irregular spending (groceries, coffee) doesn't qualify. See `services/recurring.py`'s module docstring for the exact thresholds.

For each detected series it shows the next expected date (calendar-aware — a monthly bill on 31 January is next due 28 February, not "31 days later"), whether the latest amount changed from its established norm, and an estimated annual cost. "Missed or stopped" status is judged against **that account's own latest imported transaction**, never today's date — otherwise every series would look overdue the moment an import falls behind.

A false positive can be **dismissed** from the list; dismissals persist (keyed on account + normalized narration) and can be restored from the page's collapsed Dismissed section. Nothing about detection itself is stored — it's recomputed from the ledger on every request, so there's nothing to keep in sync when transactions are imported or deleted.

Each series also has a **direction** (`inflow`/`outflow`), decided by majority across its occurrences — every amount elsewhere on this page stays an absolute value, and direction is what says which way it goes. This is what the forecast (below) needs to add income and subtract bills correctly.

## Forecast

`/forecast` projects each account's balance forward in monthly buckets: the remainder of the current month (marked partial, pro-rated over the days actually remaining), then the next few whole months. Projection is anchored to **the ledger's own latest transaction date**, never today — the same reasoning recurring detection already applies to "overdue", so a stale import doesn't silently invent weeks of activity nobody recorded.

Each bucket has two components, shown separately rather than as one number so a wrong figure is traceable to which part is wrong:

- **Recurring commitments** — every active/due-soon/overdue detected series (not `ended`, not dismissed) walked forward from its next due date. An overdue series contributes its next real occurrence, not the already-passed one.
- **Estimated everyday spending** — a per-account daily run rate from the 3 complete months before the current one, **excluding anything already counted as a recurring commitment** (matched by the same narration key detection uses). Skipping that exclusion would subtract every subscription twice and make the forecast systematically too pessimistic — it's the single most load-bearing correctness property in `services/forecast.py`, and it's covered by a dedicated test. A **dismissed** series' transactions land back in the run rate automatically, since dismissing it is the user's own declaration that it isn't actually recurring.

Cash flow deliberately counts what `/reports` deliberately excludes — **uncategorized transactions** and **transfers** both represent real money moving, which is exactly what a balance projection needs, even though neither belongs in a categorized spending report. This is a real, intentional divergence from every other money query in the app; see `services/forecast.py`'s docstring before "fixing" it to match `reporting.py`.

The page also lists the specific **upcoming commitments** behind the numbers, so the projection is checkable rather than opaque. Monthly resolution means the forecast cannot show an intra-month dip — a month that closes comfortably can still run short on the 20th.

The forecast's own **"Combined cash position"** series is deliberately labelled to *not* say net worth — it is a straight sum of projected closing balances (`services/forecast.py`), not run through `services/net_worth.py`'s sign-aware combination. Netting a projected credit card balance against a projected everyday balance here would answer "what will I be worth", a different question than the one this page exists to answer: "will I run short of cash".

## Savings goals

`/goals` (`services/goals.py`) tracks progress toward a target, one of two ways:

- **Account balance** — the goal is linked to a real account, and progress is that account's own **signed balance** (the same `services/net_worth.py` calculation net worth uses) against the target. Honest by construction: the number comes straight from the bank, not from anything this app tracks separately. Because it's signed, a goal linked to a liability account reads its progress the same way net worth does, never as a misleadingly positive figure.
- **Envelope** — progress is an `allocated_amount` the household sets by hand, for several goals sharing one account (e.g. "Holiday" and "New Laptop" both drawing from the one savings account). There is no automatic contribution ledger — the user's own transactions already are the ledger, and adding a second one to keep in sync would be one more thing to drift.

**Over-allocation** is the mitigation for the real risk in the envelope model: allocated amounts are figures a household maintains by hand and can add up to more than an account actually holds. Every response from `GET /api/goals` includes, per account carrying envelope goals, that account's real balance alongside the sum of its envelopes — the page flags it rather than quietly showing every goal as on track when the account can only cover some of them. The same "surface the discrepancy, never hide it" pattern as the split editor's live remainder and the frontend/API version mismatch.

`monthly_required` (remaining ÷ whole months to `target_date`) is only shown when a target date is set and the goal isn't already met — there's no honest answer to "how much per month" for a goal with no deadline, or one that's already there. Deleting a linked account leaves a goal intact but unlinked, the same `ondelete="SET NULL"` pattern `Category.parent_id` uses.

Goals follow the same reversible archive pattern as categories (`archived`, excluded from the default list, restorable) rather than being deleted outright.

## Local development

**1. Provide a Postgres instance and configure `.env`** — do this first; `scripts/start.sh` will refuse to run without it:

```
cp .env.example .env
```

Edit `.env` to point at a reachable Postgres (see the variables below). Nothing in this repo stands up a local database for you — you need one already running.

**2. Run both services with one command:**

```
./scripts/start.sh
```

Add `--install` the first time (or after pulling dependency changes) to install backend and frontend dependencies first:

```
./scripts/start.sh --install
```

- Backend: http://localhost:8000
- Frontend: http://localhost:5173

Ctrl+C stops both. The backend runs `alembic upgrade head` automatically on every startup, so a fresh database is brought up to schema on first boot — no manual migration step.

### Environment variables (`.env`, from `.env.example`)

| Variable | Meaning |
|---|---|
| `DATABASE_HOST` / `PORT` / `NAME` / `USER` / `PASSWORD` | Postgres connection details |
| `ALLOWED_ORIGINS` | comma-separated origins allowed to call the API directly (CORS) |
| `DEBUG_SQL` | set to `true` to log every SQL statement (verbose — dev/debug only) |

### Running tests and linting

```
cd backend && pytest
cd frontend && npm test
```

Lint: `ruff`/`black` are available for the backend (`requirements-dev.txt`, no enforced config yet); `npm run lint` (oxlint) for the frontend.

## Database migrations

Schema is managed by Alembic (`backend/alembic/`), not `create_all`. When you change a model in `backend/app/models.py`, generate a migration for it before it'll take effect anywhere but your local dev DB:

```
cd backend
python3 -m alembic revision --autogenerate -m "describe the change"
```

Review the generated file in `backend/alembic/versions/` before committing — autogenerate is a starting point, not always correct as-is.

**The full migration chain cannot be run against SQLite from scratch** — an early migration (`cee3a8016863`) `ALTER`s a table to add a foreign key constraint, which SQLite refuses without batch-mode rewriting. This only matters if you're testing migrations somewhere without Postgres: a single new migration can still be checked in isolation by building the schema up to its parent revision directly from the models (`Base.metadata.create_all`, excluding the new table), stamping Alembic at that revision, then letting `upgrade`/`downgrade` run just the one new migration. That proves the DDL is syntactically valid and reversible — it does not prove Postgres-specific behaviour (e.g. `server_default=sa.text('now()')` is accepted by SQLite's `CREATE TABLE` but isn't the same guarantee). Always confirm against real Postgres before relying on a new migration in production.

## Versioning

The app reports its own build version and commit in two places — the frontend header/footer, and `GET /api/version` on the backend — resolved independently on each side rather than as one shared value, since the backend and frontend images (`homebudget-api`/`homebudget-web`) are built and published independently (see [QNAP Deployment](#qnap-deployment) below) and can legitimately end up on different builds after a partial redeploy.

- **Source of truth**: the repo-root `VERSION` file (hand-bumped per release, e.g. `0.11.0`).
- **Bumping a version is two edits in the same change, not one**: `VERSION` itself, and a new entry at the top of [`CHANGELOG.md`](CHANGELOG.md) (Keep a Changelog format — `Added`/`Changed`/`Fixed`, newest first). A version with no changelog entry is exactly as unhelpful as a changelog entry with no version bump; this repo's own history has both problems for everything before 0.11.0, which is why the changelog starts there rather than guessing at 0.1–0.10.
- **CI** (`.github/workflows/deploy.yml`) reads `VERSION` and passes it, plus the commit SHA, as Docker build args (`APP_VERSION`, `GIT_SHA`) to both image builds.
- **Backend** (`backend/app/version.py`) resolves `APP_VERSION`/`GIT_SHA` env vars first (set from those build args), falling back to reading the `VERSION` file directly — which covers local dev, where the full repo checkout is present but the env vars aren't — then to `"dev"`/`"unknown"`. It never raises: a misconfigured image should show a wrong-looking version, not fail to boot.
- **Frontend** (`frontend/src/version.js`) reads the same two values, injected as build-time literals by `vite.config.js`'s `define` block from the same env vars; outside a real Docker build (e.g. local dev) it falls back to `"dev"`/`"unknown"` the same way.
- The header shows `v<version> · <short-sha>` (full SHA in the tooltip) and the tab title becomes `homeBudget v<version>`. The footer fetches `GET /api/version`; if the frontend and API report different commits (and neither is `"unknown"`), a mismatch notice appears. An **unreachable** API shows "API version unknown" instead — a down API and a stale one are different problems and are never rendered the same way.

Locally, with no Docker build args in play, both sides just show `dev`/`unknown` with no mismatch warning.

## QNAP Deployment

`docker-compose.qnap.yml` is the file to deploy with Container Station. It builds two services, `api` and `web`, from the images published by `.github/workflows/deploy.yml` to GHCR (gated on backend/frontend tests passing — see the workflow; the *image* names, `homebudget-api`/`homebudget-web`, are unrelated to the compose *service* names). It does **not** run Postgres — it assumes Postgres already runs as its own Container Station application, and joins that application's Docker network so the api container can reach it by container name.

Each service's `container_name:` is pinned (`homebudget-api` / `homebudget-web`) rather than left to Compose's default naming — see the comment at the top of `docker-compose.qnap.yml`, and the Troubleshooting section below for the incident that prompted it. `frontend/nginx.conf`'s proxy target and this compose file's `container_name:` have to agree, so a `homebudget-web` image from this version onward requires this version (or later) of the compose file — recreate the whole application together, not the containers individually. See ["Reading the container names"](#reading-the-container-names) below for how to tell which version is actually deployed from Container Station's own containers list.

Steps:

1. On the NAS, find the existing Postgres container's Docker network name and container name (`docker network ls` / `docker inspect <postgres-container>`, or Container Station's network view for that application). The Postgres user needs `GRANT CREATE ON SCHEMA public` so the app's startup migrations can create its tables — without it, the `homebudget-api` container starts but every database-backed request fails, and the failure is otherwise silent (see `initialize_database()` in `backend/app/main.py`, which logs the error to stderr on failure — check the container logs if `database_ready` is ever `false`).
2. **Create the application with app name `homebudget`** (matters — see the troubleshooting note below): Container Station → Create > Application > pull from GitHub, pointing at `https://github.com/RapidChrisCircle/homeBudget` and `docker-compose.qnap.yml`.
3. Container Station will detect the variables referenced in the compose file (it does not read `.env` files) and prompt for them:

   | Variable | Meaning |
   |---|---|
   | `GHCR_OWNER` | lowercase GitHub org/user that publishes the images; defaults to `rapidchriscircle`, only override if the images are ever published from a different owner |
   | `DB_NETWORK_NAME` | Docker network name of the existing Postgres application |
   | `DATABASE_HOST` | container/service name of the existing Postgres container on that network |
   | `DATABASE_PORT` | Postgres port (default `5432`) |
   | `DATABASE_NAME` / `DATABASE_USER` / `DATABASE_PASSWORD` | credentials for the existing database |
   | `ALLOWED_ORIGINS` | only needed for local dev against a remote API; leave as default for QNAP |
   | `DEBUG_SQL` | leave as default (`false`) unless debugging a query issue |
   | `API_PORT` / `WEB_PORT` | host ports to publish (default `8000` / `8080`) |
   | `API_UPSTREAM` | leave as default (`homebudget-api:8000`) unless the ["502 Bad Gateway" troubleshooting section](#troubleshooting-502-bad-gateway) below says otherwise for your setup |

4. Deploy. The app is reachable at `http://<nas-ip>:8080`, and the API directly at `http://<nas-ip>:8000`.

Images are published as both `:latest` and `:<commit-sha>`. `docker-compose.qnap.yml` uses `:latest` by default; to pin a known-good build instead, edit the image tags in Container Station's compose editor to a specific commit SHA from the repository's Actions/Packages history.

### Reading the container names

Both troubleshooting sections below lean on this, so it is worth knowing upfront. Compose names a container `<project>-<service>-<index>` unless a `container_name:` pins it to something exact — and this file does pin both (`homebudget-api` / `homebudget-web`, on the `api` and `web` services respectively). So in Container Station's containers list:

| Names you see | What it means |
|---|---|
| `homebudget-api`, `homebudget-web` | The current compose file (this version or later) is deployed. |
| `homebudget-api-1`, `homebudget-web-1` | An **older** compose file (before `container_name:` was added) is deployed — services `api`/`web`, Compose's default naming. Not itself a problem, but the two container names below assume the pinned form; update the deployed YAML to this version. |
| A **doubled** prefix, e.g. `homebudget-homebudget-web-1` | The application was not created cleanly — delete it and recreate from scratch rather than debugging further. |

### Troubleshooting: API returns 404 but the page loads

**Cause: a foreign container answering the generic name `api`.** In Docker, a service is reachable on its **own service name** as a network alias on every network it joins — this stack's API service is named `api` (see `docker-compose.qnap.yml`'s header comment for why it stays that way rather than being renamed), and `api` is generic enough that a *different* application on the same shared Postgres network (`dbnet`) can have a service of its own also named `api`. When that happens, the Docker DNS name `api` resolves to **both** containers, and nginx round-robins across them (a literal `proxy_pass http://api:8000;` is resolved once at startup and then load-balanced across whatever addresses that returned). One request lands on this app's real API and works; the next, seconds later, lands on the other application entirely and 404s every path it doesn't recognise — which is *every* path, since it isn't homeBudget. This is exactly why the failure moves around on reload instead of every call failing the same way, and why `GET /api/version` in the footer can report a correct build at the very same moment another card fails: the two requests were answered by two different servers.

**The fix: nginx targets the API by its pinned `container_name` (`homebudget-api`), not the generic service alias `api`.** A container name is unique per Docker host by construction — unlike a network alias, which is exactly what two same-named services were able to share. This requires the compose file with `container_name:` set (this version or later) to actually be deployed — see "Reading the container names" above to tell whether it is.

**To confirm this was the cause**, rather than assume it:
- The clearest tell is the API's own reported identity: the footer's *"API v… · …"* string, or the `X-App-Version`/`X-App-Commit` headers now on every response (`backend/app/main.py`'s `add_build_identity_headers`) — compare the commit against `git log` in this repository. A commit that **isn't in this repo's history at all** (not a stale build of *this* app, but a version string this app has never had, e.g. `v0.1.0` when `VERSION` has never gone below `0.11.0`) means the response came from a different application, not a stale/duplicate deployment of this one.
- From a shell in the web container (Container Station → the web container → Console, or `docker exec`), `getent hosts api` returning more than one address confirms another application still claims it; `docker network inspect <the shared network>` lists every container attached, which is how to identify what the other application actually is.
- The frontend performs the header comparison itself on every response and shows *"Responses are coming from more than one API build"* in the footer the moment it notices — no devtools needed. Error messages are also no longer bare "Not Found": `frontend/src/services/api.ts`'s response interceptor enriches an ambiguous error (no `detail`, or FastAPI's own generic route-matching body) with the method, the actual requested path, the status, and — when the headers are present — which build answered, e.g. `404 Not Found — GET /api/transactions did not match any route on the API that answered (answered by build 0.1.0 · 884ba6d)`. A real, specific error from one of this app's own endpoints (`"Category not found"`) is left completely untouched.

### Troubleshooting: 502 Bad Gateway

Every `/api/...` call fails the same way every time (not intermittently, unlike the 404 case above), and the page itself shows a message naming the configured upstream and pointing back at this section — `frontend/nginx.conf`'s `@api_unreachable` location returns that JSON body itself whenever nginx's own proxy to the API fails (can't resolve the name, connection refused, timed out), rather than a bare "502 Bad Gateway". The web container's own nginx error log (Container Station → the web container → Logs, or `docker logs`) says which it was — `Host not found` means the name nginx is targeting didn't resolve at all; `Connection refused` means it resolved but nothing is listening; a timeout means something in between is dropping the connection.

**Most likely cause: the deployed compose file predates `container_name:`.** The web image proxies to `homebudget-api` by default (see above); if the compose file actually running still names the containers `homebudget-api-1`/`homebudget-web-1` (or, on a very old deployment, plain `api-1`/`web-1`) rather than the pinned `homebudget-api`/`homebudget-web`, that name genuinely does not exist and every call 502s with `Host not found` — consistently, not intermittently, since there is no second container to occasionally land on this time. Check the container names first (see "Reading the container names" above); if they are not the pinned form, update the deployed YAML to this version rather than looking further.

**If the container names are already correct** and it still 502s, `API_UPSTREAM` is the escape hatch — a compose variable (default `homebudget-api:8000`) read by nginx at container start, so pointing it at whatever name *does* resolve is a one-field change in Container Station rather than a new image. From a shell in the web container:

```
getent hosts homebudget-api                       # the configured default
getent hosts <the API container's exact name from Container Station's list>
```

Whichever of those resolves to exactly one address is a working value for `API_UPSTREAM` — set it to `<that name>:8000` and recreate the application (an environment variable change requires recreating, the same as any other compose edit). Confirm it is genuinely this app before relying on it: `wget -qO- http://<name>:8000/api/version` should report the current version and a commit that appears in this repository's `git log` — not a foreign build, per the 404 section above.
