"""Reports the running build's version and commit, for GET /api/version.

Resolution order, each tier a fallback for the one before:

1. APP_VERSION / GIT_SHA environment variables - set by the Docker build
   (ARG -> ENV in Dockerfile, values supplied by .github/workflows/deploy.yml
   from the repo-root VERSION file and the commit SHA). A real deployed
   container always has these.
2. The repo-root VERSION file, read directly - present in local dev
   (scripts/start.sh runs from a full checkout), but NOT present inside the
   built image, which copies only app/, alembic/ and alembic.ini. This tier
   exists so local dev shows the real version rather than always "dev".
3. "dev" / "unknown" - what a misconfigured image actually falls back to,
   rather than failing to boot. Never raises: a version endpoint that 500s
   on a fresh checkout would be a worse failure than the version being
   wrong.

Deliberately two independently-resolved values, not one combined string -
GET /api/version is compared against the frontend's own build-time version
specifically to catch a partial redeploy (the api and web images are pushed
and tagged independently - see deploy.yml), and that comparison needs commit
granularity a bare "0.11.0" can't provide.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]  # repo root in local dev; matches database.py's BASE_DIR


def _read_version_file() -> str | None:

    version_file = BASE_DIR / "VERSION"

    if not version_file.exists():
        return None

    return version_file.read_text().strip() or None


def get_version() -> str:

    return os.environ.get("APP_VERSION") or _read_version_file() or "dev"


def get_commit() -> str:

    return os.environ.get("GIT_SHA") or "unknown"
