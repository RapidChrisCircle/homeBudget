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
  only by the uncategorized review. A SPLIT transaction also has
  category_id NULL by construction (see TransactionSplit's docstring in
  models.py) but is NOT uncategorized - its activity reaches category rows
  through services/allocations.py instead, and uncategorized_summary()
  below excludes split transactions specifically so they are not
  double-counted as "uncategorized" on top of that.
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

Budgets: every "budget_amount" this module hands back is already RESOLVED -
override-for-that-month if one exists, else the category's standing amount,
via services.budgets.effective_budget(). That resolution happens in exactly
one place; this module never reads Category.budget_amount or a
CategoryBudget row and combines them itself, because two independent
combinations would risk disagreeing about which month's override applies.
category_totals_for_period() resolves one month; category_grid() resolves
every period in its window independently, since an override can make one
month's budget differ from the next.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import Integer, and_, cast, extract, func
from sqlalchemy.orm import Session, aliased

from ..models import Category, Transaction
from .allocations import allocation_subquery
from .budgets import effective_budget, overrides_for_period, overrides_for_periods

DEFAULT_GRID_MONTHS = 6
MAX_GRID_MONTHS = 24


@dataclass
class CategoryPeriodTotal:

    category_id: int
    category_name: str
    # The category's parent, or (None, None) for a top-level one. Carried
    # purely so a caller can NAME the category the way /categories itself
    # displays it - "Food > Groceries" rather than a bare "Groceries",
    # which is ambiguous the moment two groups both have a "Fees" or
    # "Insurance" leaf. It never affects any total: parents are grouping
    # only (see Category.parent_id's docstring) and every figure here is
    # still computed per leaf category exactly as before.
    parent_id: int | None
    parent_name: str | None
    kind: str
    budget_amount: Decimal | None
    net: Decimal
    transaction_count: int
    # Carried through purely for display (an "archived" badge) and for
    # budget_lines()'s own presentation-edge filter below - NOT used to
    # exclude anything here. This row exists regardless of archived status;
    # every summary derived from the full totals list (monthly_summary())
    # must keep seeing archived categories with real activity, or
    # total_spending would silently drop real money. See reporting.py's
    # module docstring and Category.archived's own docstring in models.py.
    archived: bool

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


def _year_month_columns(date_column=None):
    """Dialect-agnostic (year, month) grouping columns - see module docstring.

    Defaults to Transaction.transaction_date for callers grouping the
    ledger directly (available_periods below); category_grid() passes the
    allocation subquery's own transaction_date column instead, since it
    groups allocations, not transactions.
    """

    if date_column is None:
        date_column = Transaction.transaction_date

    year_col = cast(extract("year", date_column), Integer).label("year")
    month_col = cast(extract("month", date_column), Integer).label("month")
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
    count(alloc.c.transaction_id) rather than count(*) so outer-joined rows
    with no matching allocation count 0, not 1. alloc is
    services.allocations.allocation_subquery() - a (transaction_id,
    category_id, amount, transaction_date) view standing in for Transaction
    here specifically so a split transaction's allocations count too, not
    just unsplit ones.

    start must be the first day of a calendar month. budget_amount below is
    resolved (override-if-present-else-standing) for the ONE month start
    falls in - a range that isn't month-aligned would silently resolve
    against the wrong month's override, so this raises instead of guessing.
    Every current caller already passes month_bounds() output.
    """

    if start.day != 1:
        raise ValueError(f"category_totals_for_period requires a month-aligned start date, got {start!r}")

    overrides = overrides_for_period(db, start.year, start.month)
    alloc = allocation_subquery(db)
    parent = aliased(Category)

    rows = (
        db.query(
            Category.id,
            Category.name,
            Category.kind,
            Category.budget_amount,
            Category.archived,
            Category.parent_id,
            parent.name.label("parent_name"),
            func.coalesce(func.sum(alloc.c.amount), 0).label("net"),
            func.count(alloc.c.transaction_id).label("transaction_count"),
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
            Category.id, Category.name, Category.kind, Category.budget_amount, Category.archived,
            Category.parent_id, parent.name,
        )
        .order_by(Category.name)
        .all()
    )

    return [
        CategoryPeriodTotal(
            category_id=row.id,
            category_name=row.name,
            parent_id=row.parent_id,
            parent_name=row.parent_name,
            kind=row.kind,
            budget_amount=effective_budget(row.budget_amount, overrides.get(row.id)),
            net=Decimal(row.net),
            transaction_count=row.transaction_count,
            archived=row.archived,
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

    An ARCHIVED category with NO activity this month is dropped regardless
    of whether it still carries a budget_amount - this is the case
    archiving exists for (a preset's ~35 budgeted-but-never-used
    categories being exactly the clutter the Unused card targets), and
    it's a presentation choice, not a rewrite of history: an archived
    category with real activity this month (transaction_count > 0) is
    UNCHANGED by this line and still shows, budget or no budget - only the
    OR-condition just above ever decides that, this filter never overrides
    it. See PresentationEdge notes in Category.archived's docstring
    (models.py) and this module's own docstring before moving either
    filter into SQL.
    """

    return [
        t for t in totals
        if t.kind == "expense"
        and (t.budget_amount is not None or t.transaction_count > 0)
        and not (t.archived and t.transaction_count == 0)
    ]


def _shift_month(year: int, month: int, offset: int) -> tuple[int, int]:

    zero_based = (year * 12 + (month - 1)) + offset
    return zero_based // 12, zero_based % 12 + 1


def contiguous_periods(year: int, month: int, months: int) -> list[tuple[int, int]]:
    """The `months` (year, month) periods ending at (year, month) inclusive,
    oldest first. Pulled out of category_grid() as its own function because
    trends.account_balance_history() needs the identical contiguous-window
    list without needing category data - two independent implementations of
    "walk back N months" would risk misaligning against each other.
    """

    return [_shift_month(year, month, -offset) for offset in range(months - 1, -1, -1)]


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

    Outer-joined, mirroring category_totals_for_period()'s documented reason:
    a budgeted category with zero activity across the ENTIRE window must
    still be reachable, not silently dropped - an inner join would drop it,
    which would understate a "total budgeted" figure derived from these rows
    (see trends.budget_totals()). But unlike category_totals_for_period,
    which returns literally every non-transfer category for a single month,
    a grid spans many months, so an unbudgeted category that has never once
    been used across the WHOLE window is still omitted - showing every
    category ever created, most of them all-zero, would bury the ones with
    real activity. "Worth showing" here is: budgeted (in ANY period of the
    window), or used at least once somewhere in the window. Each row's own
    kind decides which case applies - budget_amount is only ever non-null on
    an expense category (enforced in api/categories.py), so this reduces to
    "has activity" for income rows.

    Each row's "budgets" is {period: resolved amount | None} - one figure
    PER PERIOD, not one figure repeated across the whole window, since an
    override can make one month's budget differ from the next.

    An ARCHIVED category is additionally dropped when it has NO activity
    ANYWHERE in the whole window (has_activity below), same rule as
    category_totals_for_period's budget_lines() filter, extended to a
    multi-month window: an archived category with real activity in even
    one period of the window still shows. This can never change monthly_
    summaries()/budget_totals() in services/trends.py, which sum straight
    from these rows: a row with has_activity == False has amounts[period]
    == 0 for EVERY period in the window by construction just below (the
    `amounts.get(p, Decimal("0"))` fill), so removing it adds zero to
    every period's sum - the equivalence a dedicated test asserts.
    """

    periods = contiguous_periods(year, month, months)
    window_start, _ = month_bounds(*periods[0])
    _, window_end = month_bounds(*periods[-1])

    alloc = allocation_subquery(db)
    year_col, month_col = _year_month_columns(alloc.c.transaction_date)
    parent = aliased(Category)

    rows = (
        db.query(
            Category.id,
            Category.name,
            Category.kind,
            Category.budget_amount,
            Category.archived,
            Category.parent_id,
            parent.name.label("parent_name"),
            year_col,
            month_col,
            func.coalesce(func.sum(alloc.c.amount), 0).label("net"),
        )
        .select_from(Category)
        .outerjoin(
            alloc,
            and_(
                alloc.c.category_id == Category.id,
                alloc.c.transaction_date >= window_start,
                alloc.c.transaction_date < window_end,
            ),
        )
        .outerjoin(parent, Category.parent_id == parent.id)
        .filter(Category.kind != "transfer")
        .group_by(
            Category.id, Category.name, Category.kind, Category.budget_amount, Category.archived,
            Category.parent_id, parent.name, year_col, month_col,
        )
        .all()
    )

    overrides = overrides_for_periods(db, periods)

    by_category: dict[int, dict] = {}

    for row in rows:

        entry = by_category.setdefault(row.id, {
            "category_id": row.id,
            "category_name": row.name,
            # Grouping only, same as CategoryPeriodTotal's own parent
            # fields - carried so /trends can roll leaves up into their
            # group for its top-level chart and drill INTO a group from
            # there, without a second query for the category tree.
            "parent_id": row.parent_id,
            "parent_name": row.parent_name,
            "kind": row.kind,
            "archived": row.archived,
            "_standing": row.budget_amount,
            "amounts": {},
        })

        # An outer-joined category with no matching transaction anywhere in
        # the window still produces exactly one row, with year/month NULL -
        # there is no real period to record here, so skip it. The zero-fill
        # below covers every period in `periods` regardless.
        if row.year is None:
            continue

        net = Decimal(row.net)
        actual = -net if row.kind == "expense" else net
        entry["amounts"][(int(row.year), int(row.month))] = actual

    grid_rows = []

    for entry in by_category.values():

        amounts = entry.pop("amounts")
        has_activity = len(amounts) > 0
        standing = entry.pop("_standing")

        budgets = {
            period: effective_budget(standing, overrides.get((entry["category_id"], period)))
            for period in periods
        }
        has_budget = any(amount is not None for amount in budgets.values())

        if not has_activity and (not has_budget or entry["archived"]):
            continue

        entry["amounts"] = {p: amounts.get(p, Decimal("0")) for p in periods}
        entry["budgets"] = budgets
        entry["total"] = sum(entry["amounts"].values(), Decimal("0"))
        grid_rows.append(entry)

    grid_rows.sort(key=lambda r: r["category_name"])

    return periods, grid_rows


def uncategorized_summary(db: Session, start: date, end: date) -> dict:
    """Coverage of the categorized numbers above: how many transactions in
    this period have no category, and what they total (split by direction -
    a single net figure is close to meaningless when it mixes a salary and
    a grocery run).

    A SPLIT transaction also has category_id NULL (see TransactionSplit's
    docstring in models.py) but is not uncategorized - it is excluded here
    via ~Transaction.splits.any() so it is not double-counted as both
    "categorized via its splits" (in the totals above, through
    services/allocations.py) and "uncategorized" (here). An allocation
    within a split that itself has no category is a real gap, same as an
    uncategorized whole transaction, but tracking that partial case is out
    of scope for now - it simply doesn't reach a category row, same as
    before splits existed.
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
            ~Transaction.splits.any(),
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
