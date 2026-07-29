# homeBudget

A household budget tool. Import bank transactions from a CSV export, view them in a ledger, and clean up mistakes — delete a single transaction, delete an entire import, or wipe everything and start over.

Backend: FastAPI + SQLAlchemy + Postgres, schema managed by Alembic. Frontend: React + Vite, served by nginx in production.

## Transactions feature

The `/transactions` page is the app. It has three parts:

- **Import CSV** — upload a bank export. The importer expects an exact header row:

  ```
  BSB Number,Account Number,Transaction Date,Narration,Cheque Number,Debit,Credit,Balance,Transaction Type
  ```

  `Transaction Date` must be `DD/MM/YYYY`. Each row needs exactly one of `Debit`/`Credit` populated (not both, not neither). If **any** row in the file fails validation, the whole file is rejected with a per-row error list — nothing is imported until the file is clean. Rows that exactly match an already-imported transaction (same account, date, narration, debit, credit, and balance) are silently skipped as duplicates and counted separately from what actually got imported.
- **Import History** — every upload is recorded as a batch (filename, timestamp, rows imported, duplicates skipped). Deleting a batch cascades to delete all of its transactions.
- **Ledger** — every imported transaction, newest first, with a per-row delete. **Wipe all** clears every transaction and every batch — there's no undo.

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
