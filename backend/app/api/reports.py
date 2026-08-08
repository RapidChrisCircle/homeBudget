from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..deps import get_db
from ..schemas import (
    BudgetLineResponse,
    CategoryGridPeriodResponse,
    CategoryGridResponse,
    CategoryGridRowResponse,
    MonthlyReportResponse,
    MonthlySummaryResponse,
    ReportPeriodResponse,
    UncategorizedSummaryResponse,
)
from ..services.reporting import (
    DEFAULT_GRID_MONTHS,
    MAX_GRID_MONTHS,
    available_periods,
    build_monthly_report,
)

router = APIRouter()


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


@router.get("/reports/periods", response_model=list[ReportPeriodResponse])
def list_report_periods(db: Session = Depends(get_db)):

    return [
        ReportPeriodResponse(year=year, month=month, label=_label(year, month), transaction_count=count)
        for year, month, count in available_periods(db)
    ]
