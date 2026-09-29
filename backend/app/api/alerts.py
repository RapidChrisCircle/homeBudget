from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..deps import get_db
from ..models import AlertDismissal
from ..schemas import (
    AlertDismissalCreate,
    AlertDismissalResponse,
    AlertsResponse,
    DismissAllAlertsRequest,
    DismissAllAlertsResponse,
)
from ..services.alerts import collect_alerts, dismiss_alert, dismiss_all_alerts

router = APIRouter()


@router.get("/alerts", response_model=AlertsResponse)
def get_alerts(db: Session = Depends(get_db)):

    alerts = collect_alerts(db)
    return AlertsResponse(alerts=alerts, count=len(alerts))


@router.post("/alerts/dismissals", response_model=AlertDismissalResponse, status_code=201)
def create_alert_dismissal(payload: AlertDismissalCreate, db: Session = Depends(get_db)):
    """Dismisses one GENERIC alert (over-budget, coverage gap, unmatched
    transfer) by its own key - see services/alerts.py's docstring for why a
    recurring-sourced alert is dismissed through the existing
    POST /recurring/dismissals instead, not through here.
    """

    dismissal_id = dismiss_alert(db, payload.alert_key)
    return AlertDismissalResponse(id=dismissal_id, alert_key=payload.alert_key)


@router.delete("/alerts/dismissals/{dismissal_id}", status_code=204)
def delete_alert_dismissal(dismissal_id: int, db: Session = Depends(get_db)):
    """Un-dismisses one alert - the corresponding fact reappears on the next
    GET /alerts if it's still true.
    """

    dismissal = db.get(AlertDismissal, dismissal_id)

    if dismissal is None:
        raise HTTPException(status_code=404, detail="Dismissal not found")

    db.delete(dismissal)
    db.commit()


@router.post("/alerts/dismissals/all", response_model=DismissAllAlertsResponse)
def create_all_alert_dismissals(payload: DismissAllAlertsRequest, db: Session = Depends(get_db)):
    """Dismisses every CURRENTLY OUTSTANDING alert (T5.3) - the card-level
    'Dismiss all' and each section's own 'Dismiss these N' - optionally
    scoped to one kind. See services/alerts.dismiss_all_alerts's own
    docstring for why this has to live server-side rather than the client
    looping a list of keys through the existing single-dismiss endpoints:
    a mixed feed has two different dismissal mechanisms, and only this
    module knows which alert uses which.
    """

    dismissed_count = dismiss_all_alerts(db, kind=payload.kind)
    return DismissAllAlertsResponse(dismissed_count=dismissed_count)
