from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..deps import get_db
from ..schemas import (
    CategoryGridPeriodResponse,
    CategoryGridRowResponse,
    TrendBalanceResponse,
    TrendBudgetResponse,
    TrendMonthlySummaryResponse,
    TrendsResponse,
)
from ..services.reporting import DEFAULT_GRID_MONTHS, MAX_GRID_MONTHS, category_grid, default_period
from ..services.trends import budget_totals, combined_balance_history, monthly_summaries

router = APIRouter()


def _label(year: int, month: int) -> str:

    return f"{year:04d}-{month:02d}"


@router.get("/trends", response_model=TrendsResponse)
def get_trends(
    year: int | None = Query(None, ge=1900, le=2999),
    month: int | None = Query(None, ge=1, le=12),
    months: int = Query(DEFAULT_GRID_MONTHS, ge=1, le=MAX_GRID_MONTHS),
    db: Session = Depends(get_db)
):

    if (year is None) != (month is None):
        raise HTTPException(status_code=422, detail="year and month must be supplied together")

    if year is None or month is None:
        year, month = default_period(db)

    periods, grid_rows = category_grid(db, year, month, months=months)
    balances = combined_balance_history(db, periods)

    return TrendsResponse(
        periods=[CategoryGridPeriodResponse(year=y, month=m, label=_label(y, m)) for y, m in periods],
        categories=[
            CategoryGridRowResponse(
                category_id=row["category_id"],
                category_name=row["category_name"],
                kind=row["kind"],
                archived=row["archived"],
                amounts={_label(y, m): amount for (y, m), amount in row["amounts"].items()},
                total=row["total"],
            )
            for row in grid_rows
        ],
        monthly=[
            TrendMonthlySummaryResponse(
                label=_label(*s["period"]),
                total_income=s["total_income"],
                total_spending=s["total_spending"],
                net_saved=s["net_saved"],
            )
            for s in monthly_summaries(periods, grid_rows)
        ],
        budget=[
            TrendBudgetResponse(label=_label(*b["period"]), budgeted=b["budgeted"], actual=b["actual"])
            for b in budget_totals(periods, grid_rows)
        ],
        balances=[
            TrendBalanceResponse(label=_label(*period), balance=balances[period])
            for period in periods
        ],
    )
