from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..deps import get_db
from ..models import Category, CategoryRule, Transaction
from ..schemas import CategoryCreate, CategoryResponse, CategoryUpdate

router = APIRouter()


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

    category = Category(**payload.model_dump())
    db.add(category)

    try:
        db.commit()

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A category with this name already exists")

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

    category.name = payload.name

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

    db.delete(category)
    db.commit()
