from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..deps import get_db
from ..schemas import (
    BudgetLineResponse,
    CategoryGridPeriodResponse,
    CategoryGridResponse,
    CategoryGridRowResponse,
    DailyActivityResponse,
    DashboardKpiResponse,
    MonthlyReportResponse,
    MonthlySummaryResponse,
    ReportPeriodResponse,
    UncategorizedSummaryResponse,
)
from ..services.dashboard_metrics import dashboard_kpis, daily_activity
from ..services.reporting import (
    DEFAULT_GRID_MONTHS,
    MAX_GRID_MONTHS,
    available_periods,
    build_monthly_report,
    default_period,
)

router = APIRouter()

# Generous for any one dashboard widget's own window (a calendar or
# sparkline covers at most a few months at a time) without leaving the
# range genuinely unbounded - a bit over a year.
MAX_DAILY_ACTIVITY_DAYS = 400


def _label(year: int, month: int) -> str:

    return f"{year:04d}-{month:02d}"


@router.get("/reports/monthly", response_model=MonthlyReportResponse)
def get_monthly_report(
    year: int | None = Query(None, ge=1900, le=2999),
    month: int | None = Query(None, ge=1, le=12),
    months: int = Query(DEFAULT_GRID_MONTHS, ge=1, le=MAX_GRID_MONTHS),
    db: Session = Depends(get_db)
):

    if (year is None) != (month is None):
        raise HTTPException(status_code=422, detail="year and month must be supplied together")

    report = build_monthly_report(db, year=year, month=month, months=months)

    grid_periods = [
        CategoryGridPeriodResponse(year=y, month=m, label=_label(y, m))
        for y, m in report["grid"]["periods"]
    ]

    grid_rows = [
        CategoryGridRowResponse(
            category_id=row["category_id"],
            category_name=row["category_name"],
            parent_id=row["parent_id"],
            parent_name=row["parent_name"],
            kind=row["kind"],
            archived=row["archived"],
            amounts={_label(y, m): amount for (y, m), amount in row["amounts"].items()},
            total=row["total"],
        )
        for row in report["grid"]["rows"]
    ]

    return MonthlyReportResponse(
        year=report["year"],
        month=report["month"],
        label=report["label"],
        start_date=report["start_date"],
        end_date=report["end_date"],
        summary=MonthlySummaryResponse(**report["summary"]),
        budgets=[BudgetLineResponse.model_validate(t) for t in report["budgets"]],
        grid=CategoryGridResponse(periods=grid_periods, rows=grid_rows),
        uncategorized=UncategorizedSummaryResponse(**report["uncategorized"]),
    )


@router.get("/reports/kpis", response_model=DashboardKpiResponse)
def get_dashboard_kpis(
    year: int | None = Query(None, ge=1900, le=2999),
    month: int | None = Query(None, ge=1, le=12),
    months: int = Query(DEFAULT_GRID_MONTHS, ge=1, le=MAX_GRID_MONTHS),
    db: Session = Depends(get_db)
):
    """The dashboard's StatTile widgets - see
    services/dashboard_metrics.dashboard_kpis for what each figure means.
    Same year/month/months contract as /reports/monthly, so a StatTile's
    own "months" config lines up with what the rest of the app already
    means by that word.
    """

    if (year is None) != (month is None):
        raise HTTPException(status_code=422, detail="year and month must be supplied together")

    if year is None or month is None:
        year, month = default_period(db)

    kpis = dashboard_kpis(db, year, month, months)

    return DashboardKpiResponse(
        periods=[CategoryGridPeriodResponse(year=y, month=m, label=_label(y, m)) for y, m in kpis["periods"]],
        total_income=kpis["total_income"],
        total_expenses=kpis["total_expenses"],
        net_saved=kpis["net_saved"],
        transaction_count=kpis["transaction_count"],
        avg_per_month=kpis["avg_per_month"],
        avg_per_transaction=kpis["avg_per_transaction"],
    )


@router.get("/reports/daily", response_model=list[DailyActivityResponse])
def get_daily_activity(
    date_from: date = Query(...),
    date_to: date = Query(...),
    db: Session = Depends(get_db)
):
    """Day-granularity activity for the TransactionCalendar and
    ComparisonSparkline widgets - see services/dashboard_metrics.py.
    date_from/date_to are INCLUSIVE on both ends, mirroring the ledger's
    own date filter convention (services/ledger.py), not
    reporting.month_bounds' half-open one - a caller building this from
    utils/trendsSeries.monthBounds already produces exactly this shape.
    """

    if date_from > date_to:
        raise HTTPException(status_code=422, detail="date_from must not be after date_to")

    if (date_to - date_from).days > MAX_DAILY_ACTIVITY_DAYS:
        raise HTTPException(
            status_code=422,
            detail=f"date range must not exceed {MAX_DAILY_ACTIVITY_DAYS} days",
        )

    # Advanced by one day at this internal boundary only, to satisfy
    # daily_activity's own half-open [start, end) contract - date_to
    # itself stays inclusive at the API surface.
    rows = daily_activity(db, date_from, date_to + timedelta(days=1))

    return [DailyActivityResponse(**row) for row in rows]


@router.get("/reports/periods", response_model=list[ReportPeriodResponse])
def list_report_periods(db: Session = Depends(get_db)):

    return [
        ReportPeriodResponse(year=year, month=month, label=_label(year, month), transaction_count=count)
        for year, month, count in available_periods(db)
    ]
