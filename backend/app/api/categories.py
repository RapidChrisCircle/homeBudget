from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..deps import get_db
from ..models import Category, Transaction
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

    db.query(Transaction).filter(Transaction.category_id == category_id).update({"category_id": None})

    db.delete(category)
    db.commit()
