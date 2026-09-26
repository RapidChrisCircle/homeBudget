"""Matching the two legs of a transfer between the household's own accounts.

Finding 5: Category.kind == "transfer" excludes both legs of a transfer from
every report (reporting.py's module docstring), but nothing today confirms
the two legs actually correspond to each other. One leg mis-categorized -
left as an ordinary expense/income instead of a transfer - silently inflates
BOTH spending and income by the same amount, with nothing to catch it.

This module answers "which transactions look like they're the two sides of
the same transfer" by amount and date proximity alone, deliberately NOT by
narration - unlike recurring-payment detection (services/recurring.py),
where the same merchant's narration is genuinely consistent occurrence to
occurrence, a real bank transfer is usually described differently by each
side's own statement ("Transfer to XXXX1234" on the sending account,
"Transfer from XXXX5678" on the receiving one), so requiring narration
agreement would miss the very case this exists to catch.

Never auto-recategorizes anything - the same "surface it, don't guess"
posture as balance-sign inference (README's Accounts and net worth section).
A candidate PAIR is reported regardless of whether either leg is currently
categorized as a transfer (so a mis-categorized leg is exactly as visible as
a correctly-categorized one), and a transaction currently categorized as a
transfer with NO matching counterpart anywhere is reported separately as
"unmatched" - the household decides what to do with either signal.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session, joinedload

from ..models import Transaction

# A transfer's two legs normally clear within a few days of each other (bank
# processing delay, or one side backdating to the instruction date) - wide
# enough to catch that, narrow enough that two unrelated transactions of the
# same round amount landing weeks apart aren't mistaken for a pair.
TRANSFER_WINDOW_DAYS = 3


@dataclass
class TransferMatch:

    leg_a_id: int
    leg_a_account_id: int
    leg_a_date: date
    leg_b_id: int
    leg_b_account_id: int
    leg_b_date: date
    # Positive magnitude - which leg was the debit/credit is already implied
    # by leg_a/leg_b being opposite signs by construction.
    amount: Decimal
    both_categorized_as_transfer: bool


def _signed_amount(transaction: Transaction) -> Decimal | None:

    raw = transaction.debit if transaction.debit is not None else transaction.credit
    return Decimal(raw) if raw is not None else None


def _matchable_transactions(db: Session) -> list[Transaction]:
    """Every transaction eligible to be one leg of a transfer: linked to a
    real account (Transaction.account_id.isnot(None), the same convention
    forecast.py/ledger.py/recurring.py already use for anything account-
    scoped) and NOT a split transaction - a split has no single signed
    amount of its own to compare (see TransactionSplit's docstring in
    models.py), and a transfer is never realistically split across several
    categories in the first place.
    """

    return (
        db.query(Transaction)
        .options(joinedload(Transaction.category))
        .filter(Transaction.account_id.isnot(None), ~Transaction.splits.any())
        .all()
    )


def transfer_candidates(db: Session, window_days: int = TRANSFER_WINDOW_DAYS) -> list[TransferMatch]:
    """Every candidate transfer pair: two transactions, in two DIFFERENT
    accounts, with exactly opposite signed amounts, within `window_days` of
    each other. Matching is greedy - within each exact amount, each debit is
    paired with whichever unclaimed, cross-account, opposite-signed credit
    is closest in date, and each transaction is used in at most one pair -
    so a transaction can't simultaneously "explain" two different pairs.

    Grouping by amount first keeps this cheap even on a large ledger: only
    transactions sharing the exact same absolute amount are ever compared
    against each other at all.
    """

    by_amount: dict[Decimal, list[Transaction]] = {}

    for transaction in _matchable_transactions(db):

        amount = _signed_amount(transaction)

        if amount is None or amount == 0:
            continue

        by_amount.setdefault(abs(amount), []).append(transaction)

    matches: list[TransferMatch] = []

    for candidates in by_amount.values():

        debits = sorted(
            (t for t in candidates if _signed_amount(t) < 0), key=lambda t: t.transaction_date
        )
        credits = sorted(
            (t for t in candidates if _signed_amount(t) > 0), key=lambda t: t.transaction_date
        )
        claimed_credit_ids: set[int] = set()

        for debit in debits:

            best = None
            best_diff = None

            for credit in credits:

                if credit.id in claimed_credit_ids or credit.account_id == debit.account_id:
                    continue

                diff = abs((credit.transaction_date - debit.transaction_date).days)

                if diff > window_days:
                    continue

                if best is None or diff < best_diff:
                    best, best_diff = credit, diff

            if best is not None:

                claimed_credit_ids.add(best.id)
                matches.append(TransferMatch(
                    leg_a_id=debit.id,
                    leg_a_account_id=debit.account_id,
                    leg_a_date=debit.transaction_date,
                    leg_b_id=best.id,
                    leg_b_account_id=best.account_id,
                    leg_b_date=best.transaction_date,
                    amount=abs(_signed_amount(debit)),
                    both_categorized_as_transfer=(
                        debit.category is not None and debit.category.kind == "transfer"
                        and best.category is not None and best.category.kind == "transfer"
                    ),
                ))

    return matches


def unmatched_transfer_legs(db: Session, matches: list[TransferMatch] | None = None) -> list[Transaction]:
    """Every transaction categorized as a transfer that ISN'T part of any
    candidate pair - the interesting signal for the alerts feed, since it
    means either the other leg was never imported, or this one is mis-
    categorized as a transfer when it isn't really one.
    """

    if matches is None:
        matches = transfer_candidates(db)

    matched_ids = {m.leg_a_id for m in matches} | {m.leg_b_id for m in matches}

    return [
        t for t in _matchable_transactions(db)
        if t.category is not None and t.category.kind == "transfer" and t.id not in matched_ids
    ]
