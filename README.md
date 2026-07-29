# nas-webapp-template

## Quick Start Script

Run both backend and frontend with one command from the repository root:

./scripts/start.sh

Optional: install backend and frontend dependencies before starting:

./scripts/start.sh --install

Service URLs:

- Backend: http://localhost:8000
- Frontend: http://localhost:5173

Press Ctrl+C to stop both services.

## Verification Scope

This template now includes 4 basic verification pages:

1. FastAPI no-DB page: /pages/no-db
2. FastAPI DB read page: /pages/db-status
3. React no-DB page: /verify/no-db
4. React DB read page: /verify/db

## Backend Setup

From /workspace/backend:

1. Install dependencies
2. Start FastAPI with uvicorn

Example:

python3 -m pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

Notes:

- The API root at / returns database_ready and database_error fields.
- The no-DB page at /pages/no-db does not query the database.
- The DB page at /pages/db-status performs a read-only query.

## Frontend Setup

From /workspace/frontend:

1. Install dependencies
2. Start Vite

Example:

npm install
npm run dev

Frontend default URL: http://localhost:5173

## Verification Flow

1. Open http://localhost:8000/pages/no-db
Expected: page renders even if DB is unavailable.

2. Open http://localhost:8000/pages/db-status
Expected:
- Success shows ID and message when DB and row exist.
- No data message appears when table has zero rows.
- Error message appears when DB is unreachable.

3. Open http://localhost:5173/verify/no-db
Expected: static React no-DB page renders without API calls.

4. Open http://localhost:5173/verify/db
Expected:
- Loading state first.
- Success state when /api/status is reachable and has data.
- Error state for missing row, API down, or DB failure.

## Database Note

The dev-time `docker-compose.yml` at the repository root is a devcontainer definition only (used by `.devcontainer/devcontainer.json`) - it does not run the app or a database. For local DB verification, provide a reachable PostgreSQL instance and the environment variables in `.env.example`, copied to `.env`.

Schema is managed by Alembic (`backend/alembic/`), not `create_all`. The app runs `alembic upgrade head` automatically at startup (see `initialize_database()` in `backend/app/main.py`), so a fresh database is brought up to date on first boot - no manual step needed for a first-time setup. When you change a model in `backend/app/models.py`, generate a migration for it before it'll take effect anywhere but your local dev DB:

cd backend
python3 -m alembic revision --autogenerate -m "describe the change"

Review the generated file in `backend/alembic/versions/` before committing - autogenerate is a starting point, not always correct as-is.

Also note: `GET /api/status` returns 404 when the `home_status` table has no rows (it no longer auto-seeds a row) - this is intentional, so `/verify/db`'s error state is exercised until a row is inserted manually.

## QNAP Deployment

`docker-compose.qnap.yml` is the file to deploy with Container Station. It builds two services, `api` and `web`, from the images published by `.github/workflows/deploy.yml` to GHCR. It does **not** run Postgres - it assumes Postgres already runs as its own Container Station application, and joins that application's Docker network so `api` can reach it by container name.

Steps:

1. On the NAS, find the existing Postgres container's Docker network name and container name (`docker network ls` / `docker inspect <postgres-container>`, or Container Station's network view for that application).
2. In Container Station: Create > Application > pull from GitHub, pointing at this repository and `docker-compose.qnap.yml`.
3. Container Station will detect the variables referenced in the compose file (it does not read `.env` files) and prompt for them:

   | Variable | Meaning |
   |---|---|
   | `GHCR_OWNER` | lowercase GitHub org/user that publishes the images |
   | `DB_NETWORK_NAME` | Docker network name of the existing Postgres application |
   | `DATABASE_HOST` | container/service name of the existing Postgres container on that network |
   | `DATABASE_PORT` | Postgres port (default `5432`) |
   | `DATABASE_NAME` / `DATABASE_USER` / `DATABASE_PASSWORD` | credentials for the existing database |
   | `ALLOWED_ORIGINS` | only needed for local dev against a remote API; leave as default for QNAP |
   | `API_PORT` / `WEB_PORT` | host ports to publish (default `8000` / `8080`) |

4. Deploy. The app is reachable at `http://<nas-ip>:8080`, and the API directly at `http://<nas-ip>:8000`.

Images are published as both `:latest` and `:<commit-sha>`. `docker-compose.qnap.yml` uses `:latest` by default; to pin a known-good build instead, edit the image tags in Container Station's compose editor to a specific commit SHA from the repository's Actions/Packages history.