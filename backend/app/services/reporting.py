"""Monthly budget and spending reports.

Sign handling, in one place so every report agrees:

- Debits are stored NEGATIVE, credits POSITIVE, exactly one populated per row
  (enforced at import). The single source of truth for a category's activity
  in a period is the signed net:

      net = SUM(COALESCE(debit, 0) + COALESCE(credit, 0))

  A -98.00 debit plus a +50.00 refund nets to -48.00, so refunds correctly
  reduce spending rather than reading as income. Never SUM(ABS(...)) or
  SUM(debit) alone - both would hide refunds.

- Presentation is applied at the edge of this module, never in SQL:
    expense category -> actual = -net   (a positive "spent" figure)
    income  category -> actual = +net   (a positive "received" figure)
  total_spending = -(sum of net over expense categories)
  total_income   = +(sum of net over income categories)
  net_saved      = total_income - total_spending

  An expense category with more refunds than spending in a month nets
  positive, giving a NEGATIVE "spent" figure. This is deliberate - do not
  clamp to zero. Clamping would break reconciliation: total_spending would
  stop equalling the sum of the expense rows, and the summary would silently
  disagree with the budget table sitting right above it. The frontend marks
  these with a "net refund" tooltip instead.

Exclusions, applied to every money query:
- Transaction.category_id IS NULL -> excluded from category rows, counted
  only by the uncategorized review.
- Category.kind == "transfer" -> excluded from every report section. This is
  how money moving between the user's own accounts stops inflating both
  income and spending.

Month boundaries are half-open [start, end): filters are always
`transaction_date >= start AND transaction_date < end`, never `<= last_day`.
December rolls to next January.

Cross-dialect month grouping: func.date_trunc is Postgres-only, func.strftime
is SQLite-only - either choice passes CI (SQLite) and breaks the other
environment (Postgres), the same trap the delete_category comment warns
about for FK cascades. sqlalchemy.extract is dialect-aware (compiles to
STRFTIME on SQLite, native EXTRACT on Postgres) and works on both. The
outer cast to Integer is load-bearing, not decoration: Postgres 14+ EXTRACT
returns numeric -> Decimal via psycopg, while SQLite returns int. Without the
cast, pivot dictionary keys would be Decimal in production and int under
test - a divergence no SQLite test can catch.

Aggregation happens in SQL (GROUP BY), not Python. Unlike categorization
(which has to run in Python because import matches rows not yet in the
database), reporting has no such constraint, and this scans the whole
ledger. category_totals_for_period() is queried once and reused to derive
both the summary and the budget table - two separate aggregate queries would
be two chances for those two views to disagree.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import Integer, and_, cast, extract, func
from sqlalchemy.orm import Session

from ..models import Category, Transaction

DEFAULT_GRID_MONTHS = 6
MAX_GRID_MONTHS = 24

# The one signed aggregate every report derives from.
_NET_EXPR = func.coalesce(Transaction.debit, 0) + func.coalesce(Transaction.credit, 0)


@dataclass
class CategoryPeriodTotal:

    category_id: int
    category_name: str
    kind: str
    budget_amount: Decimal | None
    net: Decimal
    transaction_count: int

    @property
    def actual(self) -> Decimal:
        """Presentation-signed: positive = spent (expense) or received (income)."""

        return -self.net if self.kind == "expense" else self.net

    @property
    def difference(self) -> Decimal | None:
        """budget - actual. Positive = under budget, negative = over."""

        if self.budget_amount is None:
            return None

        return self.budget_amount - self.actual


def month_bounds(year: int, month: int) -> tuple[date, date]:

    start = date(year, month, 1)

    if month == 12:
        end = date(year + 1, 1, 1)
    else:
        end = date(year, month + 1, 1)

    return start, end


def _year_month_columns():
    """Dialect-agnostic (year, month) grouping columns - see module docstring."""

    year_col = cast(extract("year", Transaction.transaction_date), Integer).label("year")
    month_col = cast(extract("month", Transaction.transaction_date), Integer).label("month")
    return year_col, month_col


def available_periods(db: Session) -> list[tuple[int, int, int]]:
    """(year, month, transaction_count) for every month with ANY transactions
    (regardless of category or kind), newest first.

    Deliberately unfiltered: a month whose only rows are uncategorized is
    exactly the month the user most needs to look at, and it must not be
    hidden from the selector.
    """

    year_col, month_col = _year_month_columns()

    rows = (
        db.query(year_col, month_col, func.count(Transaction.id))
        .group_by(year_col, month_col)
        .order_by(year_col.desc(), month_col.desc())
        .all()
    )

    return [(int(year), int(month), count) for year, month, count in rows]


def default_period(db: Session) -> tuple[int, int]:
    """Most recent month with transactions, falling back to the current month
    on an empty ledger.

    This is an import-driven app: the user opens Reports right after
    importing a statement that is usually a month or two behind, so
    defaulting to the current calendar month would show an empty report on a
    full database - reads as broken. The fallback only matters on a fresh
    install where every choice is equally empty.
    """

    periods = available_periods(db)

    if periods:
        year, month, _ = periods[0]
        return year, month

    today = date.today()
    return today.year, today.month


def category_totals_for_period(db: Session, start: date, end: date) -> list[CategoryPeriodTotal]:
    """Every non-transfer category's activity in [start, end), one row per
    category regardless of whether it had any transactions.

    The date range lives in the JOIN's ON clause, not WHERE: moving it to
    WHERE silently turns the outer join back into an inner join and drops
    every zero-activity category - including budgeted categories the user
    spent nothing in, which are exactly the rows they want to see.
    count(Transaction.id) rather than count(*) so outer-joined rows with no
    matching transaction count 0, not 1.
    """

    rows = (
        db.query(
            Category.id,
            Category.name,
            Category.kind,
            Category.budget_amount,
            func.coalesce(func.sum(_NET_EXPR), 0).label("net"),
            func.count(Transaction.id).label("transaction_count"),
        )
        .select_from(Category)
        .outerjoin(
            Transaction,
            and_(
                Transaction.category_id == Category.id,
                Transaction.transaction_date >= start,
                Transaction.transaction_date < end,
            ),
        )
        .filter(Category.kind != "transfer")
        .group_by(Category.id, Category.name, Category.kind, Category.budget_amount)
        .order_by(Category.name)
        .all()
    )

    return [
        CategoryPeriodTotal(
            category_id=row.id,
            category_name=row.name,
            kind=row.kind,
            budget_amount=row.budget_amount,
            net=Decimal(row.net),
            transaction_count=row.transaction_count,
        )
        for row in rows
    ]


def monthly_summary(totals: list[CategoryPeriodTotal]) -> tuple[Decimal, Decimal, Decimal]:
    """(total_income, total_spending, net_saved), derived from
    category_totals_for_period()'s rows - not a second query - so the summary
    can never disagree with the budget table built from the same rows.
    """

    total_income = sum((t.actual for t in totals if t.kind == "income"), Decimal("0"))
    total_spending = sum((t.actual for t in totals if t.kind == "expense"), Decimal("0"))
    net_saved = total_income - total_spending

    return total_income, total_spending, net_saved


def budget_lines(totals: list[CategoryPeriodTotal]) -> list[CategoryPeriodTotal]:
    """Expense categories worth showing in budget-vs-actual: those with a
    budget set, or with activity this month. Omitting the rest avoids a wall
    of zeros for categories that are neither budgeted nor used.
    """

    return [
        t for t in totals
        if t.kind == "expense" and (t.budget_amount is not None or t.transaction_count > 0)
    ]


def _shift_month(year: int, month: int, offset: int) -> tuple[int, int]:

    zero_based = (year * 12 + (month - 1)) + offset
    return zero_based // 12, zero_based % 12 + 1


def category_grid(
    db: Session,
    year: int,
    month: int,
    months: int = DEFAULT_GRID_MONTHS
) -> tuple[list[tuple[int, int]], list[dict]]:
    """Category x month totals for the `months` months ending at (year, month)
    inclusive. Returns (periods, rows) where periods is the ordered, CONTIGUOUS
    list of (year, month) columns - generated in Python by walking back from
    the selected month, never derived from query results, since a month with
    no transactions anywhere would otherwise silently vanish and misalign the
    grid.
    """

    periods = [_shift_month(year, month, -offset) for offset in range(months - 1, -1, -1)]
    window_start, _ = month_bounds(*periods[0])
    _, window_end = month_bounds(*periods[-1])

    year_col, month_col = _year_month_columns()

    rows = (
        db.query(
            Category.id,
            Category.name,
            Category.kind,
            year_col,
            month_col,
            func.coalesce(func.sum(_NET_EXPR), 0).label("net"),
        )
        .join(Transaction, Transaction.category_id == Category.id)
        .filter(
            Transaction.transaction_date >= window_start,
            Transaction.transaction_date < window_end,
            Category.kind != "transfer",
        )
        .group_by(Category.id, Category.name, Category.kind, year_col, month_col)
        .all()
    )

    by_category: dict[int, dict] = {}

    for row in rows:

        entry = by_category.setdefault(row.id, {
            "category_id": row.id,
            "category_name": row.name,
            "kind": row.kind,
            "amounts": {},
        })

        net = Decimal(row.net)
        actual = -net if row.kind == "expense" else net
        entry["amounts"][(int(row.year), int(row.month))] = actual

    grid_rows = []

    for entry in by_category.values():

        amounts = entry.pop("amounts")
        entry["amounts"] = {p: amounts.get(p, Decimal("0")) for p in periods}
        entry["total"] = sum(amounts.values(), Decimal("0"))
        grid_rows.append(entry)

    grid_rows.sort(key=lambda r: r["category_name"])

    return periods, grid_rows


def uncategorized_summary(db: Session, start: date, end: date) -> dict:
    """Coverage of the categorized numbers above: how many transactions in
    this period have no category, and what they total (split by direction -
    a single net figure is close to meaningless when it mixes a salary and
    a grocery run).
    """

    transaction_count = (
        db.query(func.count(Transaction.id))
        .filter(Transaction.transaction_date >= start, Transaction.transaction_date < end)
        .scalar()
    )

    uncategorized_count, total_out, total_in = (
        db.query(
            func.count(Transaction.id),
            func.coalesce(func.sum(Transaction.debit), 0),
            func.coalesce(func.sum(Transaction.credit), 0),
        )
        .filter(
            Transaction.category_id.is_(None),
            Transaction.transaction_date >= start,
            Transaction.transaction_date < end,
        )
        .one()
    )

    total_out = Decimal(total_out)
    total_in = Decimal(total_in)

    return {
        "transaction_count": transaction_count,
        "uncategorized_count": uncategorized_count,
        "total_out": total_out,
        "total_in": total_in,
        "net_total": total_in + total_out,
    }


def build_monthly_report(
    db: Session,
    year: int | None = None,
    month: int | None = None,
    months: int = DEFAULT_GRID_MONTHS
) -> dict:
    """Everything the /reports/monthly endpoint needs, built from one
    consistent snapshot of the ledger.
    """

    if year is None or month is None:
        year, month = default_period(db)

    start, end = month_bounds(year, month)

    totals = category_totals_for_period(db, start, end)
    total_income, total_spending, net_saved = monthly_summary(totals)
    periods, grid_rows = category_grid(db, year, month, months=months)

    return {
        "year": year,
        "month": month,
        "label": f"{year:04d}-{month:02d}",
        "start_date": start,
        "end_date": end,
        "summary": {
            "total_income": total_income,
            "total_spending": total_spending,
            "net_saved": net_saved,
        },
        "budgets": budget_lines(totals),
        "grid": {
            "periods": periods,
            "rows": grid_rows,
        },
        "uncategorized": uncategorized_summary(db, start, end),
    }
