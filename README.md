# homeBudget

A household budget tool. Import bank transactions from a CSV export, categorize them (by hand or automatically), set budgets, and see where the money went.

Backend: FastAPI + SQLAlchemy + Postgres, schema managed by Alembic. Frontend: React + Vite, served by nginx in production.

## Pages

| Page | What it does |
|---|---|
| `/` | Dashboard — account balances, this month's totals, over-budget categories, uncategorized count, recent activity |
| `/transactions` | Import CSVs, and the filterable, paginated ledger |
| `/accounts` | Manage accounts; `/accounts/:id` is one account's balance and transactions |
| `/categories` | Manage categories, their kind, and their monthly budgets (standing + per-month overrides) |
| `/rules` | Auto-categorization rules |
| `/reports` | Monthly summary, budget vs actual, category totals over time |
| `/recurring` | Detected subscriptions and regular bills, next due dates, price changes |
| `/trends` | Multi-month charts: spending by category, income vs spending, budget vs actual |

## Importing

Upload a bank export on `/transactions`. One header layout is currently recognised and auto-detected:

```
BSB Number,Account Number,Transaction Date,Narration,Cheque Number,Debit,Credit,Balance,Transaction Type
```

`Transaction Date` must be `DD/MM/YYYY`. Each row needs exactly one of `Debit`/`Credit` populated (not both, not neither), and `Balance` is required — the app never sums debits and credits to derive a balance, it reads the bank's own running balance.

If **any** row fails validation the whole file is rejected with a per-row error list — nothing is imported until the file is clean. Rows exactly matching an already-imported transaction (same account, date, narration, debit, credit, and balance) are skipped as duplicates and counted separately.

Accounts are created automatically from the account numbers in the file. Every upload is recorded as a batch; deleting a batch cascades to its transactions. **Wipe all** clears every transaction and batch — there's no undo.

## The ledger

`/transactions` shows transactions newest first (`transaction_date DESC, id DESC`), paginated at 50 per page (max 200). Filters live in the URL, so a filtered view is reloadable and shareable, and other pages deep-link into it:

| Filter | Semantics |
|---|---|
| Account, Category | exact match; **Uncategorized only** is a distinct mode from "all categories" |
| From / To date | **inclusive on both ends** |
| Narration contains | case-insensitive; `%` and `_` are literal, not wildcards |
| Type | case-insensitive exact match |
| Min / Max amount | **positive dollars** compared against the absolute value of the debit or credit |

Contradictory combinations are rejected with a 422 rather than quietly returning nothing — `uncategorized` with a `category_id`, an inverted date range, or an inverted amount range.

Rows can be categorized individually or in bulk. Selection applies to the current page only and clears when you change pages, so a bulk assign can never touch rows you can't see.

## Categorization

Categories have a **kind** (`expense`, `income`, or `transfer`) and expense categories may carry a **budget**. Transfers are excluded from spending and income totals so moving money between your own accounts doesn't register as either.

Rules on `/rules` auto-categorize on import and can be re-run over existing transactions from the ledger's **Apply rules now**. A rule matches on narration, transaction type, and/or an amount range; rows it categorizes are marked `auto`. Setting a category by hand clears that marker, so a later rule run won't overwrite your decision.

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

## Trends

`/trends` charts the same data `/reports` shows for one month, across many: spending by category (the top 6 categories by total, everything else summed as "Other" — the Reports grid remains the complete, un-summarized view), income vs spending vs net, and budget vs actual. An account's balance-history chart lives on its own detail page (`/accounts/:id`) instead, since it's the only place that needs it.

The multi-month numbers are derived from the **same** query the single-month Reports grid uses (`services/reporting.category_grid`), not a second independent query — so `/trends` and `/reports` can never quietly disagree about the same month. Budget vs actual is scoped to only the categories that actually have a budget set, on both sides of the comparison; comparing total spending against total budgeted would always look "over" the moment any unbudgeted category has activity, which isn't a useful signal. The budgeted line is genuinely per-period, not one figure repeated across the window — a [monthly override](#budgets) steps the line for that month only.

Charts are hand-rolled SVG (`src/components/charts/`), not a library — this keeps the frontend at four runtime dependencies. Two things worth knowing if you're extending them: a `null` value in a series is a genuine gap (no data for that period) and breaks the line rather than drawing through it as zero — this is how an account's balance history renders the months before its first transaction; and bar charts always include zero in their scale so a negative month (a refund, a loss) draws sensibly below the baseline instead of needing special-case handling.

## Recurring payments

`/recurring` finds subscriptions and regular bills by grouping same-account transactions with matching narrations and checking whether the gaps between them are consistent enough to be weekly, fortnightly, monthly, quarterly, or yearly — at least 3 occurrences, ordinary irregular spending (groceries, coffee) doesn't qualify. See `services/recurring.py`'s module docstring for the exact thresholds.

For each detected series it shows the next expected date (calendar-aware — a monthly bill on 31 January is next due 28 February, not "31 days later"), whether the latest amount changed from its established norm, and an estimated annual cost. "Missed or stopped" status is judged against **that account's own latest imported transaction**, never today's date — otherwise every series would look overdue the moment an import falls behind.

A false positive can be **dismissed** from the list; dismissals persist (keyed on account + normalized narration) and can be restored from the page's collapsed Dismissed section. Nothing about detection itself is stored — it's recomputed from the ledger on every request, so there's nothing to keep in sync when transactions are imported or deleted.

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

## QNAP Deployment

`docker-compose.qnap.yml` is the file to deploy with Container Station. It builds two services, `api` and `web`, from the images published by `.github/workflows/deploy.yml` to GHCR (gated on backend/frontend tests passing — see the workflow). It does **not** run Postgres — it assumes Postgres already runs as its own Container Station application, and joins that application's Docker network so `api` can reach it by container name.

Steps:

1. On the NAS, find the existing Postgres container's Docker network name and container name (`docker network ls` / `docker inspect <postgres-container>`, or Container Station's network view for that application). The Postgres user needs `GRANT CREATE ON SCHEMA public` so the app's startup migrations can create its tables — without it, the api container starts but every database-backed request fails, and the failure is otherwise silent (see `initialize_database()` in `backend/app/main.py`, which logs the error to stderr on failure — check the container logs if `database_ready` is ever `false`).
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

4. Deploy. The app is reachable at `http://<nas-ip>:8080`, and the API directly at `http://<nas-ip>:8000`.

Images are published as both `:latest` and `:<commit-sha>`. `docker-compose.qnap.yml` uses `:latest` by default; to pin a known-good build instead, edit the image tags in Container Station's compose editor to a specific commit SHA from the repository's Actions/Packages history.

### Troubleshooting: API returns 404 but the page loads

If the frontend loads but every `/api/...` call returns `404 {"detail":"Not Found"}`, check the container names first (Container Station → your app → containers list) before suspecting the code. The compose file's services are named `api` and `web`; a clean creation with application name `homebudget` produces containers named `homebudget-api-1` / `homebudget-web-1`. A **doubled** prefix (e.g. `homebudget-homebudget-web-1`) means the application wasn't created cleanly — delete it and recreate it from scratch rather than debugging further; that mismatch, not application code, was the actual cause the one time this came up.
