"""GET /export/database - the whole-database backup case. See
services/export.py's module docstring for why this is a separate thing
from GET /transactions/export (the filtered, accountant-facing CSV).
"""

import json
from datetime import datetime

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from ..deps import get_db
from ..services.export import database_snapshot

router = APIRouter()


@router.get("/export/database")
def export_database(db: Session = Depends(get_db)):
    """Every table, unfiltered, as one JSON document - see
    services/export.database_snapshot for what's included and the
    deliberate absence of a restore-from-snapshot endpoint.
    """

    snapshot = database_snapshot(db)
    filename = f"homebudget-backup-{datetime.now():%Y%m%d-%H%M%S}.json"

    return Response(
        content=json.dumps(snapshot, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
