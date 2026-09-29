from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..deps import get_db
from ..models import PAY_FREQUENCIES
from ..schemas import (
    PayPeriodCategoryResponse,
    PayPeriodResponse,
    PayPeriodSummaryResponse,
    PayScheduleResponse,
    PayScheduleUpdate,
)
from ..services.pay_periods import (
    get_schedule,
    next_payday,
    pay_period_bounds,
    pay_period_category_totals,
    pay_period_lines,
    pay_period_summary,
    set_schedule,
)
from ..services.reporting import month_bounds

router = APIRouter()


@router.get("/pay-schedule", response_model=PayScheduleResponse)
def get_pay_schedule(db: Session = Depends(get_db)):

    schedule = get_schedule(db)

    if schedule is None:
        return PayScheduleResponse(configured=False, frequency=None, anchor_date=None)

    frequency, anchor_date = schedule
    return PayScheduleResponse(configured=True, frequency=frequency, anchor_date=anchor_date)


@router.put("/pay-schedule", response_model=PayScheduleResponse)
def put_pay_schedule(payload: PayScheduleUpdate, db: Session = Depends(get_db)):

    if payload.frequency not in PAY_FREQUENCIES:
        raise HTTPException(
            status_code=422,
            detail=f"frequency must be one of: {', '.join(PAY_FREQUENCIES)}",
        )

    if payload.frequency == "fortnightly" and payload.anchor_date is None:
        raise HTTPException(
            status_code=422,
            detail="anchor_date is required for a fortnightly schedule",
        )

    # A monthly schedule has no anchor to store at all (see PaySchedule's
    # own docstring) - any anchor_date sent alongside "monthly" is simply
    # not persisted, rather than rejected, since it implies no contradiction
    # worth a 422 over.
    anchor_date = payload.anchor_date if payload.frequency == "fortnightly" else None

    frequency, anchor_date = set_schedule(db, payload.frequency, anchor_date)
    return PayScheduleResponse(configured=True, frequency=frequency, anchor_date=anchor_date)


@router.get("/pay-periods", response_model=PayPeriodResponse)
def get_pay_period(reference_date: date | None = None, db: Session = Depends(get_db)):
    """The pay period containing `reference_date` (today, if omitted) -
    a fortnight anchored to PaySchedule.anchor_date, or the calendar month
    itself for a monthly schedule (see services/pay_periods.py's own
    docstring for why "monthly" doesn't offset the period from the payday).
    Reports {"configured": false} rather than 404ing or guessing a schedule
    from today's date when none has been set up yet - see PaySchedule's own
    docstring in models.py.
    """

    schedule = get_schedule(db)

    if schedule is None:
        return PayPeriodResponse(configured=False)

    frequency, anchor_date = schedule

    if reference_date is None:
        reference_date = date.today()

    if frequency == "fortnightly":
        start, end = pay_period_bounds(anchor_date, reference_date)
        # A period always starts on a payday by construction, so the next
        # period's own start IS the next payday.
        payday = end
    else:
        start, end = month_bounds(reference_date.year, reference_date.month)
        payday = next_payday(reference_date)

    totals = pay_period_category_totals(db, start, end, frequency=frequency)
    total_income, total_spending, net_saved = pay_period_summary(totals)

    return PayPeriodResponse(
        configured=True,
        frequency=frequency,
        start_date=start,
        end_date=end,
        label=f"{start.isoformat()} to {(end - date.resolution).isoformat()}",
        payday=payday,
        days_until_next_payday=(payday - reference_date).days,
        categories=[PayPeriodCategoryResponse.model_validate(t) for t in pay_period_lines(totals)],
        summary=PayPeriodSummaryResponse(
            total_income=total_income, total_spending=total_spending, net_saved=net_saved
        ),
    )
