"""Per-month budget resolution.

A category's budget for a given month comes from exactly one of two places,
and resolving which one is done in exactly one function - effective_budget()
- that every caller (reporting.py, trends.py, api/budgets.py) routes
through. Nothing else should read Category.budget_amount or CategoryBudget
directly and reimplement this choice; a caller that does silently ignores
overrides, which is a wrong number, not an error.

The rule: an override (a CategoryBudget row for that exact year/month) wins
if one exists; otherwise the category's standing budget_amount applies;
otherwise there is no budget for that month.

Two things this rule deliberately makes possible, both intentional:

- An override of 0.00 is a REAL budget of zero, not "no override, use
  standing". CategoryBudget.amount is NOT NULL specifically so this can never
  be ambiguous - "no row" means no override, a row (of any amount, including
  zero) means an override is in force.
- "No budget for just this one month" cannot be expressed. Clearing an
  override reverts to the standing amount, never to nothing; to have no
  budget at all, the standing amount itself must be cleared. A deliberate
  limitation rather than adding a third, nullable-override state.

copy_budgets() writes the source month's EFFECTIVE budgets (resolved via
effective_budget(), not read raw) as explicit overrides on the target month.
That is what makes "copy last month" produce a month that can be edited
freely afterward - if it copied the standing amount by reference instead, a
later change to the standing amount would silently reach back and change the
copied month too.
"""

from decimal import Decimal

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from ..models import Category, CategoryBudget


def effective_budget(standing: Decimal | None, override: Decimal | None) -> Decimal | None:
    """The one resolution rule - see module docstring. override wins when
    present (including when it is exactly 0.00), else standing, else None.
    """

    return override if override is not None else standing


def overrides_for_periods(
    db: Session, periods: list[tuple[int, int]]
) -> dict[tuple[int, tuple[int, int]], Decimal]:
    """{(category_id, (year, month)): override_amount} for every override
    that falls in one of the given periods. Only present entries ARE
    overrides - a missing (category_id, period) key means no override, not
    a zero one.
    """

    if not periods:
        return {}

    conditions = [and_(CategoryBudget.year == year, CategoryBudget.month == month) for year, month in periods]

    rows = (
        db.query(CategoryBudget.category_id, CategoryBudget.year, CategoryBudget.month, CategoryBudget.amount)
        .filter(or_(*conditions))
        .all()
    )

    return {
        (row.category_id, (int(row.year), int(row.month))): Decimal(row.amount)
        for row in rows
    }


def overrides_for_period(db: Session, year: int, month: int) -> dict[int, Decimal]:
    """{category_id: override_amount} for one month - the single-period
    shape api/budgets.py and copy_budgets() work with.
    """

    by_period = overrides_for_periods(db, [(year, month)])

    return {category_id: amount for (category_id, _period), amount in by_period.items()}


def copy_budgets(db: Session, from_period: tuple[int, int], to_period: tuple[int, int]) -> int:
    """Writes from_period's EFFECTIVE budget (standing or override,
    whichever applied) as an explicit override on to_period, for every
    expense category that has one. Overwrites an existing override on
    to_period rather than skipping it - "copy" means "make to_period match",
    not "fill in only the gaps". Returns the number of categories written;
    a category with no budget at all in from_period contributes nothing.
    """

    from_year, from_month = from_period
    to_year, to_month = to_period

    categories = (
        db.query(Category.id, Category.budget_amount)
        .filter(Category.kind == "expense")
        .all()
    )
    source_overrides = overrides_for_period(db, from_year, from_month)

    existing_targets = {
        row.category_id: row
        for row in db.query(CategoryBudget).filter(
            CategoryBudget.year == to_year,
            CategoryBudget.month == to_month,
        )
    }

    written = 0

    for category_id, standing in categories:

        effective = effective_budget(standing, source_overrides.get(category_id))

        if effective is None:
            continue

        target = existing_targets.get(category_id)

        if target is not None:
            target.amount = effective
        else:
            db.add(CategoryBudget(category_id=category_id, year=to_year, month=to_month, amount=effective))

        written += 1

    db.commit()

    return written
