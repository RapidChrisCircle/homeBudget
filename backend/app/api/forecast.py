from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..deps import get_db
from ..schemas import ForecastResponse
from ..services.forecast import DEFAULT_FORECAST_MONTHS, MAX_FORECAST_MONTHS, project

router = APIRouter()


@router.get("/forecast", response_model=ForecastResponse)
def get_forecast(
    months: int = Query(DEFAULT_FORECAST_MONTHS, ge=1, le=MAX_FORECAST_MONTHS),
    db: Session = Depends(get_db)
):

    return ForecastResponse(**project(db, months=months))
