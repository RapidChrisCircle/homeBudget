"""Combining and splitting categories - the two edits a chart of accounts
needs that plain CRUD can't express.

A chart of accounts is never right first time. Two categories turn out to
mean the same thing ("Petrol" and "Fuel"), or one turns out to mean two
things ("Groceries" quietly absorbing every bottle shop run). Renaming
fixes neither: the first needs two categories' history to become one, the
second needs one category's history to become two. Doing it by hand means
re-categorizing months of transactions row by row, and deleting the loser
is worse - delete_category detaches every transaction pointing at it (see
api/categories.py's _detach_category), so "merging" by delete would silently
UNCATEGORIZE the history rather than move it.

MERGE moves every reference from the source categories to the target and
then deletes the now-unreferenced sources. What moves:

- Transaction.category_id, and TransactionSplit.category_id - the two
  places a transaction's category actually lives (see
  services/allocations.py). Both move, so a split transaction's history
  survives a merge exactly like an unsplit one's.
  A transaction split across BOTH a source and the target ends up with two
  allocations in the same category. They are left as two rows rather than
  fused into one: allocations are summed by every reader
  (services/allocations.py), so the totals are identical either way, and
  fusing them would have to silently drop one of the two free-text notes.
- CategoryRule.category_id - the rules that produced those categorizations
  keep producing them, now aimed at the target. Two rules can end up with
  identical criteria and the same category this way; that is a no-op
  duplicate, which /rules' own Review Rules card already reports and can
  remove (services/rule_review.py). Deleting them here instead would be a
  second, hidden implementation of the same judgement.
- Budgets. Standing amounts SUM into the target's, and a per-month override
  sums into the target's override for that same month. Merging two
  categories merges the money they were each allowed - a target that ends
  up with the sum of what its inputs had budgets the same total spending
  the same way, which is the only answer that leaves every historical
  budget-vs-actual figure meaning what it did before.

What merge refuses, rather than guessing:

- A group (a category with children) on either side. A parent is never
  itself assignable (Category.parent_id's docstring), so it has no
  transactions to move INTO a target, and moving transactions into one
  would create a parent that owns transactions directly - a state the rest
  of the app has never had to handle. Merge leaves, then delete the empty
  group if you want it gone.
- Mixed kinds. Merging an income category into an expense one would flip
  the sign of its whole history in every report; refusing is the only
  honest option.
- Archived state is NOT a barrier: merging an archived leftover into the
  live category that replaced it is exactly the tidy-up this exists for.

SPLIT is the mirror image, and deliberately NOT symmetric in mechanism.
Merge can move everything because "which target" is unambiguous; a split
has to decide, per transaction, WHICH new category it belongs to, and the
only signal the app has for that is the narration text. So a split part
carries a narration pattern with the exact semantics a rule's own pattern
has (categorization.criteria_match, a case-insensitive substring), parts are
matched in ORDER with first match winning (again matching how rules
themselves are evaluated), and anything matching no part STAYS in the source
category. There is no "distribute the remainder" mode - a transaction the
user hasn't described a rule for is one the app has no basis to move.

split_preview() runs the identical matching and moves nothing, so the counts
shown before the split are the counts the split then performs - the same
"preview and apply must never disagree" property services/categorization.py
maintains for rules.

A split part can optionally also create a real CategoryRule from its own
pattern, so the same narration lands in the same new category on the NEXT
import rather than only being sorted once, retroactively.
"""

from decimal import Decimal

from sqlalchemy.orm import Session

from ..models import Category, CategoryBudget, CategoryRule, Transaction, TransactionSplit


class RestructureError(Exception):
    """A caller error the API layer turns into a 4xx. `status_code` is
    carried here rather than raising HTTPException from a service so this
    module stays independent of FastAPI, matching every other service.
    """

    def __init__(self, message: str, status_code: int = 422):

        super().__init__(message)
        self.status_code = status_code


def _require_category(db: Session, category_id: int, label: str) -> Category:

    category = db.get(Category, category_id)

    if category is None:
        raise RestructureError(f"{label} category not found", status_code=404)

    return category


def merge_categories(db: Session, source_ids: list[int], target_id: int) -> dict:
    """Moves every reference from `source_ids` to `target_id`, then deletes
    the sources. See module docstring for what moves and what is refused.
    Returns a summary of what was moved.
    """

    target = _require_category(db, target_id, "Target")

    # dict.fromkeys, not set(): the same id twice is harmless, but the
    # ORDER matters for the error messages below and for merged_names.
    unique_source_ids = [source_id for source_id in dict.fromkeys(source_ids) if source_id != target_id]

    if not unique_source_ids:
        raise RestructureError("Choose at least one other category to combine into the target")

    sources = [_require_category(db, source_id, "Source") for source_id in unique_source_ids]

    if target.children:
        raise RestructureError(
            f'"{target.name}" groups its own sub-categories, so it cannot receive transactions - '
            "combine leaf categories instead"
        )

    for source in sources:

        if source.children:
            raise RestructureError(
                f'"{source.name}" groups its own sub-categories - combine its children individually, '
                "then delete the empty group"
            )

        if source.kind != target.kind:
            raise RestructureError(
                f'"{source.name}" is a {source.kind} category and "{target.name}" is a {target.kind} one - '
                "combining them would change the sign of its history in every report"
            )

    source_ids_only = [source.id for source in sources]

    transactions_moved = (
        db.query(Transaction)
        .filter(Transaction.category_id.in_(source_ids_only))
        .update({"category_id": target.id}, synchronize_session=False)
    )

    splits_moved = (
        db.query(TransactionSplit)
        .filter(TransactionSplit.category_id.in_(source_ids_only))
        .update({"category_id": target.id}, synchronize_session=False)
    )

    rules_moved = (
        db.query(CategoryRule)
        .filter(CategoryRule.category_id.in_(source_ids_only))
        .update({"category_id": target.id}, synchronize_session=False)
    )

    overrides_moved = _merge_budgets(db, sources, target)

    merged_names = [source.name for source in sources]

    for source in sources:
        db.delete(source)

    db.commit()
    db.refresh(target)

    return {
        "target": target,
        "merged_category_names": merged_names,
        "transactions_moved": transactions_moved,
        "splits_moved": splits_moved,
        "rules_moved": rules_moved,
        "budget_overrides_moved": overrides_moved,
    }


def _merge_budgets(db: Session, sources: list[Category], target: Category) -> int:
    """Sums the sources' standing budgets into the target's, and each
    source's per-month override into the target's override for that same
    month. Returns the number of override ROWS folded in.

    A source with no budget at all contributes nothing - summing against
    None would otherwise invent a zero budget for a target that had none,
    which reads as "budgeted zero, everything is over budget" rather than
    "no budget set". Source override rows are deleted here rather than left
    for the cascade, so the arithmetic is done exactly once even if a
    source is somehow processed twice.
    """

    standing_parts = [
        category.budget_amount
        for category in [target, *sources]
        if category.budget_amount is not None
    ]

    if standing_parts:
        target.budget_amount = sum(standing_parts, Decimal("0"))

    target_overrides = {
        (row.year, row.month): row
        for row in db.query(CategoryBudget).filter(CategoryBudget.category_id == target.id)
    }

    source_override_rows = (
        db.query(CategoryBudget)
        .filter(CategoryBudget.category_id.in_([source.id for source in sources]))
        .all()
    )

    for row in source_override_rows:

        existing = target_overrides.get((row.year, row.month))

        if existing is not None:
            existing.amount = Decimal(existing.amount) + Decimal(row.amount)
        else:
            moved = CategoryBudget(
                category_id=target.id, year=row.year, month=row.month, amount=Decimal(row.amount)
            )
            db.add(moved)
            target_overrides[(row.year, row.month)] = moved

        db.delete(row)

    return len(source_override_rows)


def _normalized_parts(parts) -> list[tuple[str, str]]:
    """[(name, pattern)] with whitespace trimmed, validated. Shared by
    preview and apply so the two can never disagree about which parts are
    even valid, let alone what they match.
    """

    if not parts:
        raise RestructureError("Describe at least one new category to split out")

    normalized = []
    seen_names = set()

    for part in parts:

        name = (part.name or "").strip()
        pattern = (part.pattern or "").strip()

        if not name:
            raise RestructureError("Every part needs a name")

        if not pattern:
            raise RestructureError(f'"{name}" needs a narration pattern - it decides which transactions move')

        if name.lower() in seen_names:
            raise RestructureError(f'"{name}" is named twice')

        seen_names.add(name.lower())
        normalized.append((name, pattern))

    return normalized


def _match_index(narration: str | None, patterns: list[str]) -> int | None:
    """Which part a narration belongs to - first match wins, mirroring how
    rules themselves are evaluated (services/categorization.py). None means
    it stays where it is.
    """

    text = (narration or "").lower()

    for index, pattern in enumerate(patterns):
        if pattern.lower() in text:
            return index

    return None


def _source_rows(db: Session, category_id: int) -> tuple[list[Transaction], list[tuple[TransactionSplit, str]]]:
    """Everything currently in this category, from BOTH places a category
    assignment can live: whole transactions, and individual split
    allocations (see services/allocations.py). A split allocation is
    matched against its parent transaction's narration - the allocation
    itself has only a free-text note, which is not what the pattern
    describes.
    """

    transactions = (
        db.query(Transaction)
        .filter(Transaction.category_id == category_id)
        .order_by(Transaction.transaction_date, Transaction.id)
        .all()
    )

    split_rows = (
        db.query(TransactionSplit, Transaction.narration)
        .join(Transaction, TransactionSplit.transaction_id == Transaction.id)
        .filter(TransactionSplit.category_id == category_id)
        .order_by(TransactionSplit.id)
        .all()
    )

    return transactions, [(split, narration) for split, narration in split_rows]


def _transaction_amount(transaction: Transaction) -> Decimal:

    return Decimal(transaction.debit or 0) + Decimal(transaction.credit or 0)


def split_preview(db: Session, category_id: int, parts) -> dict:
    """What split_category() would move, moving nothing. Counts are per
    part, first match wins, so no transaction is counted twice.
    """

    category = _require_category(db, category_id, "Source")
    normalized = _normalized_parts(parts)
    patterns = [pattern for _name, pattern in normalized]

    transactions, split_rows = _source_rows(db, category_id)

    counts = [0] * len(normalized)
    totals = [Decimal("0") for _ in normalized]
    remaining_count = 0
    remaining_total = Decimal("0")

    for transaction in transactions:

        index = _match_index(transaction.narration, patterns)
        amount = _transaction_amount(transaction)

        if index is None:
            remaining_count += 1
            remaining_total += amount
        else:
            counts[index] += 1
            totals[index] += amount

    for split, narration in split_rows:

        index = _match_index(narration, patterns)
        amount = Decimal(split.amount)

        if index is None:
            remaining_count += 1
            remaining_total += amount
        else:
            counts[index] += 1
            totals[index] += amount

    return {
        "category_id": category.id,
        "category_name": category.name,
        "parts": [
            {
                "name": name,
                "pattern": pattern,
                "transaction_count": counts[index],
                "total": totals[index],
            }
            for index, (name, pattern) in enumerate(normalized)
        ],
        "remaining_count": remaining_count,
        "remaining_total": remaining_total,
    }


def split_category(db: Session, category_id: int, parts) -> dict:
    """Creates one new category per part - same kind and same parent as the
    source, so a split inside a group stays inside that group - and moves
    the source's matching transactions and split allocations into them.
    Anything matching no part stays put.

    The new categories are created even when a part matches nothing today:
    a split is a decision about how this category should be divided from
    here on, and (with create_rule) the pattern keeps sorting future
    imports into it.
    """

    category = _require_category(db, category_id, "Source")
    normalized = _normalized_parts(parts)
    patterns = [pattern for _name, pattern in normalized]

    if category.children:
        raise RestructureError(
            f'"{category.name}" already groups its own sub-categories - split its children instead'
        )

    existing_names = {
        name.lower()
        for (name,) in db.query(Category.name).all()
    }

    for name, _pattern in normalized:
        if name.lower() in existing_names:
            raise RestructureError(f'A category named "{name}" already exists', status_code=409)

    created = []

    for (name, _pattern), part in zip(normalized, parts):

        budget_amount = part.budget_amount if category.kind == "expense" else None

        if budget_amount is not None and budget_amount < 0:
            raise RestructureError("budget_amount must be a positive dollar value")

        new_category = Category(
            name=name,
            kind=category.kind,
            parent_id=category.parent_id,
            budget_amount=budget_amount,
            archived=category.archived,
        )
        db.add(new_category)
        created.append(new_category)

    db.flush()  # ids for the reassignment below

    transactions, split_rows = _source_rows(db, category_id)

    transactions_moved = 0
    splits_moved = 0

    for transaction in transactions:

        index = _match_index(transaction.narration, patterns)

        if index is None:
            continue

        transaction.category_id = created[index].id
        transactions_moved += 1

    for split, narration in split_rows:

        index = _match_index(narration, patterns)

        if index is None:
            continue

        split.category_id = created[index].id
        splits_moved += 1

    rules_created = _create_split_rules(db, normalized, parts, created)

    db.commit()

    for new_category in created:
        db.refresh(new_category)

    db.refresh(category)

    return {
        "source": category,
        "created": created,
        "transactions_moved": transactions_moved,
        "splits_moved": splits_moved,
        "rules_created": rules_created,
    }


def _create_split_rules(db: Session, normalized, parts, created) -> int:
    """One CategoryRule per part that asked for one, appended AFTER every
    existing rule (rules are first-match-wins in (priority, id) order, so a
    new rule must never silently outrank one already there).
    """

    wanted = [
        (index, pattern)
        for index, ((_name, pattern), part) in enumerate(zip(normalized, parts))
        if getattr(part, "create_rule", False)
    ]

    if not wanted:
        return 0

    max_priority = db.query(CategoryRule.priority).order_by(CategoryRule.priority.desc()).limit(1).scalar()
    next_priority = (max_priority or 0) + 1

    for offset, (index, pattern) in enumerate(wanted):
        db.add(CategoryRule(
            narration_pattern=pattern,
            category_id=created[index].id,
            priority=next_priority + offset,
        ))

    return len(wanted)
