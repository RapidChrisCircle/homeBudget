import sys
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import accounts, budgets, categories, category_rules, forecast, recurring, reports, transactions, trends, version
from .database import settings

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


app.include_router(
    transactions.router,
    prefix="/api"
)

app.include_router(
    accounts.router,
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


@app.get("/")
def root():

    return {
        "message": "homeBudget API running",
        "database_ready": app.state.database_ready,
        "database_error": app.state.database_error
    }
