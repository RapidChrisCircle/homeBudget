"""Net worth: the ONE place any sign-aware combination of account balances
happens. Every other "combined balance" in the app used to be a straight
sum of raw bank balances, with a caveat repeated in five places admitting
it wasn't really net worth (an everyday account and a credit card added
together as-is). This module is the fix - see Account's own docstring and
ACCOUNT_TYPES/ACCOUNT_CLASSES/BALANCE_SIGNS in models.py for the schema
half of this.

The key design point, worth stating plainly because it is easy to get
backwards: account_type (via ACCOUNT_CLASSES) does NOT enter the sign
arithmetic at all. It decides two things only - which side of the balance
sheet an account's contribution is DISPLAYED on (net_worth_now()'s
assets/liabilities split), and the INFERRED DEFAULT for balance_sign
(infer_balance_sign() below). The arithmetic itself is entirely
balance_sign's job: "natural" means the raw balance IS already the correct
net-worth contribution (this happens to be true for both an everyday
account and this app's own sample credit card, which reports debt as
negative - summing raw balances was never actually wrong for that
particular convention); "inverted" means the raw balance is the OPPOSITE
of the correct contribution (a bank that reports a card's amount owed as a
positive number) and must be negated. Keeping type and sign as two
separate fields is what makes that second, very real case expressible.

An UNCLASSIFIED account (account_type is None) has no signed contribution
at all - excluded from every total here, never guessed into it. See
ACCOUNT_TYPES's own comment in models.py for why.
"""

from decimal import Decimal

from sqlalchemy.orm import Session

from ..models import ACCOUNT_CLASSES, Account, Transaction
from .ledger import account_balances
from .trends import account_balance_history


def signed_balance(account: Account, balance: Decimal | None) -> Decimal | None:
    """The one net-worth contribution for one account's balance - already
    correctly signed to be summed directly. None in (no balance yet, or an
    unclassified account with no class to sign it by) gives None out; the
    caller decides what "no contribution" means (net_worth_now() and
    net_worth_history() both exclude it from their totals).
    """

    if balance is None or account.account_type is None:
        return None

    return balance if account.balance_sign == "natural" else -balance


def net_worth_now(db: Session) -> dict:
    """{assets, liabilities, net, unclassified_count} across every
    account's CURRENT balance (services.ledger.account_balances() - not
    re-derived here). assets and liabilities are DISPLAY buckets, split by
    account_type's class and each shown as its own positive-reading
    figure (liabilities as "how much is owed"); net is the actual sum of
    every signed_balance() and is the only figure that has to be exactly
    right - by construction, assets - liabilities always equals that same
    sum, so the two buckets can never disagree with the total they're
    drawn from.
    """

    accounts = db.query(Account).all()
    balances = account_balances(db)

    assets = Decimal("0")
    liabilities = Decimal("0")
    unclassified_count = 0

    for account in accounts:

        balance, _as_of = balances.get(account.id, (None, None))

        if account.account_type is None:
            if balance is not None:
                unclassified_count += 1
            continue

        contribution = signed_balance(account, balance)

        if contribution is None:
            continue

        if ACCOUNT_CLASSES[account.account_type] == "asset":
            assets += contribution
        else:
            # contribution is already negative for money owed - negate
            # back to a positive "amount owed" for display.
            liabilities += -contribution

    return {
        "assets": assets,
        "liabilities": liabilities,
        "net": assets - liabilities,
        "unclassified_count": unclassified_count,
    }


def net_worth_history(db: Session, periods: list[tuple[int, int]]) -> dict[tuple[int, int], Decimal | None]:
    """{period: net worth | None} - the sign-aware equivalent of the old
    combined_balance_history, built ON TOP OF services.trends.
    account_balance_history() rather than issuing a second window-function
    query, the same "build on the existing query, don't reissue it"
    principle services/trends.py's own module docstring establishes for
    reporting.category_grid().

    An unclassified account contributes nothing to any period, same as
    net_worth_now() above. A period where every classified account is
    still None (no history that far back for any of them - see
    account_balance_history's own docstring on carry-forward) stays None,
    a real gap for LineChart to break the line on rather than a false $0 -
    same convention combined_balance_history used, just sign-aware now.
    """

    accounts = {account.id: account for account in db.query(Account).all()}
    by_account = account_balance_history(db, periods)

    history: dict[tuple[int, int], Decimal | None] = {}

    for period in periods:

        contributions = []

        for account_id, balances_by_period in by_account.items():

            account = accounts.get(account_id)

            if account is None or account.account_type is None:
                continue

            contribution = signed_balance(account, balances_by_period.get(period))

            if contribution is not None:
                contributions.append(contribution)

        history[period] = sum(contributions, Decimal("0")) if contributions else None

    return history


def infer_balance_sign(db: Session, account_id: int) -> tuple[str | None, int]:
    """(inferred_sign, sample_size) - a SUGGESTION for a liability account,
    never applied automatically (api/accounts.py's own endpoint only
    returns it for the frontend to pre-fill and let the user confirm).

    Looks at every balance this account has EVER reported (its full
    transaction history, not just the current balance) and infers which
    convention predominates: mostly <= 0 means the bank already reports
    debt as negative ("natural" - a straight sum already subtracts it
    correctly); mostly > 0 means debt is reported as a positive "amount
    owed" ("inverted" - it must be negated to subtract correctly).

    Returns (None, 0) for an unclassified account (nothing to infer a
    liability convention for) or one with no balance history yet.
    Returns ("natural", 0) for an ASSET - unambiguous by construction (a
    positive balance always means "in credit" regardless of which bank),
    so there is nothing to infer from history, and sample_size is 0 to
    reflect that no evidence was actually needed.
    """

    account = db.get(Account, account_id)

    if account is None or account.account_type is None:
        return None, 0

    if ACCOUNT_CLASSES[account.account_type] == "asset":
        return "natural", 0

    balances = (
        db.query(Transaction.balance)
        .filter(Transaction.account_id == account_id)
        .all()
    )

    sample = [Decimal(row[0]) for row in balances]

    if not sample:
        return None, 0

    non_positive_count = sum(1 for balance in sample if balance <= 0)
    inferred = "natural" if non_positive_count >= len(sample) / 2 else "inverted"

    return inferred, len(sample)
