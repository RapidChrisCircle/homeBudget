"""Pay-period boundaries and budget pacing, for either of two pay
frequencies (PaySchedule.frequency, PAY_FREQUENCIES in models.py).

Finding 3 (fortnightly): the Queensland preset household is paid every two
weeks, and three months a year contain three pay cycles - a strictly
calendar-monthly budget mis-states those months in both directions. This
module answers "what fortnight does this date fall in" and "what's the
fortnightly pace of an existing monthly budget", anchored to the single
household-wide PaySchedule row (models.py) - one schedule every page
agrees on, never a second independently-configured one.

Finding 23 (monthly, T5.4): the inverse case - a household paid monthly,
on the last business day. Here the "period" IS the calendar month (a
deliberate choice: the payday sets the RHYTHM, not a boundary offset from
it), so pacing is a 1:1 passthrough of the standing budget and the whole
per-category table would be identical to the existing Monthly Budgets
card. Rather than show that table twice, the frontend folds a monthly
schedule into Monthly Budgets itself (just a payday line), and this module
still answers "when is the next payday" and "what's the pace" truthfully
for any API caller that isn't the frontend, via `frequency`/`payday`/
`days_until_next_payday` on the same response shape either way.

"Last business day" means Mon-Fri only, no public-holiday calendar - a
deliberate simplification, not an oversight: QLD public holidays
essentially never fall on the last weekday of a month (Christmas/Boxing
Day precede the 31st, New Year's/Australia Day are early-month, Labour Day
and King's Birthday are first-Mondays, and Easter never reaches a month
end), so a holiday calendar would change the computed payday in
approximately no real month, for either a new dependency or ~100 lines
needing yearly review.

Deliberately a VIEW over the existing monthly budget model, not a second,
independently-edited budget period (see ROADMAP.md's T2.2 design note for
why: making the budget period itself configurable would touch reporting,
trends and the dashboard's month-bounds assumptions throughout, for a
household that still thinks in calendar months for everything except this
one pacing check). A category's already-resolved STANDING monthly
budget_amount is rescaled to each frequency's own pace; nothing about how
budgets are stored, overridden or reported elsewhere changes, and a
household that never sets a PaySchedule sees nothing different anywhere
else in the app.

Overrides are deliberately NOT consulted here, unlike reporting.py's
effective_budget()-based resolution - a fortnight can (and three times a
year, does) straddle two different calendar months, each potentially
carrying its own override, and there is no principled way to pick "the"
month an override should apply from for a 14-day window; the same
reasoning extends to "monthly", whose period boundaries don't align with
calendar-month override boundaries either, once the payday lands
mid-month-ish via a weekend rollback. Pacing always uses the plain
standing amount; this is a documented limitation, not an oversight.

PERIODS_PER_YEAR gives each frequency's real-world pay-calendar
convention, not a more "precise" derived figure - 365.25 / 14 isn't
exactly 26, and a fortnightly household already lives with an occasional
27-payday year without their annual budget being recalculated for it;
monthly is exactly 12 by definition.
"""

import calendar
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import and_, func
from sqlalchemy.orm import Session, aliased

from ..models import Category, PaySchedule
from .allocations import allocation_subquery
from .reporting import month_bounds

FORTNIGHT_DAYS = 14
PAY_PERIODS_PER_YEAR = 26

# One place mapping a frequency to how many pacing periods it has per year -
# see pace() below. Keys match models.PAY_FREQUENCIES exactly.
PERIODS_PER_YEAR = {"fortnightly": PAY_PERIODS_PER_YEAR, "monthly": 12}


def get_schedule(db: Session) -> tuple[str, date | None] | None:
    """(frequency, anchor_date) if pay-period budgeting has been set up,
    else None - "not configured" is the absence of a row, never guessed
    from today's date. anchor_date is only ever non-None for "fortnightly" -
    see PaySchedule's own docstring in models.py for why "monthly" simply
    has none to store.
    """

    schedule = db.query(PaySchedule).first()

    if schedule is None:
        return None

    return schedule.frequency, schedule.anchor_date


def set_schedule(db: Session, frequency: str, anchor_date: date | None) -> tuple[str, date | None]:
    """Upserts the single PaySchedule row - see its own docstring for why
    this is enforced in Python (get-or-create-and-update) rather than a
    schema constraint.
    """

    schedule = db.query(PaySchedule).first()

    if schedule is not None:
        schedule.frequency = frequency
        schedule.anchor_date = anchor_date
    else:
        schedule = PaySchedule(frequency=frequency, anchor_date=anchor_date)
        db.add(schedule)

    db.commit()

    return frequency, anchor_date


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


def last_business_day(year: int, month: int) -> date:
    """The last Mon-Fri day of the given calendar month - see this
    module's own docstring for why a public-holiday calendar isn't worth
    it here. calendar.monthrange(year, month)[1] is the same "days in this
    month" primitive services.recurring._add_months already uses.
    """

    day = calendar.monthrange(year, month)[1]
    candidate = date(year, month, day)

    while candidate.weekday() >= 5:  # 5 = Saturday, 6 = Sunday
        candidate -= timedelta(days=1)

    return candidate


def next_payday(reference: date) -> date:
    """The next monthly payday (last business day of a calendar month) on
    or after `reference` - "on or after", not strictly after, so a
    household checking on payday itself sees 0 days away rather than
    being told to wait a further month.
    """

    this_months_payday = last_business_day(reference.year, reference.month)

    if this_months_payday >= reference:
        return this_months_payday

    next_month = reference.month + 1
    next_year = reference.year

    if next_month > 12:
        next_month = 1
        next_year += 1

    return last_business_day(next_year, next_month)


def pace(monthly_amount: Decimal | None, frequency: str) -> Decimal | None:
    """Rescales an already-resolved STANDING MONTHLY figure to `frequency`'s
    own pace (amount * 12 / PERIODS_PER_YEAR[frequency]) - for "monthly"
    this is a 1:1 passthrough, still quantized to 2dp so the serialized
    form never differs from the fortnightly case just because the maths
    happened to be trivial. None in, None out - "no budget set" stays "no
    budget set", never a rescaled zero.
    """

    if monthly_amount is None:
        return None

    return (monthly_amount * 12 / PERIODS_PER_YEAR[frequency]).quantize(Decimal("0.01"))


def fortnightly_pace(monthly_amount: Decimal | None) -> Decimal | None:
    """Thin alias for pace(monthly_amount, "fortnightly") - kept so every
    caller and test written against the original fortnightly-only API
    keeps working unchanged now that pace() covers both frequencies.
    """

    return pace(monthly_amount, "fortnightly")


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


def pay_period_category_totals(
    db: Session, start: date, end: date, frequency: str = "fortnightly"
) -> list[PayPeriodCategoryPace]:
    """Every non-transfer category's activity in the period [start, end),
    with its standing budget rescaled to `frequency`'s own pace. Deliberately
    NOT reporting.category_totals_for_period() - that function resolves
    overrides for the ONE month it spans, which isn't meaningful for a
    fortnight that can straddle two months (see this module's own
    docstring). Structurally this mirrors that function's own query (outer
    join through allocation_subquery, kind != transfer), without pretending
    the two share a code path they can't.
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
            pace=pace(row.budget_amount, frequency),
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
