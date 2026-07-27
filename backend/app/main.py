from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import home, pages
from .database import Base, engine, settings

app = FastAPI(
    title="Home Platform"
)


def initialize_database() -> tuple[bool, str | None]:

    try:

        Base.metadata.create_all(
            bind=engine
        )

        return True, None

    except Exception as exc:

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
    home.router,
    prefix="/api"
)


app.include_router(
    pages.router
)


@app.get("/")
def root():

    return {
        "message": "Home Platform API running",
        "database_ready": app.state.database_ready,
        "database_error": app.state.database_error
    }
