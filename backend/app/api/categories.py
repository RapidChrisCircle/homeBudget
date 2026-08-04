"""Category CRUD, including the parent/child grouping added alongside the
Queensland household preset (services/category_presets.py).

Sub-categories are GROUPING ONLY - see Category.parent_id's docstring in
models.py for the full reasoning. Two rules enforced here are what keep that
promise from quietly becoming a real tree:

1. One level only: a category cannot be given a parent that itself already
   has a parent, and a category that already has children cannot itself be
   given a parent.
2. A category with children is not budgetable and not transaction-
   assignable - the budget rule is enforced here (coerced to null, same
   pattern as the existing kind != "expense" coercion below); the
   assignment rule is enforced in api/transactions.py, since that's where a
   transaction's category_id is actually set.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..deps import get_db
from ..models import CATEGORY_KINDS, Category, CategoryRule, Transaction, TransactionSplit
from ..schemas import (
    CategoryBulkDelete,
    CategoryCreate,
    CategoryPresetResultResponse,
    CategoryResponse,
    CategoryUpdate,
    CategoryUsageResponse,
)
from ..services.allocations import allocation_subquery
from ..services.category_presets import apply_preset

router = APIRouter()


def _validate_category_payload(db: Session, payload, category: Category | None = None):
    """`category` is the existing row being updated, or None on create - a
    brand new category can't yet have children or be its own parent, so
    those two checks only apply to updates.
    """

    if payload.kind not in CATEGORY_KINDS:
        raise HTTPException(
            status_code=422,
            detail=f"kind must be one of: {', '.join(CATEGORY_KINDS)}",
        )

    if payload.budget_amount is not None and payload.budget_amount < 0:
        raise HTTPException(status_code=422, detail="budget_amount must be a positive dollar value")

    if payload.parent_id is not None:

        if category is not None and payload.parent_id == category.id:
            raise HTTPException(status_code=422, detail="A category cannot be its own parent")

        parent = db.get(Category, payload.parent_id)

        if parent is None:
            raise HTTPException(status_code=404, detail="Parent category not found")

        if parent.parent_id is not None:
            raise HTTPException(
                status_code=422,
                detail="Sub-categories are one level only - the selected parent already has a parent of its own",
            )

    has_children = category is not None and len(category.children) > 0

    if has_children and payload.parent_id is not None:
        raise HTTPException(
            status_code=422,
            detail="This category has sub-categories of its own and cannot become a sub-category",
        )

    # A budget only means something on a leaf expense category. Coercing
    # rather than rejecting avoids an edit-order trap: switching an existing
    # budgeted category to income/transfer, or to a parent, shouldn't
    # require clearing the budget first - the response just echoes back
    # null. A parent (has_children) is coerced the same way regardless of
    # kind - it groups its children, it doesn't carry a budget of its own.
    if payload.kind != "expense" or has_children:
        payload.budget_amount = None


@router.get("/categories", response_model=list[CategoryResponse])
def list_categories(include_archived: bool = False, db: Session = Depends(get_db)):
    """Excludes archived categories by default - the whole point of
    archiving is that every dropdown in the app gets clean data without
    that call site needing to know archiving exists. Pass
    ?include_archived=true for the one place that needs the full list
    anyway (the Categories page itself, so it can show/manage archived
    rows).
    """

    query = db.query(Category)

    if not include_archived:
        query = query.filter(Category.archived.is_(False))

    return query.order_by(Category.name).all()


@router.post("/categories", response_model=CategoryResponse, status_code=201)
def create_category(
    payload: CategoryCreate,
    db: Session = Depends(get_db)
):

    _validate_category_payload(db, payload)

    category = Category(**payload.model_dump())
    db.add(category)

    try:
        db.commit()

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A category with this name already exists")

    db.refresh(category)
    return category


# Static path, declared before /categories/{category_id} below for the same
# reason api/transactions.py declares /transactions/types and
# /transactions/groups before its own /transactions/{id} routes - FastAPI
# matches in declaration order, and this keeps the ordering unambiguous even
# though the two don't currently collide (different path templates).
@router.post("/categories/preset", response_model=CategoryPresetResultResponse)
def apply_category_preset(db: Session = Depends(get_db)):
    """Creates whatever the Queensland household preset is missing - see
    services/category_presets.py. Safe to call repeatedly: nothing already
    present (matched case-insensitively by name) is ever touched.
    """

    created, skipped = apply_preset(db)
    return CategoryPresetResultResponse(created=created, skipped=skipped)


# Static path, declared before /categories/{category_id} for the same
# ordering reason as /categories/preset above.
@router.get("/categories/usage", response_model=list[CategoryUsageResponse])
def category_usage(db: Session = Depends(get_db)):
    """Whole-ledger usage per category - see CategoryUsageResponse's own
    docstring in schemas.py. Two counts, computed once each over the whole
    table rather than once per category (an N+1 query per category would
    make this endpoint scale with the category count instead of the
    ledger size):

    - transaction_count via allocation_subquery (services/allocations.py),
      the SAME view reporting.py itself reads through, so a category used
      only via a split counts as used here too.
    - rule_count via a plain group-by on CategoryRule.
    """

    alloc = allocation_subquery(db)

    transaction_counts = dict(
        db.query(alloc.c.category_id, func.count(func.distinct(alloc.c.transaction_id)))
        .filter(alloc.c.category_id.isnot(None))
        .group_by(alloc.c.category_id)
        .all()
    )

    rule_counts = dict(
        db.query(CategoryRule.category_id, func.count(CategoryRule.id))
        .group_by(CategoryRule.category_id)
        .all()
    )

    return [
        CategoryUsageResponse(
            category_id=category.id,
            category_name=category.name,
            parent_id=category.parent_id,
            budget_amount=category.budget_amount,
            archived=category.archived,
            transaction_count=transaction_counts.get(category.id, 0),
            rule_count=rule_counts.get(category.id, 0),
        )
        for category in db.query(Category).order_by(Category.name).all()
    ]


@router.post("/categories/{category_id}/archive", response_model=CategoryResponse)
def archive_category(category_id: int, db: Session = Depends(get_db)):
    """Archiving is NOT deleting - see Category.archived's docstring in
    models.py. Cascades to children: an <optgroup>-based select
    (CategorySelect.jsx) cannot coherently show a hidden parent with
    visible children (they would fall back into the ungrouped block,
    which reads as data loss), so hiding a group hides all of it.
    Archiving a plain category, or a CHILD directly, touches only that one
    row - a child never has children of its own (the one-level rule), so
    there is nothing beneath it to cascade to.
    """

    category = db.get(Category, category_id)

    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")

    category.archived = True

    for child in category.children:
        child.archived = True

    db.commit()
    db.refresh(category)
    return category


@router.post("/categories/{category_id}/restore", response_model=CategoryResponse)
def restore_category(category_id: int, db: Session = Depends(get_db)):
    """Reverses archive_category exactly - restoring a parent restores its
    whole group, matching the symmetric cascade archiving applies.
    """

    category = db.get(Category, category_id)

    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")

    category.archived = False

    for child in category.children:
        child.archived = False

    db.commit()
    db.refresh(category)
    return category


@router.put("/categories/{category_id}", response_model=CategoryResponse)
def update_category(
    category_id: int,
    payload: CategoryUpdate,
    db: Session = Depends(get_db)
):

    category = db.get(Category, category_id)

    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")

    _validate_category_payload(db, payload, category=category)

    for field, value in payload.model_dump().items():
        setattr(category, field, value)

    try:
        db.commit()

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A category with this name already exists")

    db.refresh(category)
    return category


def _detach_category(db: Session, category_id: int) -> None:
    """Clears every reference TO this category - rules, transactions' own
    category_id, and TransactionSplit.category_id - before the category
    itself is deleted. Shared by single delete, cascade delete and bulk
    delete so the three can never diverge on what "removing a category
    cleanly" means; none of them commits here, so a caller can queue
    several of these into one transaction.

    Cascades are enforced here rather than left to the FK: SQLite does not
    apply ondelete without PRAGMA foreign_keys=ON, so an FK-only version
    would pass every test and behave differently against Postgres - the
    same trap noted on Account/Category's other cascades.

    The TransactionSplit line is the fix for a bug this iteration's review
    found: TransactionSplit's own docstring in models.py promises its
    category is "SET NULL (enforced explicitly in Python, not left to the
    FK - see delete_category)", but delete_category never actually did
    this - only Transaction.category_id and CategoryRule were handled. On
    SQLite (every test) a deleted category's id was left dangling in
    transaction_splits.category_id; Postgres's real FK masked the gap in
    any manual check. Reachability of the bug goes up now that deletion is
    easier (cascade + bulk below), so it is fixed first.
    """

    rule_ids = [
        rule_id
        for (rule_id,) in db.query(CategoryRule.id).filter(CategoryRule.category_id == category_id).all()
    ]

    if rule_ids:
        (
            db.query(Transaction)
            .filter(Transaction.categorized_by_rule_id.in_(rule_ids))
            .update({"categorized_by_rule_id": None}, synchronize_session=False)
        )
        db.query(CategoryRule).filter(CategoryRule.category_id == category_id).delete(synchronize_session=False)

    (
        db.query(Transaction)
        .filter(Transaction.category_id == category_id)
        .update({"category_id": None, "categorized_by_rule_id": None}, synchronize_session=False)
    )

    db.query(TransactionSplit).filter(TransactionSplit.category_id == category_id).update(
        {"category_id": None}, synchronize_session=False
    )


def _delete_single_category(db: Session, category: Category, cascade: bool) -> None:
    """Deletes one category (queued, not committed - callers commit once).

    cascade=False (the default, and the whole of today's behaviour):
    children are PROMOTED to top-level rather than left pointed at a row
    that's about to vanish - the FK's ondelete="SET NULL" documents the
    same intent, but SQLite ignores it without PRAGMA foreign_keys=ON, the
    same reason _detach_category's cascades are explicit too.

    cascade=True: children are deleted along with the parent instead of
    promoted. Recursion is safe to exactly one level deep - a child is
    never itself a parent (see _validate_category_payload's one-level
    rule) - so each child's own _delete_single_category call always runs
    with cascade=False and touches no grandchildren.
    """

    child_ids = [child.id for child in category.children]

    if cascade:
        for child_id in child_ids:
            child = db.get(Category, child_id)
            if child is not None:
                _delete_single_category(db, child, cascade=False)
    else:
        db.query(Category).filter(Category.parent_id == category.id).update(
            {"parent_id": None}, synchronize_session=False
        )

    _detach_category(db, category.id)
    db.delete(category)


@router.delete("/categories/{category_id}", status_code=204)
def delete_category(
    category_id: int,
    cascade: bool = False,
    db: Session = Depends(get_db)
):

    category = db.get(Category, category_id)

    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")

    _delete_single_category(db, category, cascade=cascade)
    db.commit()


@router.post("/categories/bulk-delete")
def bulk_delete_categories(
    payload: CategoryBulkDelete,
    db: Session = Depends(get_db)
):
    """Deletes several categories in one request, each via the exact same
    _delete_single_category path a single delete uses (cascade=False - a
    child NOT also named in the request is promoted, same as today's
    single-delete default). Order within category_ids does not matter:
    promoting a category's children unconditionally clears their
    parent_id, so a child processed earlier or later in the same request
    is unaffected either way. Ids that don't exist (already deleted,
    stale client state) are silently skipped rather than failing the
    whole batch - the response's deleted_count is the true count.
    """

    deleted_count = 0

    for category_id in payload.category_ids:

        category = db.get(Category, category_id)

        if category is None:
            continue

        _delete_single_category(db, category, cascade=False)
        deleted_count += 1

    db.commit()

    return {"deleted_count": deleted_count}
