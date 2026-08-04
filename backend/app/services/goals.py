"""Savings goal progress and the envelope over-allocation check. See
SavingsGoal's own docstring in models.py for the two modes this computes
progress for - this module is the "how", that docstring is the "why".

Progress is computed fresh on every read, never stored. An account_balance
goal's current_amount is that account's own signed_balance()
(services/net_worth.py), not its raw balance - a goal linked to a liability
account (something this schema allows, even if the common case is a
savings account) must not read as positive progress just because the raw
number happens to be positive under one bank's sign convention. An
envelope goal's current_amount is simply its own allocated_amount, a
figure the household maintains by hand.
"""

from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from ..models import Account, SavingsGoal
from .ledger import account_balance
from .net_worth import signed_balance


def _months_until(today: date, target: date) -> int:
    """Whole calendar months from today to target, floored at 1 - a target
    date that's this month or already past means "as soon as possible",
    not a division by zero or a negative requirement.
    """

    months = (target.year - today.year) * 12 + (target.month - today.month)
    return max(months, 1)


def goal_progress(db: Session, goal: SavingsGoal) -> dict:
    """{current_amount, percent, remaining, monthly_required} for one goal.

    current_amount for account_balance mode is 0 (not the raw balance) when
    the linked account is missing or UNCLASSIFIED - signed_balance() has
    nothing to sign an unclassified account by (see its own docstring), and
    this module makes the same choice net_worth.py does rather than
    silently guessing. Classifying the account is what fixes it, same as
    everywhere else in this app that choice matters.

    monthly_required is None whenever there is no target_date, OR the goal
    is already met (remaining <= 0) - "how much per month" has no honest
    answer in either case, the first because there's no deadline to divide
    by, the second because the answer would be a meaningless negative or
    zero figure for a goal that's already there.
    """

    if goal.mode == "account_balance":

        current_amount = Decimal("0")

        if goal.account_id is not None:
            account = db.get(Account, goal.account_id)
            if account is not None:
                balance, _as_of = account_balance(db, account.id)
                signed = signed_balance(account, balance)
                if signed is not None:
                    current_amount = signed

    else:
        current_amount = goal.allocated_amount if goal.allocated_amount is not None else Decimal("0")

    remaining = goal.target_amount - current_amount
    percent = (current_amount / goal.target_amount * 100) if goal.target_amount != 0 else Decimal("0")

    monthly_required = None
    if goal.target_date is not None and remaining > 0:
        monthly_required = remaining / _months_until(date.today(), goal.target_date)

    return {
        "current_amount": current_amount,
        "percent": percent,
        "remaining": remaining,
        "monthly_required": monthly_required,
    }


def account_envelope_summaries(db: Session, goals: list[SavingsGoal]) -> list[dict]:
    """One entry per account carrying at least one non-archived envelope
    goal: {account_id, account_name, account_balance, allocated_total,
    over_allocated, over_allocated_by}.

    This is the drift mitigation the envelope model needs (see
    SavingsGoal's own docstring): allocated_amount is a figure the
    household maintains by hand and can drift ahead of what the account
    actually holds. Rather than let three envelope goals quietly show "on
    track" when the account can only cover two, this is computed on every
    read and the caller (api/goals.py) surfaces it - the same "show the
    discrepancy, never hide it" pattern as the split editor's live
    remainder and the frontend/API version mismatch.

    Compared against the account's RAW balance, not signed_balance() - this
    question is "is the money actually there", not "what does this account
    contribute to net worth", so an envelope account's own classification
    (or lack of one) is irrelevant here.
    """

    by_account: dict[int, list[SavingsGoal]] = {}

    for goal in goals:
        if goal.mode == "envelope" and goal.account_id is not None and not goal.archived:
            by_account.setdefault(goal.account_id, []).append(goal)

    summaries = []

    for account_id, account_goals in by_account.items():

        account = db.get(Account, account_id)

        if account is None:
            continue

        balance, _as_of = account_balance(db, account_id)
        allocated_total = sum(
            (g.allocated_amount if g.allocated_amount is not None else Decimal("0") for g in account_goals),
            Decimal("0"),
        )
        over_allocated = balance is not None and allocated_total > balance

        summaries.append({
            "account_id": account_id,
            "account_name": account.name,
            "account_balance": balance,
            "allocated_total": allocated_total,
            "over_allocated": over_allocated,
            "over_allocated_by": (allocated_total - balance) if over_allocated else None,
        })

    return summaries
