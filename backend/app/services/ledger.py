"""Ledger filtering, search, pagination, and account balances.

Filter semantics, in one place so the API and any future caller agree:

- account_id / category_id are exact matches. category_id also matches a
  SPLIT transaction that has an allocation for that category (a split
  transaction's own category_id is always NULL - see TransactionSplit's
  docstring in models.py - so a plain equality check alone would silently
  hide split transactions from this filter).
- uncategorized=True means `category_id IS NULL AND no splits` and takes
  precedence over category_id - the API layer rejects the two being
  combined rather than silently picking a winner, since "this category" and
  "no category" are contradictory requests. A split transaction is never
  "uncategorized" even though its own category_id is also NULL - it has an
  allocation (or several), just not a single direct category_id.
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

Ordering defaults to transaction_date DESC, id DESC - already deterministic
before pagination existed, which is exactly what pagination needs: a
non-deterministic sort would silently duplicate or drop rows across pages
whenever transaction_date ties exist (imports routinely produce same-day
batches).

build_transaction_query also accepts an explicit `sort` (one of
SORTABLE_COLUMNS) and `direction` ("asc"/"desc") - the ledger's own
sortable column headers, not client-side sorting, because this query is
PAGINATED: sorting only the rows on one page would silently lie about the
full result. Two rules every sort obeys:

- **`id DESC` is always the final tiebreaker**, whatever the chosen column
  or direction - a user-selectable sort multiplies the chance of ties (a
  whole day of transactions sharing a date, many rows sharing "no
  category") far more than the fixed default ever did, and pagination's
  determinism depends on it exactly as much as it always has.
- **NULLs sort last in both directions** (`.nulls_last()`) - an unset
  account/category is absent, not smallest, the same reasoning that already
  renders a null balance as "No transactions yet" rather than `0.00`.
  "account"/"category" can genuinely be NULL (an unlinked transaction, an
  uncategorized one); "date"/"narration" cannot (both NOT NULL columns) and
  "amount" only in the same theoretical case _AMOUNT_EXPR itself already
  coalesces away.

Sorting by "amount" reuses `_AMOUNT_EXPR` - the exact expression the
min_amount/max_amount FILTER already uses - so sorting and filtering can
never disagree about what "amount" means for a row.

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

from collections import Counter, defaultdict
from dataclasses import dataclass, replace
from datetime import date
from decimal import Decimal

from sqlalchemy import func, or_
from sqlalchemy.orm import Query, Session, joinedload

from ..models import Account, Category, Transaction, TransactionSplit
from .narration import merchant_label, narration_key

DEFAULT_PAGE_SIZE = 10
MAX_PAGE_SIZE = 200

# TransactionResponse serializes account_name and category_name, which are
# plain Python properties reading through the lazy `account` / `category`
# relationships - so without these, serializing a page emits one extra query
# per DISTINCT account and category on it (the identity map dedupes the rest).
# Measured on a 50-row page with 50 distinct categories: 53 queries without,
# 2 with. Passed to paginate() rather than baked into build_transaction_query()
# so the COUNT stays join-free: these joins cannot change the count (both
# relationships are many-to-one), but the count has no reason to pay for them.
# splits (and each split's own category) is the same story, one level
# deeper - TransactionResponse.splits[].category_name needs it.
LIST_LOADERS = (
    joinedload(Transaction.account),
    joinedload(Transaction.category),
    joinedload(Transaction.splits).joinedload(TransactionSplit.category),
)

# Mirrors categorization._row_amount's positive-dollar/absolute-value
# convention, expressed as a SQL expression instead of a Python function.
_AMOUNT_EXPR = func.abs(func.coalesce(Transaction.debit, 0) + func.coalesce(Transaction.credit, 0))

# The ledger's sortable column headers - see build_transaction_query's own
# docstring for the id-tiebreaker and nulls-last rules every one of these
# obeys. "account"/"category" need an explicit join (added only when that
# column is the active sort, not unconditionally - LIST_LOADERS above makes
# the same "don't pay for a join the query doesn't need" call for the count).
SORTABLE_COLUMNS = ("date", "narration", "amount", "account", "category", "balance", "type")

_SORT_EXPRESSIONS = {
    "date": Transaction.transaction_date,
    "narration": func.lower(Transaction.narration),
    "amount": _AMOUNT_EXPR,
    "account": Account.name,
    "category": Category.name,
    "balance": Transaction.balance,
    "type": func.lower(Transaction.transaction_type),
}


@dataclass
class TransactionFilters:

    account_id: int | None = None
    # Mirrors the category_id/uncategorized pattern below: a single form
    # field maps to either account_id or account_group_id, never both - see
    # ledgerFilterParams.js's Account dropdown. account_id takes precedence
    # when both happen to be set, the same way uncategorized wins over
    # category_id.
    account_group_id: int | None = None
    category_id: int | None = None
    uncategorized: bool = False
    date_from: date | None = None
    date_to: date | None = None
    search: str | None = None
    transaction_type: str | None = None
    min_amount: Decimal | None = None
    max_amount: Decimal | None = None


def build_transaction_query(
    db: Session, filters: TransactionFilters, *, sort: str | None = None, direction: str = "asc"
) -> Query:

    query = db.query(Transaction)

    if filters.account_id is not None:
        query = query.filter(Transaction.account_id == filters.account_id)
    elif filters.account_group_id is not None:
        query = query.filter(Transaction.account.has(Account.group_id == filters.account_group_id))

    if filters.uncategorized:
        query = query.filter(Transaction.category_id.is_(None), ~Transaction.splits.any())
    elif filters.category_id is not None:
        query = query.filter(
            or_(
                Transaction.category_id == filters.category_id,
                Transaction.splits.any(TransactionSplit.category_id == filters.category_id),
            )
        )

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

    if sort not in _SORT_EXPRESSIONS:
        return query.order_by(Transaction.transaction_date.desc(), Transaction.id.desc())

    if sort == "account":
        query = query.outerjoin(Account, Transaction.account_id == Account.id)
    elif sort == "category":
        query = query.outerjoin(Category, Transaction.category_id == Category.id)

    column = _SORT_EXPRESSIONS[sort]
    primary = column.asc() if direction == "asc" else column.desc()

    # id DESC is the final tiebreaker regardless of the chosen column or
    # direction - see the module docstring for why pagination depends on it.
    return query.order_by(primary.nulls_last(), Transaction.id.desc())


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


MIN_GROUP_SIZE = 2


@dataclass
class TransactionGroup:

    narration_key: str
    merchant: str
    sample_narration: str
    transaction_count: int
    total_amount: Decimal
    # "inflow" or "outflow", by majority across the group - see
    # services/recurring.py's module docstring for the same convention
    # (amounts stay ABSOLUTE; direction is what says which way they go).
    direction: str
    first_date: date
    last_date: date
    account_names: list[str]
    transaction_ids: list[int]
    # What actually changes when a category is assigned - without these the
    # grouped row (Merchant/Count/Total/Date range) never visibly reacts to
    # "Set category", which is exactly what prompted adding them. A split
    # row's own category_id is NULL but it IS categorized (via its
    # allocations - see TransactionSplit's docstring) so it must never be
    # counted as uncategorized; it has its own split_count instead, the same
    # distinction the ledger's `uncategorized` filter and categorization.py
    # already both make.
    uncategorized_count: int
    category_names: list[str]
    split_count: int


def transaction_groups(
    db: Session, filters: TransactionFilters, *, include_categorized: bool = False
) -> list[TransactionGroup]:
    """Rows grouped by narration_key - "similar transactions", for bulk
    categorization AND for the ledger's own Group by merchant view, from
    whatever the caller's ledger view is currently scoped to.

    Deliberately grouped by narration_key ALONE, not (account_id,
    narration_key) as recurring detection groups (services/recurring.py).
    Recurring detection is per-account because the same subscription on two
    cards is two separate commitments; categorization wants the opposite -
    the same merchant means the same category regardless of which account
    paid. Sharing narration_key/merchant_label with recurring detection (not
    a second, diverging definition of "same merchant") is what matters here;
    grouping across accounts is a deliberate, different choice about what
    "same" means for this caller.

    include_categorized defaults to False, which is the ORIGINAL behaviour
    this gained the flag on top of: `uncategorized` is forced to True
    regardless of what the caller passed - a group only makes sense for rows
    that still need a category - and any incoming category_id/uncategorized
    filter is dropped for the same reason. Passing True (the ledger's Group
    by merchant toggle) drops that override entirely and groups the
    caller's filters as given, so a merchant with a mix of categorized and
    uncategorized rows shows as one group covering both. Every other filter
    (date range, search, account, ...) passes through untouched either way,
    which is what keeps a group's transaction_ids scoped to exactly the
    caller's current view: "categorise all N" can never reach a row the
    caller couldn't already see.
    """

    grouped_filters = filters if include_categorized else replace(filters, uncategorized=True, category_id=None)

    rows = (
        build_transaction_query(db, grouped_filters)
        .outerjoin(Account, Transaction.account_id == Account.id)
        .outerjoin(Category, Transaction.category_id == Category.id)
        .with_entities(
            Transaction.id,
            Transaction.narration,
            Transaction.transaction_date,
            Transaction.debit,
            Transaction.credit,
            Transaction.category_id,
            Account.name.label("account_name"),
            Category.name.label("category_name"),
            # Correlated EXISTS, not a join - a row can have any number of
            # splits and this must stay one row per transaction regardless.
            # Same shape categorization._eligible_rows already uses.
            Transaction.splits.any().label("has_splits"),
        )
        .all()
    )

    buckets: dict[str, list] = defaultdict(list)
    for row in rows:
        buckets[narration_key(row.narration)].append(row)

    groups = []

    for key, bucket_rows in buckets.items():

        if len(bucket_rows) < MIN_GROUP_SIZE:
            continue

        amounts = [abs((row.debit or Decimal(0)) + (row.credit or Decimal(0))) for row in bucket_rows]
        direction_counts = Counter(
            "inflow" if row.debit is None else "outflow" for row in bucket_rows
        )
        # A tie is called "outflow" - the far more common shape for a
        # recurring or repeated charge, mirroring recurring detection.
        direction = "inflow" if direction_counts["inflow"] > direction_counts["outflow"] else "outflow"

        dates = [row.transaction_date for row in bucket_rows]

        groups.append(
            TransactionGroup(
                narration_key=key,
                # bucket_rows[0] is the newest occurrence - build_transaction_query
                # orders (transaction_date DESC, id DESC), preserved through grouping.
                merchant=merchant_label(bucket_rows[0].narration),
                sample_narration=bucket_rows[0].narration,
                transaction_count=len(bucket_rows),
                total_amount=sum(amounts, Decimal("0")),
                direction=direction,
                first_date=min(dates),
                last_date=max(dates),
                account_names=sorted({row.account_name for row in bucket_rows if row.account_name}),
                transaction_ids=[row.id for row in bucket_rows],
                uncategorized_count=sum(
                    1 for row in bucket_rows if row.category_id is None and not row.has_splits
                ),
                category_names=sorted({row.category_name for row in bucket_rows if row.category_name}),
                split_count=sum(1 for row in bucket_rows if row.has_splits),
            )
        )

    groups.sort(key=lambda g: (-g.transaction_count, -g.total_amount))

    return groups
