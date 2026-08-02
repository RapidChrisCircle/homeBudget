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
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..deps import get_db
from ..models import CATEGORY_KINDS, Category, CategoryRule, Transaction
from ..schemas import CategoryCreate, CategoryPresetResultResponse, CategoryResponse, CategoryUpdate
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
def list_categories(db: Session = Depends(get_db)):

    return (
        db.query(Category)
        .order_by(Category.name)
        .all()
    )


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


@router.delete("/categories/{category_id}", status_code=204)
def delete_category(
    category_id: int,
    db: Session = Depends(get_db)
):

    category = db.get(Category, category_id)

    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")

    # Cascades are enforced here rather than left to the FK: SQLite does not
    # apply ondelete without PRAGMA foreign_keys=ON, so a cascade-only version
    # would pass every test and behave differently against Postgres.
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

    # Promotes children to top-level rather than leaving them pointed at a
    # row that's about to vanish - the FK's ondelete="SET NULL" documents
    # the same intent, but SQLite ignores it without PRAGMA
    # foreign_keys=ON, the same reason every cascade above is explicit too.
    db.query(Category).filter(Category.parent_id == category_id).update(
        {"parent_id": None}, synchronize_session=False
    )

    db.delete(category)
    db.commit()
