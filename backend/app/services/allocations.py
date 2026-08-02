"""The one place every category-aggregating money query (reporting, and by
extension trends, which is deliberately built on top of
reporting.category_grid rather than issuing its own queries) reads
transaction amounts through.

Before splits existed, "how much did category X get in period P" was a
straight join from Category to Transaction on category_id. A split
transaction has NO category_id of its own (see TransactionSplit's docstring
in models.py - a transaction is either unsplit, with its own category_id,
or split into N TransactionSplit rows, never both), so that join alone
would silently drop every split transaction's activity from every report.
This module is the fix: one (transaction_id, category_id, amount,
transaction_date) view, UNION ALL of the two sources, that
reporting.category_totals_for_period and reporting.category_grid join
against instead of Transaction directly.

UNION ALL, not UNION - construction already guarantees the two halves never
overlap the same transaction (a split transaction always has category_id
NULL, enforced by api/transactions.py's write endpoints, each of which
clears the other state when it sets its own), so there is nothing to
deduplicate and no reason to pay for it.

An allocation with no category - an uncategorized whole transaction, or an
uncategorized slice of a split - contributes NO row here, exactly matching
the pre-splits behaviour where such a transaction simply never matched the
join. Both stay excluded from every category total; only the ledger's own
uncategorized filter and reporting.uncategorized_summary account for them
(the latter also had to learn to exclude split transactions specifically -
see its own docstring - since a split transaction's category_id is NULL
too, but for a different reason than being genuinely uncategorized).

For an entirely unsplit ledger this produces EXACTLY one row per
categorized transaction, with the same (category_id, amount,
transaction_date) the old direct join produced. That equivalence is what
the full existing reporting/trends/budget test suite - unchanged by this
module - proves: nothing about a ledger with zero splits should compute
differently after this was introduced.
"""

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import Transaction, TransactionSplit

# Mirrors the signed debit+credit convention used everywhere else (see
# categorization._row_amount for the Python-side equivalent). Not imported
# from reporting.py to avoid a circular import - reporting.py is the one
# that imports FROM this module.
_NET_EXPR = func.coalesce(Transaction.debit, 0) + func.coalesce(Transaction.credit, 0)


def allocation_subquery(db: Session):
    """A (transaction_id, category_id, amount, transaction_date) subquery.
    Callers outer-join Category to this instead of to Transaction directly,
    on `alloc.c.category_id == Category.id` plus whatever date-range
    condition they need in the same ON clause (never in WHERE - see
    reporting.category_totals_for_period's docstring for why that
    distinction matters for an outer join).
    """

    unsplit = db.query(
        Transaction.id.label("transaction_id"),
        Transaction.category_id.label("category_id"),
        _NET_EXPR.label("amount"),
        Transaction.transaction_date.label("transaction_date"),
    ).filter(Transaction.category_id.isnot(None))

    split = (
        db.query(
            TransactionSplit.transaction_id.label("transaction_id"),
            TransactionSplit.category_id.label("category_id"),
            TransactionSplit.amount.label("amount"),
            Transaction.transaction_date.label("transaction_date"),
        )
        .join(Transaction, Transaction.id == TransactionSplit.transaction_id)
        .filter(TransactionSplit.category_id.isnot(None))
    )

    return unsplit.union_all(split).subquery()
