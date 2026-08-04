from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..deps import get_db
from ..models import Category, CategoryRule, Transaction
from ..schemas import (
    ApplyRulesResponse,
    CategoryRuleCreate,
    CategoryRuleMove,
    CategoryRulePreviewRequest,
    CategoryRulePreviewResponse,
    CategoryRuleResponse,
    CategoryRuleUpdate,
    RemoveRedundantRulesResponse,
    RuleReviewResponse,
)
from ..services.categorization import apply_rules_to_existing, preview_rule
from ..services.rule_review import remove_redundant_rules, review_rules

router = APIRouter()


def _validate_rule_payload(db: Session, payload):

    if not payload.narration_pattern or not payload.narration_pattern.strip():
        raise HTTPException(status_code=422, detail="Narration pattern is required")

    for field_name, value in (("min_amount", payload.min_amount), ("max_amount", payload.max_amount)):
        if value is not None and value < 0:
            raise HTTPException(
                status_code=422,
                detail=f"{field_name} must be a positive dollar value - amounts are matched on magnitude",
            )

    if (
        payload.min_amount is not None
        and payload.max_amount is not None
        and payload.min_amount > payload.max_amount
    ):
        raise HTTPException(status_code=422, detail="min_amount cannot be greater than max_amount")

    if db.get(Category, payload.category_id) is None:
        raise HTTPException(status_code=404, detail="Category not found")


def _list_rules(db: Session) -> list[CategoryRule]:

    return (
        db.query(CategoryRule)
        .order_by(CategoryRule.priority, CategoryRule.id)
        .all()
    )


@router.get("/category-rules", response_model=list[CategoryRuleResponse])
def list_category_rules(db: Session = Depends(get_db)):

    return _list_rules(db)


# Static paths are declared before /category-rules/{rule_id} - FastAPI matches
# routes in declaration order.
@router.post("/category-rules/preview", response_model=CategoryRulePreviewResponse)
def preview_category_rule(
    payload: CategoryRulePreviewRequest,
    db: Session = Depends(get_db)
):

    match_count, would_categorize_count = preview_rule(
        db,
        narration_pattern=payload.narration_pattern,
        transaction_type=payload.transaction_type,
        min_amount=payload.min_amount,
        max_amount=payload.max_amount,
        category_id=payload.category_id,
        exclude_rule_id=payload.exclude_rule_id,
    )

    return CategoryRulePreviewResponse(
        match_count=match_count,
        would_categorize_count=would_categorize_count,
    )


@router.post("/category-rules/apply", response_model=ApplyRulesResponse)
def apply_category_rules(db: Session = Depends(get_db)):

    return ApplyRulesResponse(categorized_count=apply_rules_to_existing(db))


@router.get("/category-rules/review", response_model=RuleReviewResponse)
def get_rule_review(db: Session = Depends(get_db)):

    return RuleReviewResponse(findings=review_rules(db))


@router.post("/category-rules/review/remove-redundant", response_model=RemoveRedundantRulesResponse)
def remove_redundant_category_rules(db: Session = Depends(get_db)):

    return RemoveRedundantRulesResponse(removed_count=remove_redundant_rules(db))


@router.post("/category-rules", response_model=CategoryRuleResponse, status_code=201)
def create_category_rule(
    payload: CategoryRuleCreate,
    db: Session = Depends(get_db)
):

    _validate_rule_payload(db, payload)

    # New rules go to the bottom of the evaluation order.
    next_priority = (db.query(func.max(CategoryRule.priority)).scalar() or 0) + 1

    rule = CategoryRule(**payload.model_dump(), priority=next_priority)
    db.add(rule)
    db.commit()
    db.refresh(rule)

    return rule


@router.put("/category-rules/{rule_id}", response_model=CategoryRuleResponse)
def update_category_rule(
    rule_id: int,
    payload: CategoryRuleUpdate,
    db: Session = Depends(get_db)
):

    rule = db.get(CategoryRule, rule_id)

    if rule is None:
        raise HTTPException(status_code=404, detail="Rule not found")

    _validate_rule_payload(db, payload)

    for field, value in payload.model_dump().items():
        setattr(rule, field, value)

    db.commit()
    db.refresh(rule)

    return rule


@router.post("/category-rules/{rule_id}/move", response_model=list[CategoryRuleResponse])
def move_category_rule(
    rule_id: int,
    payload: CategoryRuleMove,
    db: Session = Depends(get_db)
):

    if payload.direction not in ("up", "down"):
        raise HTTPException(status_code=422, detail="direction must be 'up' or 'down'")

    rules = _list_rules(db)
    index = next((i for i, rule in enumerate(rules) if rule.id == rule_id), None)

    if index is None:
        raise HTTPException(status_code=404, detail="Rule not found")

    swap_with = index - 1 if payload.direction == "up" else index + 1

    if 0 <= swap_with < len(rules):
        current, neighbour = rules[index], rules[swap_with]
        current.priority, neighbour.priority = neighbour.priority, current.priority
        db.commit()

    return _list_rules(db)


@router.delete("/category-rules/{rule_id}", status_code=204)
def delete_category_rule(
    rule_id: int,
    db: Session = Depends(get_db)
):

    rule = db.get(CategoryRule, rule_id)

    if rule is None:
        raise HTTPException(status_code=404, detail="Rule not found")

    # Transactions keep the category the rule gave them, but lose the marker -
    # enforced here rather than via the FK because SQLite does not apply
    # ondelete without PRAGMA foreign_keys=ON.
    (
        db.query(Transaction)
        .filter(Transaction.categorized_by_rule_id == rule_id)
        .update({"categorized_by_rule_id": None}, synchronize_session=False)
    )

    db.delete(rule)
    db.commit()
