from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..deps import get_db
from ..models import Account, RecurringDismissal
from ..schemas import (
    RecurringDismissalCreate,
    RecurringDismissalResponse,
    RecurringResponse,
    RecurringSummaryResponse,
)
from ..services.recurring import detect_series, latest_transaction_date, summarize

router = APIRouter()


@router.get("/recurring", response_model=RecurringResponse)
def get_recurring(include_dismissed: bool = False, db: Session = Depends(get_db)):

    series = detect_series(db, include_dismissed=include_dismissed)

    # Dismissed series must never count toward the summary, even when
    # include_dismissed=True is asked for the list view.
    summarized = summarize([s for s in series if not s.dismissed])

    return RecurringResponse(
        series=series,
        summary=RecurringSummaryResponse(**summarized),
        as_of=latest_transaction_date(db),
    )


@router.post("/recurring/dismissals", response_model=RecurringDismissalResponse, status_code=201)
def create_dismissal(payload: RecurringDismissalCreate, db: Session = Depends(get_db)):

    if db.get(Account, payload.account_id) is None:
        raise HTTPException(status_code=404, detail="Account not found")

    existing = (
        db.query(RecurringDismissal)
        .filter(
            RecurringDismissal.account_id == payload.account_id,
            RecurringDismissal.narration_key == payload.narration_key,
        )
        .first()
    )

    # Idempotent rather than 409: the UI cannot race itself into an error by
    # double-clicking Dismiss, and there is no meaningful difference between
    # "already dismissed" and "just dismissed" from the caller's perspective.
    if existing is not None:
        return existing

    dismissal = RecurringDismissal(
        account_id=payload.account_id,
        narration_key=payload.narration_key,
    )
    db.add(dismissal)
    db.commit()
    db.refresh(dismissal)

    return dismissal


@router.delete("/recurring/dismissals/{dismissal_id}", status_code=204)
def delete_dismissal(dismissal_id: int, db: Session = Depends(get_db)):

    dismissal = db.get(RecurringDismissal, dismissal_id)

    if dismissal is None:
        raise HTTPException(status_code=404, detail="Dismissal not found")

    db.delete(dismissal)
    db.commit()
