from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..deps import get_db
from ..models import Category, CategoryBudget
from ..schemas import (
    BudgetCopyRequest,
    BudgetCopyResponse,
    BudgetOverrideUpdate,
    BudgetPeriodCategoryResponse,
    BudgetPeriodResponse,
    BudgetPeriodTotalsResponse,
)
from ..services.budgets import copy_budgets, effective_budget, overrides_for_period
from ..services.reporting import category_totals_for_period, default_period, month_bounds

router = APIRouter()


def _category_response(db: Session, category: Category, year: int, month: int) -> BudgetPeriodCategoryResponse:
    """One category's budget/actual for one month - shared by PUT and DELETE
    so their responses are built the exact same way GET's list is, just for
    a single row.
    """

    start, end = month_bounds(year, month)
    totals = category_totals_for_period(db, start, end)
    total = next((t for t in totals if t.category_id == category.id), None)

    override = overrides_for_period(db, year, month).get(category.id)
    standing = category.budget_amount
    effective = effective_budget(standing, override)
    actual = total.actual if total is not None else Decimal("0")

    return BudgetPeriodCategoryResponse(
        category_id=category.id,
        category_name=category.name,
        standing_amount=standing,
        override_amount=override,
        effective_amount=effective,
        is_overridden=override is not None,
        actual=actual,
        difference=(effective - actual) if effective is not None else None,
    )


@router.get("/budgets", response_model=BudgetPeriodResponse)
def get_budgets(
    year: int | None = Query(None, ge=1900, le=2999),
    month: int | None = Query(None, ge=1, le=12),
    db: Session = Depends(get_db)
):

    if (year is None) != (month is None):
        raise HTTPException(status_code=422, detail="year and month must be supplied together")

    if year is None or month is None:
        year, month = default_period(db)

    start, end = month_bounds(year, month)
    # Archived is excluded UNCONDITIONALLY here, unlike reporting.py's own
    # budget_lines()/category_grid() filters - this is a forward-looking
    # editing surface, not a historical total, and archiving is reversible,
    # so there's no "still has activity" carve-out to make: nothing here
    # is money that already moved.
    totals = [
        t for t in category_totals_for_period(db, start, end)
        if t.kind == "expense" and not t.archived
    ]

    # category_totals_for_period() already resolved budget_amount to the
    # EFFECTIVE figure - the raw standing amount and which rows are
    # overridden need their own lookup, purely for display (never for
    # resolution - that already happened).
    standing_by_id = dict(
        db.query(Category.id, Category.budget_amount).filter(Category.kind == "expense").all()
    )
    overrides = overrides_for_period(db, year, month)

    categories = [
        BudgetPeriodCategoryResponse(
            category_id=t.category_id,
            category_name=t.category_name,
            standing_amount=standing_by_id.get(t.category_id),
            override_amount=overrides.get(t.category_id),
            effective_amount=t.budget_amount,
            is_overridden=t.category_id in overrides,
            actual=t.actual,
            difference=t.difference,
        )
        for t in totals
    ]

    budgeted_categories = [c for c in categories if c.effective_amount is not None]
    total_budgeted = sum((c.effective_amount for c in budgeted_categories), Decimal("0"))
    # Matches trends.budget_totals()'s scoping exactly: "actual" in the
    # totals row counts only the categories that are themselves budgeted -
    # otherwise the totals row would always look "over" the moment any
    # unbudgeted category has activity, which isn't a meaningful signal.
    total_actual = sum((c.actual for c in budgeted_categories), Decimal("0"))

    return BudgetPeriodResponse(
        year=year,
        month=month,
        categories=categories,
        totals=BudgetPeriodTotalsResponse(
            budgeted=total_budgeted,
            actual=total_actual,
            difference=total_budgeted - total_actual,
        ),
    )


@router.put("/budgets/{category_id}", response_model=BudgetPeriodCategoryResponse)
def upsert_budget_override(
    category_id: int,
    payload: BudgetOverrideUpdate,
    db: Session = Depends(get_db)
):

    category = db.get(Category, category_id)

    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")

    if category.kind != "expense":
        raise HTTPException(status_code=422, detail="Only expense categories can carry a budget")

    if payload.amount < 0:
        raise HTTPException(status_code=422, detail="amount must be a positive dollar value")

    existing = (
        db.query(CategoryBudget)
        .filter(
            CategoryBudget.category_id == category_id,
            CategoryBudget.year == payload.year,
            CategoryBudget.month == payload.month,
        )
        .first()
    )

    if existing is not None:
        existing.amount = payload.amount
    else:
        db.add(CategoryBudget(
            category_id=category_id, year=payload.year, month=payload.month, amount=payload.amount
        ))

    db.commit()

    return _category_response(db, category, payload.year, payload.month)


@router.delete("/budgets/{category_id}", status_code=204)
def revert_budget_override(
    category_id: int,
    year: int = Query(..., ge=1900, le=2999),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db)
):
    """Drops the override for this category/month, reverting it to the
    standing amount. Idempotent - a category with no override for that month
    already has the end state this call is asking for, so deleting nothing
    is success, not a 404. (The category itself not existing IS a real
    caller error and still 404s.)
    """

    category = db.get(Category, category_id)

    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")

    (
        db.query(CategoryBudget)
        .filter(CategoryBudget.category_id == category_id, CategoryBudget.year == year, CategoryBudget.month == month)
        .delete()
    )
    db.commit()


@router.post("/budgets/copy", response_model=BudgetCopyResponse)
def copy_budgets_endpoint(payload: BudgetCopyRequest, db: Session = Depends(get_db)):

    written = copy_budgets(
        db,
        (payload.from_year, payload.from_month),
        (payload.to_year, payload.to_month),
    )

    return BudgetCopyResponse(copied_count=written)
