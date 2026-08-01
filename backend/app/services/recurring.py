"""Recurring payment detection.

Everything that decides what counts as "recurring" lives here as named
constants, so the heuristic can be tuned in one place rather than hunted for.
These thresholds were validated against synthetic date series (weekly,
fortnightly, monthly-on-a-fixed-day, monthly-shifted-to-business-days,
end-of-month, quarterly, yearly, plus several kinds of irregular spending)
before being fixed - see the plan history for the numbers.

Grouping - what makes two rows "the same payment":

    (account_id, narration_key(narration))

Per account, because the same subscription charged to two cards is genuinely
two separate commitments, and because the missed/stopped signal below needs a
per-account view of "how current is our data". narration_key() uppercases,
collapses whitespace (this bank's exports are fixed-width padded, e.g.
"RED ENERGY               CREMORNE"), and strips 4+ digit runs, since receipt
and reference numbers vary between otherwise-identical occurrences.

Cadence classification - gaps in days between consecutive occurrences, sorted
by date:

- MIN_OCCURRENCES = 3: two occurrences give one gap, which establishes
  nothing about regularity.
- Each gap set is scored by its MEDIAN (robust to one outlier) against five
  nominal intervals (weekly/fortnightly/monthly/quarterly/yearly). The median
  must land within INTERVAL_TOLERANCE of a bucket's nominal interval - the
  buckets do not overlap at this tolerance, so the first (only) match is
  unambiguous.
- MAX_RELATIVE_SPREAD caps (max gap - min gap) / median gap. Genuine cadences
  measured well under this even with business-day shifting; irregular
  spending (groceries, coffee runs) measured far above it. This is what keeps
  ordinary shopping out of the list.

Amounts use the ABSOLUTE value of whichever of debit/credit is populated -
the same convention categorization._row_amount uses, duplicated here for the
same reason it's duplicated there: this runs over a different query shape and
they cannot share code, so a test asserts they agree on a boundary value.

Fixed vs. variable, and price rises: the relative spread of every amount
EXCEPT the most recent is computed. Tight (<= AMOUNT_TIGHT_TOLERANCE) means a
fixed-amount series (subscriptions, rent) - amount_changed fires when the
latest occurrence differs from the prior median by both a relative and an
absolute floor, so a $2 bill doesn't get flagged over a few cents of
rounding. Not tight means a variable-amount series (electricity, water) -
amount_changed never fires for these, because every single bill would trip a
naive threshold.

Next due date is calendar-aware: monthly/quarterly/yearly add whole calendar
months preserving day-of-month (clamped to the month's last day, so a 31 Jan
series next-dues on 28 Feb, not "31 days later"). Repeatedly adding the
nominal 30.44-day average would drift off the real billing date within a
year.

Missed and stopped - judged against `as_of`, defined per account as that
account's OWN LATEST transaction_date, never date.today(). This is the single
most important decision in this module: judging "overdue" against today's
date would flag every series the moment an import lags, which is exactly the
kind of noise this signal exists to avoid. If the household's last import
only covers up to 15 July, nothing due after 15 July is missing - it just
hasn't been imported yet. Grace is the larger of 3 days or 20% of the
interval. Overdue by two or more full intervals reports status "ended" (read
as: this subscription stopped) rather than "overdue" (read as: this bill is
late).

Detection is pure computation over the ledger, run fresh on every call - no
series are persisted, so there is nothing to keep in sync when transactions
are imported or deleted. The only persisted state is RecurringDismissal, a
user's explicit "this is not recurring" opt-out keyed on the same
(account_id, narration_key) grouping.

direction is "inflow" or "outflow", from whether a series' occurrences are
credits or debits - typical_amount/latest_amount/annual_cost stay ABSOLUTE
values (categorization._row_amount's convention), so direction is what a
caller needs to know whether to add or subtract them. Decided by majority
across occurrences rather than requiring every leg to agree, since a rare
mixed series (e.g. a refund landing among an otherwise all-debit series)
should not be un-detected over one exception; a tie is called "outflow" -
the far more common shape for a recurring series (bills, subscriptions).
"""

import calendar
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import Account, Category, RecurringDismissal, Transaction
from .categorization import _row_amount

MIN_OCCURRENCES = 3
INTERVAL_TOLERANCE = 0.25
MAX_RELATIVE_SPREAD = 0.35
AMOUNT_TIGHT_TOLERANCE = Decimal("0.05")
PRICE_CHANGE_MIN_RELATIVE = Decimal("0.05")
PRICE_CHANGE_MIN_ABSOLUTE = Decimal("1.00")
DUE_SOON_WINDOW_DAYS = 14
MIN_GRACE_DAYS = 3
GRACE_FRACTION_OF_INTERVAL = 0.2
ENDED_AFTER_INTERVALS = 2

# (cadence name, nominal interval in days, occurrences per year).
CADENCE_BUCKETS = (
    ("weekly", 7, 52),
    ("fortnightly", 14, 26),
    ("monthly", 30.44, 12),
    ("quarterly", 91.3, 4),
    ("yearly", 365, 1),
)

STATUSES = ("active", "due_soon", "overdue", "ended")


@dataclass
class RecurringSeries:

    account_id: int
    account_name: str | None
    narration_key: str
    merchant: str
    sample_narration: str
    cadence: str
    interval_days: int
    occurrence_count: int
    first_date: date
    last_date: date
    # "inflow" or "outflow" - see module docstring. Every amount field below
    # stays an ABSOLUTE value; this is what tells a caller which way it goes.
    direction: str
    typical_amount: Decimal
    latest_amount: Decimal
    amount_varies: bool
    amount_changed: bool
    next_due_date: date
    status: str
    annual_cost: Decimal
    category_id: int | None
    category_name: str | None
    dismissed: bool
    # The RecurringDismissal row's id when dismissed, else None - the
    # caller needs this to DELETE the dismissal (restore), since dismissal
    # is keyed on (account_id, narration_key), not on anything a series
    # itself carries.
    dismissal_id: int | None


def narration_key(narration: str) -> str:
    """Groups occurrences of "the same" payment despite bank-side per-row
    noise: fixed-width whitespace padding and varying receipt/reference
    numbers embedded in the narration.
    """

    text = " ".join((narration or "").upper().split())
    words = [w for w in text.split(" ") if not (len(w) >= 4 and w.isdigit())]
    return " ".join(words)


def merchant_label(narration: str) -> str:
    """The human-readable merchant name: the text before the first run of
    2+ spaces (this bank pads narration/location into one fixed-width
    field), or the whole trimmed narration when there is no such run.
    """

    text = (narration or "").strip()
    head = text.split("  ")[0]
    return " ".join(head.split())


def _row_query(db: Session, account_id: int | None = None):
    """Lightweight column query - no ORM hydration, no relationship
    loading - mirroring categorization._eligible_rows.
    """

    query = db.query(
        Transaction.account_id,
        Transaction.narration,
        Transaction.transaction_date,
        Transaction.debit,
        Transaction.credit,
        Transaction.category_id,
    ).filter(Transaction.account_id.isnot(None))

    if account_id is not None:
        query = query.filter(Transaction.account_id == account_id)

    return query.all()


def _account_as_of(db: Session) -> dict[int, date]:
    """{account_id: latest transaction_date} - each account's own data
    horizon, used to judge that account's series as missed/stopped without
    being thrown off by another account's more recent or older data.
    """

    rows = (
        db.query(Transaction.account_id, func.max(Transaction.transaction_date))
        .filter(Transaction.account_id.isnot(None))
        .group_by(Transaction.account_id)
        .all()
    )

    return {account_id: as_of for account_id, as_of in rows}


def latest_transaction_date(db: Session) -> date | None:
    """The single most recent transaction_date across the whole ledger -
    for display only (an "as of" caption). Status decisions use the
    per-account _account_as_of, not this.
    """

    return db.query(func.max(Transaction.transaction_date)).scalar()


def _dismissal_ids(db: Session) -> dict[tuple[int, str], int]:

    rows = db.query(RecurringDismissal.id, RecurringDismissal.account_id, RecurringDismissal.narration_key).all()
    return {(account_id, key): dismissal_id for dismissal_id, account_id, key in rows}


def _add_months(d: date, months: int) -> date:
    """Adds whole calendar months, clamping the day to the target month's
    last valid day (31 Jan + 1 month -> 28/29 Feb, not an overflow into
    March). Repeatedly adding a fixed day count would drift off the actual
    billing date within a year.
    """

    month_index = d.month - 1 + months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _step_forward(d: date, cadence: str) -> date:

    if cadence == "weekly":
        return d + timedelta(days=7)
    if cadence == "fortnightly":
        return d + timedelta(days=14)
    if cadence == "monthly":
        return _add_months(d, 1)
    if cadence == "quarterly":
        return _add_months(d, 3)
    if cadence == "yearly":
        return _add_months(d, 12)
    raise ValueError(f"unknown cadence: {cadence}")


def _classify_cadence(gaps: list[int]) -> tuple[str, float, int] | None:
    """(cadence, nominal_interval_days, occurrences_per_year), or None if
    the gaps look like ordinary irregular spending rather than a recurring
    payment.
    """

    median_gap = statistics.median(gaps)

    if median_gap <= 0:
        return None

    relative_spread = (max(gaps) - min(gaps)) / median_gap

    if relative_spread > MAX_RELATIVE_SPREAD:
        return None

    for cadence, nominal, occurrences_per_year in CADENCE_BUCKETS:
        if abs(median_gap - nominal) / nominal <= INTERVAL_TOLERANCE:
            return cadence, nominal, occurrences_per_year

    return None


def _direction(occurrences: list) -> str:
    """"inflow" or "outflow" for a series - see module docstring for the
    majority-wins tie-break.
    """

    credit_count = sum(1 for o in occurrences if o.credit is not None)
    debit_count = len(occurrences) - credit_count

    return "inflow" if credit_count > debit_count else "outflow"


def _classify_status(next_due_date: date, as_of: date, nominal_interval: float) -> str:

    overdue_days = (as_of - next_due_date).days
    days_until_due = (next_due_date - as_of).days
    grace_days = max(MIN_GRACE_DAYS, GRACE_FRACTION_OF_INTERVAL * nominal_interval)

    if overdue_days > ENDED_AFTER_INTERVALS * nominal_interval:
        return "ended"

    if overdue_days > grace_days:
        return "overdue"

    if 0 <= days_until_due <= DUE_SOON_WINDOW_DAYS:
        return "due_soon"

    return "active"


def detect_series(db: Session, include_dismissed: bool = False) -> list[RecurringSeries]:
    """Every recurring series found in the ledger, newest-due-first.

    Dismissed series are excluded unless include_dismissed=True, in which
    case they are still returned (with dismissed=True) rather than merged
    away, so the caller can list them separately (e.g. a "Dismissed" section
    with a restore action).
    """

    rows = _row_query(db)

    if not rows:
        return []

    account_as_of = _account_as_of(db)
    account_names = dict(db.query(Account.id, Account.name).all())
    category_names = dict(db.query(Category.id, Category.name).all())
    dismissal_ids = _dismissal_ids(db)

    groups: dict[tuple[int, str], list] = defaultdict(list)
    for row in rows:
        key = narration_key(row.narration)
        if key:
            groups[(row.account_id, key)].append(row)

    series_list: list[RecurringSeries] = []

    for (account_id, key), occurrences in groups.items():

        occurrences.sort(key=lambda r: r.transaction_date)

        if len(occurrences) < MIN_OCCURRENCES:
            continue

        dates = [o.transaction_date for o in occurrences]
        gaps = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]

        classification = _classify_cadence(gaps)
        if classification is None:
            continue

        cadence, nominal_interval, occurrences_per_year = classification

        amounts = [_row_amount(o.debit, o.credit) for o in occurrences]
        if any(amount is None for amount in amounts):
            continue

        typical_amount = statistics.median(amounts)
        latest_amount = amounts[-1]
        prior_amounts = amounts[:-1]
        prior_median = statistics.median(prior_amounts)

        if prior_median:
            prior_spread = (max(prior_amounts) - min(prior_amounts)) / prior_median
        else:
            prior_spread = Decimal(999)

        amount_varies = prior_spread > AMOUNT_TIGHT_TOLERANCE

        if amount_varies or not prior_median:
            amount_changed = False
        else:
            diff = abs(latest_amount - prior_median)
            amount_changed = (
                diff / prior_median > PRICE_CHANGE_MIN_RELATIVE
                and diff >= PRICE_CHANGE_MIN_ABSOLUTE
            )

        last_date = dates[-1]
        next_due_date = _step_forward(last_date, cadence)
        as_of = account_as_of.get(account_id, last_date)
        status = _classify_status(next_due_date, as_of, nominal_interval)

        annual_cost = (typical_amount * occurrences_per_year).quantize(Decimal("0.01"))

        category_counts = Counter(o.category_id for o in occurrences if o.category_id is not None)
        category_id = category_counts.most_common(1)[0][0] if category_counts else None

        dismissal_id = dismissal_ids.get((account_id, key))
        is_dismissed = dismissal_id is not None
        if is_dismissed and not include_dismissed:
            continue

        series_list.append(RecurringSeries(
            account_id=account_id,
            account_name=account_names.get(account_id),
            narration_key=key,
            merchant=merchant_label(occurrences[-1].narration),
            sample_narration=occurrences[-1].narration,
            cadence=cadence,
            interval_days=round(nominal_interval),
            occurrence_count=len(occurrences),
            first_date=dates[0],
            last_date=last_date,
            direction=_direction(occurrences),
            typical_amount=typical_amount,
            latest_amount=latest_amount,
            amount_varies=amount_varies,
            amount_changed=amount_changed,
            next_due_date=next_due_date,
            status=status,
            annual_cost=annual_cost,
            category_id=category_id,
            category_name=category_names.get(category_id) if category_id is not None else None,
            dismissed=is_dismissed,
            dismissal_id=dismissal_id,
        ))

    series_list.sort(key=lambda s: (s.next_due_date, s.merchant))

    return series_list


def summarize(series: list[RecurringSeries]) -> dict:
    """Headline numbers for the recurring page and the dashboard card.
    Pass only non-dismissed series (detect_series's default) - dismissed
    series should never contribute to totals.
    """

    due_soon = [s for s in series if s.status == "due_soon"]
    # "Missed or stopped" - overdue and ended both mean the same thing to a
    # user glancing at a summary count: something isn't tracking as expected.
    missed = [s for s in series if s.status in ("overdue", "ended")]
    changed = [s for s in series if s.amount_changed]

    return {
        "series_count": len(series),
        "total_annual_cost": sum((s.annual_cost for s in series), Decimal("0.00")),
        "due_soon_count": len(due_soon),
        "due_soon_total": sum((s.typical_amount for s in due_soon), Decimal("0.00")),
        "changed_count": len(changed),
        "overdue_count": len(missed),
    }
