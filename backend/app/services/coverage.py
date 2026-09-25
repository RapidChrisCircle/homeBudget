"""Statement continuity - whether an account's own imported history has a
gap in it, proved from arithmetic rather than assumed.

Import is the only way a transaction enters the ledger, so a household
that forgets to import a statement period (or an export that silently
dropped rows) leaves a hole nothing else in the app can see: every total
downstream just reads as slightly lower than reality, with no signal that
anything is missing.

This module turns that into something provable, because every transaction
already carries the bank's own running Balance (README's Importing section:
"a running Balance column is always required"). For two transactions on the
same account, ordered correctly, the later one's balance must equal the
earlier one's balance plus the later one's own signed amount - that is
arithmetic identity, not a heuristic. A account with no missing statements
satisfies it end to end; a gap - a whole statement period never imported -
breaks it at exactly the two rows on either side of the hole, with the
size of the discrepancy telling you how much activity is missing.

Two things this check deliberately does NOT do:

- It never crosses SAME-DAY transactions. A bank's own file order for one
  calendar day does not reliably become import id order (two statements
  covering overlapping date ranges, or a mapped format that lists a day's
  rows in a different sequence than another), so checking the invariant
  between two same-day rows would produce false positives that have
  nothing to do with a real gap. The check only ever runs between the LAST
  row of one date and the FIRST row of the next distinct date - a real
  missing-statement gap almost always spans whole days or weeks, so this
  costs nothing in detection power while removing an entire class of noise.
- It never crosses ACCOUNTS. Grouped accounts (see Account groups in the
  README) are a succession of genuinely different bank accounts - a
  replacement card's opening balance has no arithmetic relationship to its
  predecessor's closing one, so stitching them into one series would
  manufacture a "gap" out of every single handover. Each account's own
  transactions are checked in isolation; group membership never enters this
  module at all.

A brand new account's very first transaction has nothing before it to
check against - that is the start of its recorded history, not a gap, and
the pairwise walk below never flags it (there is no earlier row to pair it
with).
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from ..models import Transaction


@dataclass
class CoverageGap:
    """One detected break in an account's balance sequence - the LAST
    consistent row before it and the FIRST row after it, so the gap's own
    date range is exactly "the period nothing was imported for" (give or
    take the same-day tolerance above).
    """

    before_date: date
    before_balance: Decimal
    after_date: date
    after_balance: Decimal
    # The 'after' row's own signed amount - what balance_before + this
    # amount SHOULD have produced.
    after_amount: Decimal
    expected_balance: Decimal
    # actual - expected. Positive means the account ended up with MORE
    # money than the recorded activity explains (likely: spending that was
    # never imported); negative means less (likely: income never imported).
    discrepancy: Decimal


def account_coverage_gaps(db: Session, account_id: int) -> list[CoverageGap]:
    """Every coverage gap in one account's own transaction history, oldest
    first. Empty means the recorded history is fully self-consistent - not
    a guarantee nothing is missing (a gap that happens to net to exactly
    zero activity is arithmetically invisible), only that nothing PROVABLY
    is.
    """

    rows = (
        db.query(
            Transaction.transaction_date,
            Transaction.debit,
            Transaction.credit,
            Transaction.balance,
        )
        .filter(Transaction.account_id == account_id)
        .order_by(Transaction.transaction_date, Transaction.id)
        .all()
    )

    gaps: list[CoverageGap] = []

    for previous, current in zip(rows, rows[1:]):

        if previous.transaction_date == current.transaction_date:
            continue

        before_balance = Decimal(previous.balance)
        after_amount = Decimal(current.debit or 0) + Decimal(current.credit or 0)
        expected_balance = before_balance + after_amount
        after_balance = Decimal(current.balance)

        if expected_balance != after_balance:
            gaps.append(CoverageGap(
                before_date=previous.transaction_date,
                before_balance=before_balance,
                after_date=current.transaction_date,
                after_balance=after_balance,
                after_amount=after_amount,
                expected_balance=expected_balance,
                discrepancy=after_balance - expected_balance,
            ))

    return gaps
