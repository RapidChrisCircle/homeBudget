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

rollover_available() answers a DIFFERENT question from effective_budget(),
deliberately kept as its own choke point rather than folded into that one:
not "what is this month's own budget" but "including everything carried
forward, what's actually available". A category opts in via
Category.rolls_over; unspent budget accumulates as a positive carry-in,
overspend as a negative one, walked forward from Category.rollover_start_
year/month (the month rollover was switched on - see models.py's docstring
for why that, not the category's creation date, is the epoch). Every other
caller wanting "the budget" unchanged by accumulation keeps reading
effective_budget() exactly as before; only reporting.category_totals_for_
period() and api/budgets.py call this for categories that have opted in.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from ..models import Category, CategoryBudget, Transaction
from .allocations import allocation_subquery


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


def _month_bounds(year: int, month: int) -> tuple[date, date]:
    """Duplicated from reporting.py's identical helper rather than imported
    - reporting.py already imports FROM this module (effective_budget,
    overrides_for_period), so the reverse import would be circular.
    """

    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, end


def _months_between(start: tuple[int, int], end: tuple[int, int]) -> list[tuple[int, int]]:
    """Every (year, month) from start to end inclusive, oldest first."""

    start_index = start[0] * 12 + (start[1] - 1)
    end_index = end[0] * 12 + (end[1] - 1)

    periods = []
    for index in range(start_index, end_index + 1):
        year, zero_based_month = divmod(index, 12)
        periods.append((year, zero_based_month + 1))
    return periods


@dataclass
class RolloverMonth:

    year: int
    month: int
    # The month's own resolved budget (0 when unset - see rollover_history's
    # docstring for why unset is treated as a zero contribution here, unlike
    # everywhere else effective_budget's None means "no budget for this
    # month" as a distinct state from a real zero).
    resolved_budget: Decimal
    # Presentation-signed spend, matching CategoryPeriodTotal.actual - a
    # positive figure for money spent, negative for a net-refund month.
    actual: Decimal
    # carry-in (previous month's available minus what it actually spent)
    # plus this month's own resolved_budget. This IS "available to spend
    # this month", already reflecting every prior month's accumulation.
    available: Decimal


def rollover_history(db: Session, category: Category, year: int, month: int) -> list["RolloverMonth"]:
    """Every month from category.rollover_start_year/month through (year,
    month) inclusive, oldest first, walking the accumulation forward one
    month at a time. Returns [] when the category doesn't roll over, has no
    recorded start (rolls_over was never actually turned on), or (year,
    month) falls before that start - nothing has accumulated yet.

    A month with no budget of its own (effective_budget() returns None)
    still contributes to the walk - it's simply zero NEW money added that
    month, not a break in the chain - so an existing carry-in still shows up
    as available the following month. This is a deliberate departure from
    effective_budget's own None-means-no-budget rule, made here rather than
    changed there, because "accumulate the carry" and "what did I set as a
    per-month figure" are different questions - see this module's docstring.
    """

    if not category.rolls_over or category.rollover_start_year is None or category.rollover_start_month is None:
        return []

    start = (category.rollover_start_year, category.rollover_start_month)
    target = (year, month)

    if start > target:
        return []

    periods = _months_between(start, target)
    window_start, _ = _month_bounds(*periods[0])
    _, window_end = _month_bounds(*periods[-1])

    alloc = allocation_subquery(db)
    rows = (
        db.query(alloc.c.transaction_date, alloc.c.amount)
        .filter(
            alloc.c.category_id == category.id,
            alloc.c.transaction_date >= window_start,
            alloc.c.transaction_date < window_end,
        )
        .all()
    )

    net_by_period: dict[tuple[int, int], Decimal] = {}
    for transaction_date, amount in rows:
        key = (transaction_date.year, transaction_date.month)
        net_by_period[key] = net_by_period.get(key, Decimal("0")) + Decimal(amount)

    overrides = overrides_for_periods(db, periods)
    standing = category.budget_amount

    history: list[RolloverMonth] = []
    carry = Decimal("0")

    for period in periods:

        resolved = effective_budget(standing, overrides.get((category.id, period)))
        budget = resolved if resolved is not None else Decimal("0")
        spent = -net_by_period.get(period, Decimal("0"))
        available = carry + budget

        history.append(RolloverMonth(year=period[0], month=period[1], resolved_budget=budget, actual=spent, available=available))

        carry = available - spent

    return history


def rollover_available(db: Session, category: Category, year: int, month: int) -> Decimal | None:
    """The one figure callers actually want: (year, month)'s available
    amount including every prior month's accumulation, or None if the
    category isn't a rollover category / hasn't started accumulating yet.
    The single choke point for this question - see module docstring.
    """

    history = rollover_history(db, category, year, month)
    return history[-1].available if history else None
