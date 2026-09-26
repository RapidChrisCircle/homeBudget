"""Fortnightly pay-period boundaries and budget pacing.

Finding 3: the preset household is paid fortnightly, and three months a
year contain three pay cycles - a strictly calendar-monthly budget
mis-states those months in both directions. This module answers "what
fortnight does this date fall in" and "what's the fortnightly pace of an
existing monthly budget", both anchored to the single household-wide
PaySchedule row (models.py) - one anchor every page agrees on, never a
second independently-configured one.

Deliberately a VIEW over the existing monthly budget model, not a second,
independently-edited budget period (see ROADMAP.md's T2.2 design note for
why: making the budget period itself configurable would touch reporting,
trends and the dashboard's month-bounds assumptions throughout, for a
household that still thinks in calendar months for everything except this
one pacing check). A category's already-resolved STANDING monthly
budget_amount is rescaled to a fortnightly figure; nothing about how
budgets are stored, overridden or reported elsewhere changes, and a
household that never sets a PaySchedule sees nothing different anywhere
else in the app.

Overrides are deliberately NOT consulted here, unlike reporting.py's
effective_budget()-based resolution - a fortnight can (and three times a
year, does) straddle two different calendar months, each potentially
carrying its own override, and there is no principled way to pick "the"
month an override should apply from for a 14-day window. Pacing always
uses the plain standing amount; this is a documented limitation, not an
oversight.

26 pay periods/year (PAY_PERIODS_PER_YEAR) is the real-world fortnightly
pay convention this rescaling matches - 365.25 / 14 is not exactly 26, and
a household paid fortnightly already lives with an occasional 27-payday
year without their annual budget being recalculated for it. Matching that
convention, rather than a more "precise" derived figure, is the point.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import and_, func
from sqlalchemy.orm import Session, aliased

from ..models import Category, PaySchedule
from .allocations import allocation_subquery

FORTNIGHT_DAYS = 14
PAY_PERIODS_PER_YEAR = 26


def get_anchor(db: Session) -> date | None:
    """The household's one configured payday, or None if pay-period
    budgeting hasn't been set up yet. Never guessed from today's date."""

    schedule = db.query(PaySchedule).first()
    return schedule.anchor_date if schedule is not None else None


def set_anchor(db: Session, anchor_date: date) -> date:
    """Upserts the single PaySchedule row - see its own docstring for why
    this is enforced in Python (get-or-create-and-update) rather than a
    schema constraint.
    """

    schedule = db.query(PaySchedule).first()

    if schedule is not None:
        schedule.anchor_date = anchor_date
    else:
        schedule = PaySchedule(anchor_date=anchor_date)
        db.add(schedule)

    db.commit()

    return anchor_date


def pay_period_bounds(anchor: date, reference: date) -> tuple[date, date]:
    """The half-open [start, end) 14-day period containing `reference`,
    counting whole fortnights forward or backward from `anchor` - `anchor`
    itself always falls on a period's start day. `//` is floor division in
    Python even for a negative numerator, so this is exactly as correct for
    a `reference` before `anchor` as after it, and nothing here resets at a
    calendar month or year boundary - a period is just N*14 days from the
    anchor, however large N needs to be.
    """

    offset_days = (reference - anchor).days
    period_index = offset_days // FORTNIGHT_DAYS
    start = anchor + timedelta(days=period_index * FORTNIGHT_DAYS)
    end = start + timedelta(days=FORTNIGHT_DAYS)
    return start, end


def shift_period(start: date, periods: int) -> date:
    """The start date `periods` fortnights away from `start` (negative for
    earlier) - independent of the anchor, since a period is always exactly
    14 days long once you already know where one starts.
    """

    return start + timedelta(days=FORTNIGHT_DAYS * periods)


def fortnightly_pace(monthly_amount: Decimal | None) -> Decimal | None:
    """Rescales an already-resolved STANDING MONTHLY figure to a
    fortnightly pace (amount * 12 / 26). None in, None out - "no budget
    set" stays "no budget set", never a rescaled zero.
    """

    if monthly_amount is None:
        return None

    return (monthly_amount * 12 / PAY_PERIODS_PER_YEAR).quantize(Decimal("0.01"))


@dataclass
class PayPeriodCategoryPace:

    category_id: int
    category_name: str
    parent_id: int | None
    parent_name: str | None
    kind: str
    standing_budget: Decimal | None
    # None whenever standing_budget is None - see fortnightly_pace().
    pace: Decimal | None
    actual: Decimal

    @property
    def difference(self) -> Decimal | None:
        """pace - actual. Positive = under pace, negative = over."""

        if self.pace is None:
            return None

        return self.pace - self.actual


def pay_period_category_totals(db: Session, start: date, end: date) -> list[PayPeriodCategoryPace]:
    """Every non-transfer category's activity in the fortnight [start, end),
    with its standing budget rescaled to a fortnightly pace. Deliberately
    NOT reporting.category_totals_for_period() - that function requires a
    month-aligned start and resolves overrides for the ONE month it spans,
    neither of which is meaningful for an arbitrary 14-day window that can
    straddle two months. Structurally this mirrors that function's own
    query (outer join through allocation_subquery, kind != transfer),
    without pretending the two share a code path they can't.
    """

    alloc = allocation_subquery(db)
    parent = aliased(Category)

    rows = (
        db.query(
            Category.id,
            Category.name,
            Category.kind,
            Category.budget_amount,
            Category.parent_id,
            parent.name.label("parent_name"),
            func.coalesce(func.sum(alloc.c.amount), 0).label("net"),
        )
        .select_from(Category)
        .outerjoin(
            alloc,
            and_(
                alloc.c.category_id == Category.id,
                alloc.c.transaction_date >= start,
                alloc.c.transaction_date < end,
            ),
        )
        .outerjoin(parent, Category.parent_id == parent.id)
        .filter(Category.kind != "transfer")
        .group_by(
            Category.id, Category.name, Category.kind, Category.budget_amount, Category.parent_id, parent.name,
        )
        .order_by(Category.name)
        .all()
    )

    totals = []

    for row in rows:

        net = Decimal(row.net)
        actual = -net if row.kind == "expense" else net

        totals.append(PayPeriodCategoryPace(
            category_id=row.id,
            category_name=row.name,
            parent_id=row.parent_id,
            parent_name=row.parent_name,
            kind=row.kind,
            standing_budget=row.budget_amount,
            pace=fortnightly_pace(row.budget_amount),
            actual=actual,
        ))

    return totals


def pay_period_lines(totals: list[PayPeriodCategoryPace]) -> list[PayPeriodCategoryPace]:
    """Expense categories worth showing: budgeted (has a pace), or with
    activity this period - same "worth showing" rule as reporting.
    budget_lines(), applied to a fortnight instead of a month.
    """

    return [t for t in totals if t.kind == "expense" and (t.pace is not None or t.actual != 0)]


def pay_period_summary(totals: list[PayPeriodCategoryPace]) -> tuple[Decimal, Decimal, Decimal]:
    """(total_income, total_spending, net_saved) for the fortnight - derived
    from pay_period_category_totals()'s own rows, not a second query, the
    same reason reporting.monthly_summary() does this for a calendar month.
    """

    total_income = sum((t.actual for t in totals if t.kind == "income"), Decimal("0"))
    total_spending = sum((t.actual for t in totals if t.kind == "expense"), Decimal("0"))
    return total_income, total_spending, total_income - total_spending
