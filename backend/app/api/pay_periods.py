from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..deps import get_db
from ..schemas import (
    PayPeriodCategoryResponse,
    PayPeriodResponse,
    PayPeriodSummaryResponse,
    PayScheduleResponse,
    PayScheduleUpdate,
)
from ..services.pay_periods import (
    get_anchor,
    pay_period_bounds,
    pay_period_category_totals,
    pay_period_lines,
    pay_period_summary,
    set_anchor,
)

router = APIRouter()


@router.get("/pay-schedule", response_model=PayScheduleResponse)
def get_pay_schedule(db: Session = Depends(get_db)):

    anchor = get_anchor(db)
    return PayScheduleResponse(configured=anchor is not None, anchor_date=anchor)


@router.put("/pay-schedule", response_model=PayScheduleResponse)
def put_pay_schedule(payload: PayScheduleUpdate, db: Session = Depends(get_db)):

    anchor = set_anchor(db, payload.anchor_date)
    return PayScheduleResponse(configured=True, anchor_date=anchor)


@router.get("/pay-periods", response_model=PayPeriodResponse)
def get_pay_period(reference_date: date | None = None, db: Session = Depends(get_db)):
    """The fortnight containing `reference_date` (today, if omitted).
    Reports {"configured": false} rather than 404ing or guessing an anchor
    from today's date when no PaySchedule has been set up yet - see
    PaySchedule's own docstring in models.py.
    """

    anchor = get_anchor(db)

    if anchor is None:
        return PayPeriodResponse(configured=False)

    if reference_date is None:
        reference_date = date.today()

    start, end = pay_period_bounds(anchor, reference_date)
    totals = pay_period_category_totals(db, start, end)
    total_income, total_spending, net_saved = pay_period_summary(totals)

    return PayPeriodResponse(
        configured=True,
        start_date=start,
        end_date=end,
        label=f"{start.isoformat()} to {(end - date.resolution).isoformat()}",
        categories=[PayPeriodCategoryResponse.model_validate(t) for t in pay_period_lines(totals)],
        summary=PayPeriodSummaryResponse(
            total_income=total_income, total_spending=total_spending, net_saved=net_saved
        ),
    )
