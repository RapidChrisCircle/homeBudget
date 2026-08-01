"""Cash flow forecast: a monthly projection of each account's balance, built
from detected recurring commitments plus an estimated everyday-spending run
rate.

Anchored to the ledger, not to today. Projection starts from `as_of` - the
single most recent transaction_date across the whole ledger, exactly the
value recurring.latest_transaction_date() already computes - never
date.today(). The same reasoning recurring.py already applies to "overdue":
forecasting from today when the last import is three weeks stale would
silently invent three weeks of activity nobody has actually recorded.

Buckets: the remainder of the as_of month (a PARTIAL bucket - only the days
from as_of to month end are genuinely "future"), then `months` whole calendar
months. The partial bucket exists so the projection does not jump
discontinuously from a point-in-time balance to a month boundary. Its
run-rate contribution is pro-rated over the days actually remaining, and only
commitments due ON OR AFTER as_of count toward it - a commitment due earlier
in the as_of month already happened and is baked into the opening balance.

Recurring commitments are walked forward from each series' next_due_date
using recurring._step_forward (already calendar-aware). An OVERDUE series'
next_due_date can be in the past relative to as_of - stepping continues past
it until reaching the next real occurrence at or after as_of, so an overdue
bill contributes its next actual due date, not a stale one. An ENDED series
is presumed stopped and contributes nothing. A DISMISSED series was never
passed to this module by its caller in the first place (detect_series()'s
default already excludes them) - see below for why that matters twice over.

The everyday run rate (daily_run_rates) is a per-account NET daily average
(credits positive, debits negative, the same signed convention every module
here uses) over the 3 complete calendar months immediately before the as_of
month - the as_of month itself is excluded because it is incomplete, and a
partial month's total would understate a rate computed as if it were whole.

The run rate MUST exclude anything already counted as a recurring
commitment, or every subscription is subtracted twice and the forecast turns
systematically pessimistic. Exclusion is by (account_id,
recurring.narration_key(narration)) against the same `series` list passed
in - the exact grouping key detection itself used, so the two can never
disagree about what "the same payment" means. Because that exclusion set is
built from whatever `series` the caller supplies, and project() supplies
detect_series(db)'s default (dismissed excluded), a DISMISSED series'
transactions land back in the run rate automatically - correct, because a
dismissal is the user's own declaration that the pattern is NOT actually
recurring, so its spending belongs in "everyday", not vanished from the
forecast entirely.

Cash flow deliberately counts what reporting.py deliberately excludes:
- Uncategorized transactions - real money left the account; reporting
  excludes them because they can't be assigned to a category, but a forecast
  isn't categorizing anything, so omitting them would understate the burn
  rate.
- Transfers - a credit-card payment genuinely reduces the paying account's
  balance. Both legs sit in the ledger, so per-account they net correctly
  and the combined total is unaffected by which account paid which.
This is a deliberate, real divergence from every other money query in this
codebase. It is correct for projecting cash movement and wrong for
categorized reporting - do not "fix" it to match reporting.py.

An account with no transactions at all is omitted from the forecast, not
shown starting from a $0 balance - ledger.account_balances() already only
returns accounts with at least one transaction, so this falls out for free.
"""

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from ..models import Account, Transaction
from .ledger import account_balances
from .recurring import RecurringSeries, _add_months, _step_forward, detect_series, latest_transaction_date, narration_key
from .reporting import month_bounds

DEFAULT_FORECAST_MONTHS = 3
MAX_FORECAST_MONTHS = 24
RUN_RATE_LOOKBACK_MONTHS = 3


def forecast_periods(as_of: date, months: int = DEFAULT_FORECAST_MONTHS) -> list[tuple[int, int, bool]]:
    """(year, month, is_partial) for the as_of month (partial) followed by
    `months` whole calendar months. Reuses recurring._add_months (already
    calendar-aware and tested) rather than a second month-walking
    implementation - a 31 Jan as_of steps to 28 Feb, not "31 days later".
    """

    anchor = date(as_of.year, as_of.month, 1)
    periods = [(as_of.year, as_of.month, True)]

    for offset in range(1, months + 1):
        shifted = _add_months(anchor, offset)
        periods.append((shifted.year, shifted.month, False))

    return periods


def daily_run_rates(db: Session, as_of: date, series: list[RecurringSeries]) -> dict[int, Decimal]:
    """{account_id: signed daily rate} - see module docstring for the
    lookback window and the exclusion-by-narration_key rule. An account with
    no non-recurring activity in the window is simply absent (the caller
    treats a missing key as a zero rate).
    """

    anchor = date(as_of.year, as_of.month, 1)
    window_start_month = _add_months(anchor, -RUN_RATE_LOOKBACK_MONTHS)
    window_start, _ = month_bounds(window_start_month.year, window_start_month.month)
    window_end, _ = month_bounds(as_of.year, as_of.month)  # exclusive - as_of month itself excluded

    excluded_keys = {(s.account_id, s.narration_key) for s in series}

    rows = (
        db.query(Transaction.account_id, Transaction.narration, Transaction.debit, Transaction.credit)
        .filter(
            Transaction.account_id.isnot(None),
            Transaction.transaction_date >= window_start,
            Transaction.transaction_date < window_end,
        )
        .all()
    )

    totals: dict[int, Decimal] = defaultdict(Decimal)

    for row in rows:
        if (row.account_id, narration_key(row.narration)) in excluded_keys:
            continue
        totals[row.account_id] += Decimal(row.debit or 0) + Decimal(row.credit or 0)

    window_days = (window_end - window_start).days

    return {account_id: total / window_days for account_id, total in totals.items()}


def _future_occurrences(series: RecurringSeries, as_of: date, horizon_end: date) -> list[date]:
    """Every date `series` is expected to recur on, from the first
    occurrence at or after as_of through horizon_end inclusive. Steps past
    any occurrences before as_of first, so an OVERDUE series (whose
    next_due_date can already be in the past) contributes its next real
    occurrence rather than a stale one.
    """

    occurrence = series.next_due_date

    while occurrence < as_of:
        occurrence = _step_forward(occurrence, series.cadence)

    occurrences = []

    while occurrence <= horizon_end:
        occurrences.append(occurrence)
        occurrence = _step_forward(occurrence, series.cadence)

    return occurrences


def project(db: Session, months: int = DEFAULT_FORECAST_MONTHS) -> dict:
    """Everything /forecast needs, built from one consistent snapshot of the
    ledger - see module docstring for the modelling decisions.
    """

    as_of = latest_transaction_date(db)

    if as_of is None:
        return {"as_of": None, "periods": [], "accounts": [], "combined": None, "upcoming": []}

    periods = forecast_periods(as_of, months=months)
    period_bounds = {(year, month): month_bounds(year, month) for year, month, _ in periods}
    horizon_end = period_bounds[(periods[-1][0], periods[-1][1])][1] - timedelta(days=1)

    series = detect_series(db)  # dismissed excluded by default - see module docstring
    run_rates = daily_run_rates(db, as_of, series)
    balances = account_balances(db)
    account_names = dict(db.query(Account.id, Account.name).all())

    recurring_by_account: dict[int, dict[tuple[int, int], dict[str, Decimal]]] = defaultdict(
        lambda: defaultdict(lambda: {"in": Decimal("0"), "out": Decimal("0")})
    )
    upcoming = []

    for s in series:

        if s.status == "ended":
            continue

        direction_key = "in" if s.direction == "inflow" else "out"

        for occurrence in _future_occurrences(s, as_of, horizon_end):

            recurring_by_account[s.account_id][(occurrence.year, occurrence.month)][direction_key] += s.typical_amount

            upcoming.append({
                "due_date": occurrence,
                "account_id": s.account_id,
                "merchant": s.merchant,
                "amount": s.typical_amount,
                "direction": s.direction,
            })

    upcoming.sort(key=lambda u: (u["due_date"], u["merchant"]))

    accounts_out = []

    for account_id, (opening_balance, _as_of_date) in balances.items():

        daily_rate = run_rates.get(account_id, Decimal("0"))
        running_balance = opening_balance
        months_out = []

        for year, month, is_partial in periods:

            start, end = period_bounds[(year, month)]
            days_in_bucket = (end - as_of).days if is_partial else (end - start).days

            recurring_in = recurring_by_account[account_id][(year, month)]["in"]
            recurring_out = recurring_by_account[account_id][(year, month)]["out"]
            estimated_other = (daily_rate * days_in_bucket).quantize(Decimal("0.01"))

            opening = running_balance
            closing = opening + recurring_in - recurring_out + estimated_other

            months_out.append({
                "label": f"{year:04d}-{month:02d}",
                "is_partial": is_partial,
                "opening": opening,
                "recurring_in": recurring_in,
                "recurring_out": recurring_out,
                "estimated_other": estimated_other,
                "closing": closing,
            })

            running_balance = closing

        accounts_out.append({
            "account_id": account_id,
            "account_name": account_names.get(account_id),
            "opening_balance": opening_balance,
            "daily_run_rate": daily_rate.quantize(Decimal("0.01")),
            "months": months_out,
        })

    combined = None

    if accounts_out:
        combined_opening = sum((a["opening_balance"] for a in accounts_out), Decimal("0"))
        combined_months = [
            {
                "label": periods_out["label"],
                "is_partial": periods_out["is_partial"],
                "opening": sum((a["months"][i]["opening"] for a in accounts_out), Decimal("0")),
                "recurring_in": sum((a["months"][i]["recurring_in"] for a in accounts_out), Decimal("0")),
                "recurring_out": sum((a["months"][i]["recurring_out"] for a in accounts_out), Decimal("0")),
                "estimated_other": sum((a["months"][i]["estimated_other"] for a in accounts_out), Decimal("0")),
                "closing": sum((a["months"][i]["closing"] for a in accounts_out), Decimal("0")),
            }
            for i, periods_out in enumerate(accounts_out[0]["months"])
        ]
        combined = {"opening_balance": combined_opening, "months": combined_months}

    return {
        "as_of": as_of,
        "periods": [
            {"year": year, "month": month, "label": f"{year:04d}-{month:02d}", "is_partial": is_partial}
            for year, month, is_partial in periods
        ],
        "accounts": accounts_out,
        "combined": combined,
        "upcoming": upcoming,
    }
