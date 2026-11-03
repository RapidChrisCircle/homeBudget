"""Multi-month trend data for the /trends page and each account's balance
history chart.

Deliberately built ON TOP of reporting.category_grid() rather than issuing
independent queries for monthly income/spending/net. /reports already
computes those three numbers for a single month via reporting.monthly_summary
- a second, independent multi-month query would eventually disagree with it
after some future edit to one but not the other. Deriving both from the same
grid rows makes that kind of drift structurally impossible; a test asserts
monthly_summaries() agrees with reporting.monthly_summary() for the same
month.

budget_totals() scopes BOTH its budgeted and actual figures to expense
categories that have a budget in that specific period - not every expense
category, and not "budgeted anywhere in the window". This answers "are we
tracking to the budgets we've actually set", not "how does total spending
compare to total budgeted" - the latter would always show "way over" the
moment any spending exists in an unbudgeted category, which isn't a
meaningful signal. Since a budget can now be overridden per month (see
services.budgets), `budgeted` is genuinely PER-PERIOD, not one figure
repeated across the window - an override in one month steps the chart's
budgeted line for that month only, and a category that only has a budget in
some periods contributes to "actual" only in those same periods.

account_balance_history() is the one genuinely new query here. It reuses the
window-function "latest row per group" pattern from
ledger._latest_balance_subquery - partitioned by (account_id, year, month)
here instead of just account_id, ordered by (transaction_date DESC, id DESC)
for the same reason: an account's closing balance for a month must come from
that month's LATEST transaction by date, not by id, or a later-imported old
statement would corrupt it. Two semantics that must hold and are tested:

- A month with no transactions carries the PREVIOUS month's balance forward.
  The money didn't move - it is not zero and not a gap.
- Months before an account's first-ever transaction are None, not 0.00 -
  the same "no data yet" distinction AccountResponse.balance already makes.

_year_month_columns is imported from reporting.py rather than reimplemented -
the dialect-agnostic (year, month) extraction must be identical everywhere
it's used, the same reasoning categorization._row_amount is imported as-is
into recurring.py rather than re-derived.
"""

from collections import defaultdict
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import Category, MerchantNickname, Transaction
from .allocations import allocation_subquery
from .narration import merchant_label, narration_key, resolve_merchant_nickname
from .reporting import _year_month_columns, month_bounds


def monthly_summaries(periods: list[tuple[int, int]], grid_rows: list[dict]) -> list[dict]:
    """[{period, total_income, total_spending, net_saved}] for each period,
    derived from category_grid()'s rows - see module docstring for why this
    is not a second query.
    """

    summaries = []

    for period in periods:

        total_income = Decimal("0")
        total_spending = Decimal("0")

        for row in grid_rows:

            value = row["amounts"][period]

            if row["kind"] == "expense":
                total_spending += value
            elif row["kind"] == "income":
                total_income += value

        summaries.append({
            "period": period,
            "total_income": total_income,
            "total_spending": total_spending,
            "net_saved": total_income - total_spending,
        })

    return summaries


def budget_totals(periods: list[tuple[int, int]], grid_rows: list[dict]) -> list[dict]:
    """[{period, budgeted, actual}] for each period - see module docstring
    for why unbudgeted spending is excluded from both sides, and why this is
    resolved independently per period rather than one figure repeated across
    the window.
    """

    expense_rows = [row for row in grid_rows if row["kind"] == "expense"]

    totals = []

    for period in periods:

        budgeted_amount = Decimal("0")
        actual = Decimal("0")

        for row in expense_rows:

            budget = row["budgets"][period]

            if budget is None:
                continue

            budgeted_amount += budget
            actual += row["amounts"][period]

        totals.append({"period": period, "budgeted": budgeted_amount, "actual": actual})

    return totals


def top_movers(periods: list[tuple[int, int]], grid_rows: list[dict], limit: int = 3) -> list[dict]:
    """The `limit` categories with the largest month-over-month change
    between the LAST TWO periods in `periods` (prior, then current) -
    ranked by |delta|, for the Dashboard's narrative block (T4.2). Derived
    from category_grid()'s rows, the same "no second query" reasoning as
    monthly_summaries()/budget_totals() above.

    Fewer than two periods returns [] rather than comparing a period
    against itself, which would report every category with any activity at
    all as a nonsensical +100% "swing" - the caller (build_monthly_report,
    called with months=2) always provides two, but this stays honest for
    any other caller.

    Both expense and income rows are eligible - a big swing either way is
    worth surfacing - so `kind` rides along with each mover, letting the
    caller phrase it correctly ("spent more on" vs "earned less from"). A
    category with no change between the two periods (delta == 0) is not a
    "mover" and is excluded, even if it would otherwise rank in the top
    `limit` - three categories that didn't move is not three movers.
    """

    if len(periods) < 2:
        return []

    prior_period, current_period = periods[-2], periods[-1]

    movers = []

    for row in grid_rows:

        current = row["amounts"][current_period]
        prior = row["amounts"][prior_period]
        delta = current - prior

        if delta == 0:
            continue

        movers.append({
            "category_id": row["category_id"],
            "category_name": row["category_name"],
            # So the narrative can name it "Parent › Child" like every
            # other place a category stands as a row of its own - two
            # leaves can share a bare name ("Home › Maintenance" vs
            # "Car › Maintenance").
            "parent_name": row.get("parent_name"),
            "kind": row["kind"],
            "current": current,
            "prior": prior,
            "delta": delta,
        })

    movers.sort(key=lambda mover: abs(mover["delta"]), reverse=True)

    return movers[:limit]


def account_balance_history(
    db: Session, periods: list[tuple[int, int]]
) -> dict[int, dict[tuple[int, int], Decimal | None]]:
    """{account_id: {period: balance | None}} for every account, across the
    given (contiguous) periods. One window-function query for every account
    at once, not N queries - the same principle ledger.account_balances()
    already established for "current" balances, extended here to a whole
    history.
    """

    if not periods:
        return {}

    _, window_end = month_bounds(*periods[-1])

    year_col, month_col = _year_month_columns()

    row_number = func.row_number().over(
        partition_by=(Transaction.account_id, year_col, month_col),
        order_by=[Transaction.transaction_date.desc(), Transaction.id.desc()],
    ).label("rn")

    # No lower bound on transaction_date - history from before the window
    # is exactly what lets the window's FIRST period carry forward correctly
    # when that period itself has no transactions.
    sub = (
        db.query(
            Transaction.account_id.label("account_id"),
            Transaction.balance.label("balance"),
            year_col.label("year"),
            month_col.label("month"),
            row_number,
        )
        .filter(
            Transaction.account_id.isnot(None),
            Transaction.transaction_date < window_end,
        )
        .subquery()
    )

    closing_rows = (
        db.query(sub.c.account_id, sub.c.year, sub.c.month, sub.c.balance)
        .filter(sub.c.rn == 1)
        .all()
    )

    by_account: dict[int, dict[tuple[int, int], Decimal]] = {}

    for row in closing_rows:
        by_account.setdefault(row.account_id, {})[(int(row.year), int(row.month))] = Decimal(row.balance)

    history: dict[int, dict[tuple[int, int], Decimal | None]] = {}

    for account_id, months in by_account.items():

        ordered_months = sorted(months.keys())
        filled: dict[tuple[int, int], Decimal | None] = {}
        running: Decimal | None = None
        cursor = 0

        for period in periods:
            # Advance through every real closing balance up to and including
            # this period, carrying the last one seen into any gap.
            while cursor < len(ordered_months) and ordered_months[cursor] <= period:
                running = months[ordered_months[cursor]]
                cursor += 1
            filled[period] = running

        history[account_id] = filled

    return history


def category_merchants(
    db: Session,
    category: Category,
    periods: list[tuple[int, int]],
) -> list[dict]:
    """Merchant breakdown for a single leaf category across `periods`.

    Uses `allocation_subquery(db)` so split transactions allocated to this
    category are included and the sum across all returned merchants reconciles
    with the category's trend total over the same window. Unlike
    `ledger.transaction_groups()` (which filters out singletons with
    `MIN_GROUP_SIZE = 2`), every merchant in the category is returned so a
    household drilling into e.g. Dining Out & Takeaway can see every place
    money was spent, sorted by total amount spent descending by default.
    """

    if not periods:
        return []

    window_start, _ = month_bounds(*periods[0])
    _, window_end = month_bounds(*periods[-1])

    alloc = allocation_subquery(db)
    rows = (
        db.query(
            alloc.c.transaction_id.label("transaction_id"),
            alloc.c.amount.label("amount"),
            alloc.c.transaction_date.label("transaction_date"),
            Transaction.narration.label("narration"),
        )
        .join(Transaction, Transaction.id == alloc.c.transaction_id)
        .filter(
            alloc.c.category_id == category.id,
            alloc.c.transaction_date >= window_start,
            alloc.c.transaction_date < window_end,
        )
        .order_by(alloc.c.transaction_date.desc(), alloc.c.transaction_id.desc())
        .all()
    )

    buckets: dict[str, list] = defaultdict(list)
    for row in rows:
        key = narration_key(row.narration)
        if not key:
            key = (row.narration or "UNKNOWN").strip().upper() or "UNKNOWN"
        buckets[key].append(row)

    nicknames = {
        row.narration_key: row.nickname
        for row in db.query(MerchantNickname).all()
    }

    merchants = []
    for key, bucket_rows in buckets.items():
        net = sum((Decimal(r.amount) for r in bucket_rows), Decimal("0"))
        amount = -net if category.kind == "expense" else net
        transaction_ids = list(dict.fromkeys(int(r.transaction_id) for r in bucket_rows))
        count = len(transaction_ids)
        average_spend = (amount / Decimal(count)).quantize(Decimal("0.01"))
        dates = [r.transaction_date for r in bucket_rows]
        label = merchant_label(bucket_rows[0].narration) or bucket_rows[0].narration or key
        merchants.append({
            "narration_key": key,
            "merchant": label,
            "nickname": nicknames.get(key) or resolve_merchant_nickname(bucket_rows[0].narration, nicknames),
            "sample_narration": bucket_rows[0].narration,
            "transaction_count": count,
            "total_spent": amount,
            "average_spend": average_spend,
            "first_date": min(dates),
            "last_date": max(dates),
            "transaction_ids": transaction_ids,
        })

    merchants.sort(key=lambda m: (-m["total_spent"], -m["transaction_count"], m["merchant"].lower()))
    return merchants
