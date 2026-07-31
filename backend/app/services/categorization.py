"""Rule-based auto-categorization of transactions.

Matching semantics, in one place so import, apply and preview cannot drift:

- narration_pattern is a case-insensitive substring ("contains") match and is
  always required.
- transaction_type, min_amount and max_amount are optional. Every populated
  criterion must match - criteria are ANDed.
- Amounts are compared against the ABSOLUTE value of whichever of debit/credit
  is populated. Debits are stored negative, so a signed comparison would never
  match a positive bound. Bounds are inclusive.
- Rules are evaluated in (priority, id) order and the first match wins.

Eligibility - what rules are allowed to touch:

    category_id IS NULL OR categorized_by_rule_id IS NOT NULL

An uncategorized row is fair game, and a row a rule categorized earlier can be
re-evaluated (so fixing a bad rule and re-applying corrects it). A row a human
categorized by hand has a category but no rule marker, so it is permanently
off limits. The manual-categorization endpoints clear the marker precisely to
put a row into that protected state.

Matching runs in Python rather than SQL because the import path has to match
rows that are not in the database yet. Keeping one matcher for all three
callers avoids the "preview said 12, apply did 9" class of bug, and sidesteps
LIKE wildcard escaping for user-supplied patterns.
"""

from decimal import Decimal

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..models import CategoryRule, Transaction


def _row_amount(debit: Decimal | None, credit: Decimal | None) -> Decimal | None:

    if debit is not None:
        return abs(debit)

    if credit is not None:
        return abs(credit)

    return None


def _is_eligible(category_id: int | None, categorized_by_rule_id: int | None) -> bool:

    return category_id is None or categorized_by_rule_id is not None


def load_rules(db: Session) -> list[CategoryRule]:

    return (
        db.query(CategoryRule)
        .order_by(CategoryRule.priority, CategoryRule.id)
        .all()
    )


def criteria_match(
    *,
    narration_pattern: str,
    transaction_type: str | None,
    min_amount: Decimal | None,
    max_amount: Decimal | None,
    narration: str,
    row_transaction_type: str | None,
    debit: Decimal | None,
    credit: Decimal | None,
) -> bool:
    """Match raw criteria against a row.

    Takes criteria rather than a CategoryRule so the preview endpoint can
    evaluate an unsaved rule without building a throwaway ORM object.
    """

    pattern = (narration_pattern or "").strip().lower()

    if not pattern:
        return False

    if pattern not in (narration or "").lower():
        return False

    if transaction_type is not None and transaction_type.strip():
        expected = transaction_type.strip().upper()
        actual = (row_transaction_type or "").strip().upper()
        if actual != expected:
            return False

    if min_amount is not None or max_amount is not None:

        amount = _row_amount(debit, credit)

        if amount is None:
            return False

        if min_amount is not None and amount < min_amount:
            return False

        if max_amount is not None and amount > max_amount:
            return False

    return True


def rule_matches(
    rule: CategoryRule,
    *,
    narration: str,
    transaction_type: str | None,
    debit: Decimal | None,
    credit: Decimal | None,
) -> bool:

    return criteria_match(
        narration_pattern=rule.narration_pattern,
        transaction_type=rule.transaction_type,
        min_amount=rule.min_amount,
        max_amount=rule.max_amount,
        narration=narration,
        row_transaction_type=transaction_type,
        debit=debit,
        credit=credit,
    )


def match_rule(
    rules: list[CategoryRule],
    *,
    narration: str,
    transaction_type: str | None,
    debit: Decimal | None,
    credit: Decimal | None,
) -> CategoryRule | None:
    """Return the first matching rule from a pre-ordered list, or None."""

    for rule in rules:

        if rule_matches(
            rule,
            narration=narration,
            transaction_type=transaction_type,
            debit=debit,
            credit=credit,
        ):
            return rule

    return None


def apply_rules_to_transaction(rules: list[CategoryRule], transaction: Transaction) -> bool:
    """Categorize a brand new (unflushed) transaction. Used by the import path.

    Returns whether a rule was applied.
    """

    rule = match_rule(
        rules,
        narration=transaction.narration,
        transaction_type=transaction.transaction_type,
        debit=transaction.debit,
        credit=transaction.credit,
    )

    if rule is None:
        return False

    transaction.category_id = rule.category_id
    transaction.categorized_by_rule_id = rule.id

    return True


def _eligible_rows(db: Session, eligible_only: bool):
    """Lightweight column query - no ORM hydration, no relationship loading."""

    query = db.query(
        Transaction.id,
        Transaction.narration,
        Transaction.transaction_type,
        Transaction.debit,
        Transaction.credit,
        Transaction.category_id,
        Transaction.categorized_by_rule_id,
    )

    if eligible_only:
        query = query.filter(
            or_(
                Transaction.category_id.is_(None),
                Transaction.categorized_by_rule_id.isnot(None),
            )
        )

    return query.all()


def apply_rules_to_existing(db: Session, rules: list[CategoryRule] | None = None) -> int:
    """Re-run all rules over existing transactions. Returns rows changed."""

    rules = rules if rules is not None else load_rules(db)

    if not rules:
        return 0

    assignments: dict[tuple[int, int], list[int]] = {}

    for row in _eligible_rows(db, eligible_only=True):

        rule = match_rule(
            rules,
            narration=row.narration,
            transaction_type=row.transaction_type,
            debit=row.debit,
            credit=row.credit,
        )

        if rule is None:
            continue

        # Re-running with no rule changes must report 0, not re-write every row.
        if row.category_id == rule.category_id and row.categorized_by_rule_id == rule.id:
            continue

        assignments.setdefault((rule.category_id, rule.id), []).append(row.id)

    updated = 0

    for (category_id, rule_id), transaction_ids in assignments.items():

        updated += (
            db.query(Transaction)
            .filter(Transaction.id.in_(transaction_ids))
            .update(
                {"category_id": category_id, "categorized_by_rule_id": rule_id},
                synchronize_session=False
            )
        )

    db.commit()

    return updated


def preview_rule(
    db: Session,
    *,
    narration_pattern: str,
    transaction_type: str | None = None,
    min_amount: Decimal | None = None,
    max_amount: Decimal | None = None,
    category_id: int | None = None,
    exclude_rule_id: int | None = None,
) -> tuple[int, int]:
    """Count what a candidate rule would do, without saving it.

    Returns (match_count, would_categorize_count):
    - match_count ignores current categorization entirely - "how many
      transactions look like this".
    - would_categorize_count is the eligible subset that would actually
      change. Rows already tagged by the rule being edited (exclude_rule_id)
      still count when the criteria or target category have changed.
    """

    match_count = 0
    would_categorize_count = 0

    for row in _eligible_rows(db, eligible_only=False):

        if not criteria_match(
            narration_pattern=narration_pattern,
            transaction_type=transaction_type,
            min_amount=min_amount,
            max_amount=max_amount,
            narration=row.narration,
            row_transaction_type=row.transaction_type,
            debit=row.debit,
            credit=row.credit,
        ):
            continue

        match_count += 1

        if not _is_eligible(row.category_id, row.categorized_by_rule_id):
            continue

        already_applied = (
            category_id is not None
            and row.category_id == category_id
            and exclude_rule_id is not None
            and row.categorized_by_rule_id == exclude_rule_id
        )

        if already_applied:
            continue

        would_categorize_count += 1

    return match_count, would_categorize_count
