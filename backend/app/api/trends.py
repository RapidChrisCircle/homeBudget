from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..deps import get_db
from ..models import Category
from ..schemas import (
    CategoryGridPeriodResponse,
    CategoryGridRowResponse,
    TrendBalanceResponse,
    TrendBudgetResponse,
    TrendMerchantRowResponse,
    TrendMerchantsResponse,
    TrendMonthlySummaryResponse,
    TrendsResponse,
)
from ..services.net_worth import net_worth_history
from ..services.reporting import (
    DEFAULT_GRID_MONTHS,
    MAX_GRID_MONTHS,
    category_grid,
    contiguous_periods,
    default_period,
)
from ..services.trends import budget_totals, category_merchants, monthly_summaries

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
    net_worth_by_period = net_worth_history(db, periods)

    return TrendsResponse(
        periods=[CategoryGridPeriodResponse(year=y, month=m, label=_label(y, m)) for y, m in periods],
        categories=[
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
            TrendBalanceResponse(label=_label(*period), balance=net_worth_by_period[period])
            for period in periods
        ],
    )


@router.get("/trends/merchants", response_model=TrendMerchantsResponse)
def get_trend_category_merchants(
    category_id: int = Query(...),
    year: int | None = Query(None, ge=1900, le=2999),
    month: int | None = Query(None, ge=1, le=12),
    months: int = Query(DEFAULT_GRID_MONTHS, ge=1, le=MAX_GRID_MONTHS),
    db: Session = Depends(get_db),
):

    if (year is None) != (month is None):
        raise HTTPException(status_code=422, detail="year and month must be supplied together")

    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")

    if year is None or month is None:
        year, month = default_period(db)

    periods = contiguous_periods(year, month, months)
    merchants = category_merchants(db, category, periods)
    total_spent = sum((m["total_spent"] for m in merchants), Decimal("0"))
    parent_name = category.parent.name if category.parent_id and category.parent else None

    return TrendMerchantsResponse(
        category_id=category.id,
        category_name=category.name,
        parent_id=category.parent_id,
        parent_name=parent_name,
        total_spent=total_spent,
        merchants=[TrendMerchantRowResponse(**m) for m in merchants],
    )
