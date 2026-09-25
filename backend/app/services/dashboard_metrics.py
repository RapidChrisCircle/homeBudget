"""KPI tiles and day-granularity activity for the dashboard's widget
families (StatTile, TransactionCalendar, ComparisonSparkline) - see
frontend/src/components/widgets/.

Two genuinely different shapes, for two different questions:

- dashboard_kpis() answers "how are we doing over N months" - a handful of
  headline totals and averages. Built on TOP of reporting.category_grid()
  and trends.monthly_summaries() for its income/expense totals, the same
  "derive, don't re-aggregate" rule trends.py itself follows for exactly
  the same reason: a second independent income/expense query would
  eventually disagree with /trends after some future edit to one but not
  the other. transaction_count needs one further query these two can't
  provide - neither is grouped by TRANSACTION, only by category/period -
  scoped to expense allocations specifically (the same "budget vs actual
  is expense-only" framing /trends' own budget chart uses), so
  avg_per_transaction answers "how big is a typical expense", pairing with
  avg_per_month's "how much do we spend a month" - both spend-rate
  questions, not a mix of spend and income averaged together, which would
  answer neither.

  savings_rate and runway_months are both ratios and both deliberately
  None (not 0) on a zero denominator - "you saved infinity percent of zero
  income" and "zero months of runway" are both worse answers than "this
  question has no answer yet", the same "no data is not zero" convention
  an account's null balance already follows elsewhere in this app.
  savings_rate = net_saved / total_income, undefined when there was no
  income in the window at all (a household living entirely off savings
  that month has no "rate" to report, not a rate of -infinity%).
  runway_months = liquid_assets() / avg_per_month - CURRENT liquid assets
  (Everyday + Savings balances, services.net_worth.liquid_assets) against
  this WINDOW's own average monthly spend, undefined when the window had
  no expenses to divide by. Answers "at this spend rate, how long would
  today's cash last", not a projection - services/forecast.py already
  owns actual month-by-month projection and this doesn't attempt to
  duplicate it.

- daily_activity() answers "what happened on which days" - a new query at
  a granularity no existing service provides (everything else in
  reporting/trends stops at month). Built the same way category_grid()
  itself is: through allocation_subquery so a split transaction's pieces
  count on the day they belong to, and excluding transfers (kind ==
  "transfer") for the same reason every report does - a transfer between
  the user's own accounts is not activity, it would double up on both
  sides otherwise. Deliberately does NOT separately exclude uncategorized
  transactions - allocation_subquery already omits them by construction
  (an allocation with no category contributes no row, per its own
  docstring) - which matches the Dashboard's own existing Cash Flow chart,
  itself sourced from category_grid/monthly_summaries: both already only
  ever reflect CATEGORIZED activity, so a day's total_in/total_out here
  summed across a month agrees with that month's total_income/
  total_spending from /trends. A day with zero matching activity produces
  no row at all - sparse, like category_grid's own "worth showing" rows -
  since a 0-row day is not itself informative and every caller (a
  calendar, a sparkline) already treats a missing day as zero.

total_in/total_out are both POSITIVE magnitudes (mirroring reporting.py's
own presentation-signing: "expense category -> actual = -net, a positive
'spent' figure") - a caller renders both through <Amount neutral> directly,
never re-deriving a sign.
"""

from datetime import date
from decimal import Decimal

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from ..models import Category
from .allocations import allocation_subquery
from .net_worth import liquid_assets
from .reporting import category_grid, month_bounds
from .trends import monthly_summaries


def dashboard_kpis(db: Session, year: int, month: int, months: int) -> dict:
    """{periods, total_income, total_expenses, net_saved, transaction_count,
    avg_per_month, avg_per_transaction, savings_rate, runway_months} for
    the `months` months ending at (year, month) inclusive - see module
    docstring for what each figure means and why avg_per_transaction,
    savings_rate and runway_months are each None (not zero) on the
    particular zero denominator that makes them undefined rather than
    computing a nonsensical answer.
    """

    periods, grid_rows = category_grid(db, year, month, months=months)
    summaries = monthly_summaries(periods, grid_rows)

    total_income = sum((s["total_income"] for s in summaries), Decimal("0"))
    total_expenses = sum((s["total_spending"] for s in summaries), Decimal("0"))

    window_start, _ = month_bounds(*periods[0])
    _, window_end = month_bounds(*periods[-1])

    alloc = allocation_subquery(db)

    transaction_count = (
        db.query(func.count(func.distinct(alloc.c.transaction_id)))
        .join(Category, alloc.c.category_id == Category.id)
        .filter(
            Category.kind == "expense",
            alloc.c.transaction_date >= window_start,
            alloc.c.transaction_date < window_end,
        )
        .scalar()
    ) or 0

    net_saved = total_income - total_expenses
    avg_per_month = total_expenses / len(periods)

    return {
        "periods": periods,
        "total_income": total_income,
        "total_expenses": total_expenses,
        "net_saved": net_saved,
        "transaction_count": transaction_count,
        "avg_per_month": avg_per_month,
        "avg_per_transaction": (total_expenses / transaction_count) if transaction_count else None,
        "savings_rate": (net_saved / total_income) if total_income else None,
        "runway_months": (liquid_assets(db) / avg_per_month) if avg_per_month else None,
    }


def daily_activity(db: Session, start: date, end: date) -> list[dict]:
    """[{date, total_in, total_out, count}] for every day in [start, end)
    with at least one matching allocation - see module docstring for the
    transfer/uncategorized handling and the sign convention.

    total_in/total_out are built with `case()`, not func.greatest/least -
    those compile to genuinely different (and on SQLite, nonexistent as a
    2+-arg scalar) functions per dialect, the same class of trap the
    reporting.py module docstring already warns about for month grouping;
    `case()` compiles to portable CASE WHEN on both.

    count is COUNT(DISTINCT transaction_id), the same idiom
    api/categories.py's category_usage() already uses - a split
    transaction's several allocations must count as the one transaction
    they belong to, not several, or a split grocery run would inflate a
    day's "how many transactions" figure relative to an unsplit one of the
    same size.
    """

    alloc = allocation_subquery(db)

    total_in_expr = func.sum(case((alloc.c.amount > 0, alloc.c.amount), else_=0)).label("total_in")
    total_out_expr = func.sum(case((alloc.c.amount < 0, -alloc.c.amount), else_=0)).label("total_out")
    count_expr = func.count(func.distinct(alloc.c.transaction_id)).label("count")

    rows = (
        db.query(alloc.c.transaction_date, total_in_expr, total_out_expr, count_expr)
        .join(Category, alloc.c.category_id == Category.id)
        .filter(
            Category.kind != "transfer",
            alloc.c.transaction_date >= start,
            alloc.c.transaction_date < end,
        )
        .group_by(alloc.c.transaction_date)
        .order_by(alloc.c.transaction_date)
        .all()
    )

    return [
        {
            "date": row.transaction_date,
            "total_in": Decimal(row.total_in or 0),
            "total_out": Decimal(row.total_out or 0),
            "count": row.count,
        }
        for row in rows
    ]
