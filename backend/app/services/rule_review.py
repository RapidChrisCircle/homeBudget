"""Rule redundancy detection - "review and merge similar rules".

Rules are first-match-wins by (priority, id) - see services/categorization.py's
module docstring, which this reads through rather than reimplementing. A
rule's narration_pattern is a single case-insensitive substring with no OR,
so two rules with genuinely unrelated patterns (WOOLWORTHS, COLES) cannot be
combined - the schema can't express it. "Merge" therefore means *remove the
rule that can never fire*, which is the only merge these semantics support
honestly.

An EARLIER rule (evaluated first) makes a LATER one unreachable exactly when:

  1. the earlier rule's pattern is a substring of the later one's (so every
     narration the later rule would match, the earlier one matches too -
     substring containment is transitive), AND
  2. the earlier rule's other criteria are "absent-or-broader": its
     transaction_type is null or equal, its min_amount is null or lower, its
     max_amount is null or higher.

When both hold, the earlier rule matches a SUPERSET of what the later rule
matches, so the earlier rule always wins first and the later rule is
provably dead code for its whole match set - regardless of what its own
category is. What differs is what that dead code MEANS:

- same category  -> `duplicate` (if every field matches exactly) or
  `subsumed` (otherwise) - both are no-ops to remove: deleting either cannot
  change how a single transaction categorizes, because the earlier rule
  already produces the same result for every row the later one would have
  touched.
- different category -> `shadowed` - this is almost certainly a bug, not
  redundancy: the rule was written intending to win and silently doesn't.
  Never auto-removed; reported with the blocking rule named so it can be
  reordered with the existing move up/down endpoint instead.
"""

from dataclasses import dataclass

from sqlalchemy.orm import Session

from ..models import CategoryRule, Transaction
from .categorization import load_rules

DUPLICATE = "duplicate"
SUBSUMED = "subsumed"
SHADOWED = "shadowed"


@dataclass
class RuleFinding:

    rule_id: int
    narration_pattern: str
    category_id: int
    category_name: str | None
    kind: str
    blocking_rule_id: int
    blocking_narration_pattern: str


def _normalized_pattern(rule: CategoryRule) -> str:

    return (rule.narration_pattern or "").strip().lower()


def _normalized_type(value: str | None) -> str | None:

    return value.strip().upper() if value and value.strip() else None


def _type_broader_or_equal(earlier: CategoryRule, later: CategoryRule) -> bool:

    earlier_type = _normalized_type(earlier.transaction_type)

    if earlier_type is None:
        return True

    return earlier_type == _normalized_type(later.transaction_type)


def _min_broader_or_equal(earlier: CategoryRule, later: CategoryRule) -> bool:

    if earlier.min_amount is None:
        return True

    return later.min_amount is not None and earlier.min_amount <= later.min_amount


def _max_broader_or_equal(earlier: CategoryRule, later: CategoryRule) -> bool:

    if earlier.max_amount is None:
        return True

    return later.max_amount is not None and earlier.max_amount >= later.max_amount


def _covers(earlier: CategoryRule, later: CategoryRule) -> bool:
    """Whether `earlier` structurally makes `later` unreachable - see the
    module docstring for exactly what that means and why.
    """

    earlier_pattern = _normalized_pattern(earlier)

    if not earlier_pattern or earlier_pattern not in _normalized_pattern(later):
        return False

    return (
        _type_broader_or_equal(earlier, later)
        and _min_broader_or_equal(earlier, later)
        and _max_broader_or_equal(earlier, later)
    )


def _is_exact_duplicate(earlier: CategoryRule, later: CategoryRule) -> bool:

    return (
        _normalized_pattern(earlier) == _normalized_pattern(later)
        and _normalized_type(earlier.transaction_type) == _normalized_type(later.transaction_type)
        and earlier.min_amount == later.min_amount
        and earlier.max_amount == later.max_amount
    )


def review_rules(db: Session) -> list[RuleFinding]:
    """Every rule that is provably unreachable given the rules ranked before
    it, in evaluation order. Read-only - this reads the existing (priority,
    id) ordering exactly as categorization.py does, and changes nothing.
    """

    rules = load_rules(db)
    findings: list[RuleFinding] = []

    for index, later in enumerate(rules):
        for earlier in rules[:index]:

            if not _covers(earlier, later):
                continue

            if earlier.category_id == later.category_id:
                kind = DUPLICATE if _is_exact_duplicate(earlier, later) else SUBSUMED
            else:
                kind = SHADOWED

            findings.append(RuleFinding(
                rule_id=later.id,
                narration_pattern=later.narration_pattern,
                category_id=later.category_id,
                category_name=later.category_name,
                kind=kind,
                blocking_rule_id=earlier.id,
                blocking_narration_pattern=earlier.narration_pattern,
            ))
            # The FIRST covering ancestor is the one that actually wins in
            # practice for every transaction this rule would also match -
            # later, more-distant ancestors would be true but redundant to
            # report.
            break

    return findings


def remove_redundant_rules(db: Session) -> int:
    """Deletes every `duplicate` and `subsumed` finding - never `shadowed`,
    which is reported but left for a human to reorder or rewrite. Safe by
    construction: both kinds are provably no-ops (see module docstring), so
    removing them cannot change how any transaction categorizes.
    """

    findings = review_rules(db)
    rule_ids = [finding.rule_id for finding in findings if finding.kind in (DUPLICATE, SUBSUMED)]

    if not rule_ids:
        return 0

    # Mirrors delete_category_rule (api/category_rules.py) - a transaction
    # keeps the category a removed rule gave it, but loses the marker, the
    # same way a single manual delete already does.
    (
        db.query(Transaction)
        .filter(Transaction.categorized_by_rule_id.in_(rule_ids))
        .update({"categorized_by_rule_id": None}, synchronize_session=False)
    )

    deleted = (
        db.query(CategoryRule)
        .filter(CategoryRule.id.in_(rule_ids))
        .delete(synchronize_session=False)
    )

    db.commit()

    return deleted
