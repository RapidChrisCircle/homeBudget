from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..deps import get_db
from ..models import Category
from ..schemas import ForecastResponse, ForecastScenarioRequest
from ..services.forecast import DEFAULT_FORECAST_MONTHS, MAX_FORECAST_MONTHS, project

router = APIRouter()


@router.get("/forecast", response_model=ForecastResponse)
def get_forecast(
    months: int = Query(DEFAULT_FORECAST_MONTHS, ge=1, le=MAX_FORECAST_MONTHS),
    db: Session = Depends(get_db)
):

    return ForecastResponse(**project(db, months=months))


@router.post("/forecast/scenario", response_model=ForecastResponse)
def post_forecast_scenario(payload: ForecastScenarioRequest, db: Session = Depends(get_db)):
    """A non-destructive, non-persisted "what if" overlay on the same
    projection GET /forecast returns - see services/forecast.py's module
    docstring. Nothing here is ever written to the database; calling this
    twice with the same payload returns the same answer, and never changing
    anything about a real recurring series or category.
    """

    if not (1 <= payload.months <= MAX_FORECAST_MONTHS):
        raise HTTPException(status_code=422, detail=f"months must be between 1 and {MAX_FORECAST_MONTHS}")

    category_ids = {adjustment.category_id for adjustment in payload.category_adjustments}

    if category_ids:
        found_ids = {row.id for row in db.query(Category.id).filter(Category.id.in_(category_ids))}
        missing = category_ids - found_ids
        if missing:
            raise HTTPException(status_code=404, detail=f"Unknown category id(s): {sorted(missing)}")

    stopped_series_keys = frozenset(
        (entry.account_id, entry.narration_key) for entry in payload.stopped_series
    )
    category_adjustments = {
        adjustment.category_id: adjustment.percent for adjustment in payload.category_adjustments
    }

    return ForecastResponse(**project(
        db,
        months=payload.months,
        stopped_series_keys=stopped_series_keys,
        category_adjustments=category_adjustments,
    ))
