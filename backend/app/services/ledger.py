"""Ledger filtering, search, pagination, and account balances.

Filter semantics, in one place so the API and any future caller agree:

- account_id / category_id are exact matches.
- uncategorized=True means `category_id IS NULL` and takes precedence over
  category_id - the API layer rejects the two being combined rather than
  silently picking a winner, since "this category" and "no category" are
  contradictory requests.
- date_from/date_to are INCLUSIVE on both ends (`>= from AND <= to`). This is
  deliberately different from reporting.month_bounds()'s half-open
  [start, end): half-open is right for internal month arithmetic, but a user
  filtering "1 July to 31 July" means both days included. Do not "fix" one to
  match the other - they serve different callers.
- search is a case-insensitive narration "contains", matching the semantics
  categorization.py uses for rule matching. It is pushed into SQL here (unlike
  categorization, which has to run in Python because import matches rows not
  yet in the database), so it must escape LIKE wildcards - a user searching
  for a literal "50%" must not match every row. func.lower(...).contains(...,
  autoescape=True) is what makes % and _ literal instead of wildcards.
- transaction_type is a case-insensitive exact match, mirroring
  categorization.criteria_match's type comparison.
- min_amount/max_amount are entered as POSITIVE dollars and compared against
  the ABSOLUTE value of whichever of debit/credit is populated - the same
  convention categorization._row_amount uses for rules. This duplicates that
  logic as a SQL expression rather than sharing it, because _row_amount runs
  in Python against an ORM instance and this runs in SQL against a query;
  they cannot be merged, so a test asserts they agree on a boundary value.

Ordering is always transaction_date DESC, id DESC - already deterministic
before pagination existed, which is exactly what pagination needs: a
non-deterministic sort would silently duplicate or drop rows across pages
whenever transaction_date ties exist (imports routinely produce same-day
batches).

Account balances come from the bank's own running `balance` column on the
most recent transaction per account - never summed from debits/credits, since
there is no captured opening balance and a sum would give net change, not a
balance. "Most recent" means highest transaction_date, not highest id: an
account whose newest-id row is actually an older, later-imported statement
must not win. The window function's ORDER BY is transaction_date DESC,
id DESC for exactly this reason. An account with no transactions has no
balance - None, not 0.00, since zero is a real balance and the two must
render differently.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Query, Session, joinedload

from ..models import Transaction

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200

# TransactionResponse serializes account_name and category_name, which are
# plain Python properties reading through the lazy `account` / `category`
# relationships - so without these, serializing a page emits one extra query
# per DISTINCT account and category on it (the identity map dedupes the rest).
# Measured on a 50-row page with 50 distinct categories: 53 queries without,
# 2 with. Passed to paginate() rather than baked into build_transaction_query()
# so the COUNT stays join-free: these joins cannot change the count (both
# relationships are many-to-one), but the count has no reason to pay for them.
LIST_LOADERS = (joinedload(Transaction.account), joinedload(Transaction.category))

# Mirrors categorization._row_amount's positive-dollar/absolute-value
# convention, expressed as a SQL expression instead of a Python function.
_AMOUNT_EXPR = func.abs(func.coalesce(Transaction.debit, 0) + func.coalesce(Transaction.credit, 0))


@dataclass
class TransactionFilters:

    account_id: int | None = None
    category_id: int | None = None
    uncategorized: bool = False
    date_from: date | None = None
    date_to: date | None = None
    search: str | None = None
    transaction_type: str | None = None
    min_amount: Decimal | None = None
    max_amount: Decimal | None = None


def build_transaction_query(db: Session, filters: TransactionFilters) -> Query:

    query = db.query(Transaction)

    if filters.account_id is not None:
        query = query.filter(Transaction.account_id == filters.account_id)

    if filters.uncategorized:
        query = query.filter(Transaction.category_id.is_(None))
    elif filters.category_id is not None:
        query = query.filter(Transaction.category_id == filters.category_id)

    if filters.date_from is not None:
        query = query.filter(Transaction.transaction_date >= filters.date_from)

    if filters.date_to is not None:
        query = query.filter(Transaction.transaction_date <= filters.date_to)

    if filters.search and filters.search.strip():
        term = filters.search.strip().lower()
        query = query.filter(func.lower(Transaction.narration).contains(term, autoescape=True))

    if filters.transaction_type and filters.transaction_type.strip():
        query = query.filter(func.upper(Transaction.transaction_type) == filters.transaction_type.strip().upper())

    if filters.min_amount is not None:
        query = query.filter(_AMOUNT_EXPR >= filters.min_amount)

    if filters.max_amount is not None:
        query = query.filter(_AMOUNT_EXPR <= filters.max_amount)

    return query.order_by(Transaction.transaction_date.desc(), Transaction.id.desc())


def paginate(query: Query, page: int, page_size: int, options=()) -> tuple[list[Transaction], int]:
    """(items, total) for one page. `options` are loader options applied only
    to the item fetch - see LIST_LOADERS for why the count is left bare.
    """

    total = query.order_by(None).count()

    items = (
        query.options(*options)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return items, total


def _latest_balance_subquery(db: Session, account_id: int | None = None):
    """One row per (account_id, transaction) with a row_number ranking each
    account's transactions newest-first by (transaction_date, id) - rn == 1
    is that account's current balance. Filtering to a single account_id
    before the window function (rather than computing for every account and
    discarding the rest) keeps the single-account lookup cheap.
    """

    row_number = func.row_number().over(
        partition_by=Transaction.account_id,
        order_by=[Transaction.transaction_date.desc(), Transaction.id.desc()],
    ).label("rn")

    query = (
        db.query(
            Transaction.account_id,
            Transaction.balance,
            Transaction.transaction_date,
            row_number,
        )
        .filter(Transaction.account_id.isnot(None))
    )

    if account_id is not None:
        query = query.filter(Transaction.account_id == account_id)

    return query.subquery()


def account_balances(db: Session) -> dict[int, tuple[Decimal, date]]:
    """{account_id: (balance, as_of_date)} for every account with at least one
    transaction. One window-function query for the whole Accounts list - not
    N queries, and not a Python loop over accounts.
    """

    sub = _latest_balance_subquery(db)

    rows = (
        db.query(sub.c.account_id, sub.c.balance, sub.c.transaction_date)
        .filter(sub.c.rn == 1)
        .all()
    )

    return {row.account_id: (Decimal(row.balance), row.transaction_date) for row in rows}


def account_balance(db: Session, account_id: int) -> tuple[Decimal | None, date | None]:
    """(balance, as_of_date) for one account, or (None, None) if it has no
    transactions yet.
    """

    sub = _latest_balance_subquery(db, account_id=account_id)

    row = (
        db.query(sub.c.balance, sub.c.transaction_date)
        .filter(sub.c.rn == 1)
        .first()
    )

    if row is None:
        return None, None

    return Decimal(row.balance), row.transaction_date
