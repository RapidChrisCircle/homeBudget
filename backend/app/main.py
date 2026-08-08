import sys
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import account_groups, accounts, budgets, categories, category_rules, csv_formats, forecast, goals, net_worth, recurring, reports, transactions, trends, version
from .database import settings
from .version import get_commit, get_version

app = FastAPI(
    title="homeBudget"
)

BACKEND_DIR = Path(__file__).resolve().parents[1]


def initialize_database() -> tuple[bool, str | None]:

    try:

        if str(BACKEND_DIR) not in sys.path:
            sys.path.insert(0, str(BACKEND_DIR))

        alembic_cfg = Config(str(BACKEND_DIR / "alembic.ini"))
        command.upgrade(alembic_cfg, "head")

        return True, None

    except Exception as exc:

        print(f"[startup] database migration failed: {exc}", file=sys.stderr)
        return False, str(exc)


db_ready, db_error = initialize_database()
app.state.database_ready = db_ready
app.state.database_error = db_error


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


@app.middleware("http")
async def add_build_identity_headers(request, call_next):
    """Stamps every response - including a bare 404 for an unmatched
    route - with which build answered it, via the same get_version()/
    get_commit() GET /api/version itself reports (app/version.py). No new
    resolution logic; this only makes an existing fact visible on every
    response instead of one dedicated endpoint.

    The reason this exists: more than one API container answering the same
    hostname (Docker round-robins DNS across them - see README.md's
    "API returns 404 but the page loads" troubleshooting note) makes the
    SAME page succeed on one reload and 404 on the next, with nothing in
    a single response distinguishing "a stale/different build answered
    this one" from an ordinary error. A middleware, not a per-route
    dependency, specifically so it still runs on a 404 for a path that
    matched no route at all - the exact case this is for.
    """

    response = await call_next(request)
    response.headers["X-App-Version"] = get_version()
    response.headers["X-App-Commit"] = get_commit()
    return response


app.include_router(
    transactions.router,
    prefix="/api"
)

app.include_router(
    accounts.router,
    prefix="/api"
)

app.include_router(
    account_groups.router,
    prefix="/api"
)

app.include_router(
    categories.router,
    prefix="/api"
)

app.include_router(
    category_rules.router,
    prefix="/api"
)

app.include_router(
    reports.router,
    prefix="/api"
)

app.include_router(
    recurring.router,
    prefix="/api"
)

app.include_router(
    trends.router,
    prefix="/api"
)

app.include_router(
    budgets.router,
    prefix="/api"
)

app.include_router(
    forecast.router,
    prefix="/api"
)

app.include_router(
    version.router,
    prefix="/api"
)

app.include_router(
    csv_formats.router,
    prefix="/api"
)

app.include_router(
    net_worth.router,
    prefix="/api"
)

app.include_router(
    goals.router,
    prefix="/api"
)


@app.get("/")
def root():

    return {
        "message": "homeBudget API running",
        "database_ready": app.state.database_ready,
        "database_error": app.state.database_error
    }
