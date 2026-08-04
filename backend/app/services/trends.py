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

from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import Transaction
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


def combined_balance_history(
    db: Session, periods: list[tuple[int, int]]
) -> dict[tuple[int, int], Decimal | None]:
    """{period: combined balance | None} - every account's own
    account_balance_history() summed together per period, for the
    Dashboard's net-balance chart. Same straight-sum convention the
    Dashboard's "Combined balance" figure already uses for TODAY
    (DashboardPage.jsx's own tooltip: "a straight sum of each account's
    latest bank balance... not net worth"), extended across a window.

    An account with no history yet AT a given period (None - before its
    first-ever transaction) contributes 0 to that period's sum, not a gap -
    it hasn't been opened, matching how DashboardPage already excludes a
    None-balance account from its own current combined figure rather than
    treating the whole total as unknown. The one real gap is a period
    where EVERY account is still None - the whole ledger has no history
    that far back - which stays None so LineChart breaks the line instead
    of drawing a false $0.
    """

    by_account = account_balance_history(db, periods)

    combined: dict[tuple[int, int], Decimal | None] = {}

    for period in periods:
        known = [history[period] for history in by_account.values() if history[period] is not None]
        combined[period] = sum(known, Decimal("0")) if known else None

    return combined

    return history
