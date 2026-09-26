"""One assembled "needs attention" feed over signals the app already
computes elsewhere.

Finding 6: over-budget categories, a subscription's price rise, a bill that
stopped arriving, a statement-coverage gap ([T1.3](coverage.py)), an
unmatched transfer ([T2.3](transfer_matching.py)) - every one of these is
already detected by an existing module. Nothing here is a second
implementation of any of them; this module only QUERIES the four existing
sources and wraps each hit in one common `Alert` shape so the frontend has
one feed to render instead of five different pages to remember to check.

Dismissal deliberately does NOT introduce a second dismissal system across
the board. A recurring-sourced alert (price change, missed/stopped) reuses
the EXISTING RecurringDismissal / POST /recurring/dismissals mechanism
verbatim - `detect_series()`'s own default already excludes a dismissed
series, so an alert for it simply stops being generated, with no new state
to track here. Only the three signal kinds that had no dismissal concept of
their own - over-budget, a coverage gap, an unmatched transfer - get the new
generic, key-based AlertDismissal table (models.py). Each alert's `key` is
built from the underlying FACT's own identity (which category and month;
which account and gap; which transaction), never a surrogate id for a row
that might not exist the next time this runs - so dismissing one occurrence
of a problem never silently suppresses a different, later occurrence of the
same kind of problem.
"""

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy.orm import Session

from ..models import Account, AlertDismissal
from .coverage import account_coverage_gaps
from .recurring import detect_series
from .reporting import budget_lines, category_totals_for_period, default_period, month_bounds
from .transfer_matching import transfer_candidates, unmatched_transfer_legs

CATEGORY_PATH_SEPARATOR = " › "  # matches frontend/src/utils/categories.js's categoryPathLabel


def _category_path(name: str, parent_name: str | None) -> str:

    return f"{parent_name}{CATEGORY_PATH_SEPARATOR}{name}" if parent_name else name


@dataclass
class Alert:

    key: str
    kind: str
    title: str
    detail: str
    amount: Decimal | None
    link: str | None
    # "generic" -> dismiss via POST /alerts/dismissals {alert_key: key}.
    # "recurring" -> dismiss via the EXISTING POST /recurring/dismissals
    # {account_id: recurring_account_id, narration_key: recurring_narration_key}.
    dismiss_kind: str
    recurring_account_id: int | None = None
    recurring_narration_key: str | None = None


def _over_budget_alerts(db: Session, dismissed_keys: set[str]) -> list[Alert]:

    year, month = default_period(db)
    start, end = month_bounds(year, month)
    totals = category_totals_for_period(db, start, end)

    alerts = []

    for line in budget_lines(totals):

        if line.difference is None or line.difference >= 0:
            continue

        key = f"over_budget:{line.category_id}:{year}:{month}"

        if key in dismissed_keys:
            continue

        over_by = -line.difference

        alerts.append(Alert(
            key=key,
            kind="over_budget",
            title=f"{_category_path(line.category_name, line.parent_name)} is over budget",
            detail=f"{year:04d}-{month:02d}",
            amount=over_by,
            link="/reports",
            dismiss_kind="generic",
        ))

    return alerts


def _recurring_alerts(db: Session) -> list[Alert]:
    """No dismissed_keys check here - detect_series(db) (default
    include_dismissed=False) already excludes anything dismissed via the
    existing RecurringDismissal mechanism, so there is nothing left for this
    function to filter.
    """

    alerts = []

    for item in detect_series(db):

        if item.status in ("overdue", "ended"):

            alerts.append(Alert(
                key=f"missed_recurring:{item.account_id}:{item.narration_key}",
                kind="missed_recurring",
                title=f"{item.merchant} looks {'stopped' if item.status == 'ended' else 'overdue'}",
                detail=f"{item.account_name} - last seen {item.last_date.isoformat()}",
                amount=item.typical_amount,
                link="/recurring",
                dismiss_kind="recurring",
                recurring_account_id=item.account_id,
                recurring_narration_key=item.narration_key,
            ))

        if item.amount_changed:

            alerts.append(Alert(
                key=f"price_change:{item.account_id}:{item.narration_key}",
                kind="price_change",
                title=f"{item.merchant}'s amount changed",
                detail=f"{item.account_name} - was {item.typical_amount}, now {item.latest_amount}",
                amount=item.latest_amount,
                link="/recurring",
                dismiss_kind="recurring",
                recurring_account_id=item.account_id,
                recurring_narration_key=item.narration_key,
            ))

    return alerts


def _coverage_alerts(db: Session, dismissed_keys: set[str]) -> list[Alert]:

    accounts = db.query(Account.id, Account.name).all()
    alerts = []

    for account_id, account_name in accounts:

        for gap in account_coverage_gaps(db, account_id):

            key = f"coverage_gap:{account_id}:{gap.before_date.isoformat()}:{gap.after_date.isoformat()}"

            if key in dismissed_keys:
                continue

            alerts.append(Alert(
                key=key,
                kind="coverage_gap",
                title=f"Possible missing statement on {account_name}",
                detail=f"between {gap.before_date.isoformat()} and {gap.after_date.isoformat()}",
                amount=gap.discrepancy,
                link=f"/accounts/{account_id}",
                dismiss_kind="generic",
            ))

    return alerts


def _transfer_alerts(db: Session, dismissed_keys: set[str]) -> list[Alert]:

    matches = transfer_candidates(db)
    accounts = dict(db.query(Account.id, Account.name).all())
    alerts = []

    for leg in unmatched_transfer_legs(db, matches):

        key = f"unmatched_transfer:{leg.id}"

        if key in dismissed_keys:
            continue

        alerts.append(Alert(
            key=key,
            kind="unmatched_transfer",
            title="Transfer with no matching counterpart",
            detail=f"{accounts.get(leg.account_id, '')} - {leg.narration} on {leg.transaction_date.isoformat()}",
            amount=leg.debit if leg.debit is not None else leg.credit,
            link="/transactions",
            dismiss_kind="generic",
        ))

    return alerts


def collect_alerts(db: Session) -> list[Alert]:
    """Every current, non-dismissed alert across all four sources. Order is
    deterministic (by kind, then insertion order within each) rather than
    interleaved by severity - simple and predictable beats a scoring model
    nobody asked for.
    """

    dismissed_keys = {row.alert_key for row in db.query(AlertDismissal.alert_key).all()}

    return [
        *_over_budget_alerts(db, dismissed_keys),
        *_recurring_alerts(db),
        *_coverage_alerts(db, dismissed_keys),
        *_transfer_alerts(db, dismissed_keys),
    ]


def dismiss_alert(db: Session, alert_key: str) -> int:
    """Records a generic dismissal, upserting so re-dismissing an already-
    dismissed key is a harmless no-op rather than a duplicate-key error.
    """

    existing = db.query(AlertDismissal).filter(AlertDismissal.alert_key == alert_key).first()

    if existing is not None:
        return existing.id

    dismissal = AlertDismissal(alert_key=alert_key)
    db.add(dismissal)
    db.commit()
    db.refresh(dismissal)

    return dismissal.id
