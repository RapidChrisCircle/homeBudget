from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..deps import get_db
from ..models import GOAL_MODES, Account, SavingsGoal
from ..schemas import (
    AccountEnvelopeSummaryResponse,
    GoalCreate,
    GoalListResponse,
    GoalResponse,
    GoalUpdate,
)
from ..services.goals import account_envelope_summaries, goal_progress

router = APIRouter()


def _validate_goal_payload(db: Session, payload):
    """mode decides which of account_id/allocated_amount actually matter -
    see SavingsGoal's own docstring in models.py. The irrelevant one is
    coerced to null rather than left as whatever the client sent, the same
    pattern _validate_category_payload uses for a budget on a non-expense
    category - avoids an edit-order trap where switching modes requires
    clearing the other field first.
    """

    if payload.target_amount <= 0:
        raise HTTPException(status_code=422, detail="target_amount must be a positive dollar value")

    if payload.mode not in GOAL_MODES:
        raise HTTPException(status_code=422, detail=f"mode must be one of: {', '.join(GOAL_MODES)}")

    if payload.mode == "account_balance":

        if payload.account_id is None:
            raise HTTPException(status_code=422, detail="account_balance mode requires an account_id")

        payload.allocated_amount = None

    else:

        if payload.allocated_amount is None or payload.allocated_amount < 0:
            raise HTTPException(
                status_code=422,
                detail="envelope mode requires a non-negative allocated_amount",
            )

    if payload.account_id is not None and db.get(Account, payload.account_id) is None:
        raise HTTPException(status_code=404, detail="Account not found")


def _serialize_goal(db: Session, goal: SavingsGoal) -> GoalResponse:

    progress = goal_progress(db, goal)

    return GoalResponse(
        id=goal.id,
        name=goal.name,
        target_amount=goal.target_amount,
        target_date=goal.target_date,
        mode=goal.mode,
        account_id=goal.account_id,
        account_name=goal.account.name if goal.account is not None else None,
        allocated_amount=goal.allocated_amount,
        archived=goal.archived,
        **progress,
    )


@router.get("/goals", response_model=GoalListResponse)
def list_goals(include_archived: bool = False, db: Session = Depends(get_db)):

    query = db.query(SavingsGoal)

    if not include_archived:
        query = query.filter(SavingsGoal.archived.is_(False))

    goals = query.order_by(SavingsGoal.name).all()

    # account_envelope_summaries() already filters out archived goals
    # itself (see services/goals.py) - passing `goals` as-is here is
    # correct regardless of include_archived, since an archived goal is
    # excluded by that filter either way and never counts toward
    # allocation.
    return GoalListResponse(
        goals=[_serialize_goal(db, goal) for goal in goals],
        account_envelope_summaries=[
            AccountEnvelopeSummaryResponse(**summary)
            for summary in account_envelope_summaries(db, goals)
        ],
    )


@router.post("/goals", response_model=GoalResponse, status_code=201)
def create_goal(payload: GoalCreate, db: Session = Depends(get_db)):

    _validate_goal_payload(db, payload)

    goal = SavingsGoal(**payload.model_dump())
    db.add(goal)
    db.commit()
    db.refresh(goal)

    return _serialize_goal(db, goal)


@router.put("/goals/{goal_id}", response_model=GoalResponse)
def update_goal(goal_id: int, payload: GoalUpdate, db: Session = Depends(get_db)):

    goal = db.get(SavingsGoal, goal_id)

    if goal is None:
        raise HTTPException(status_code=404, detail="Goal not found")

    _validate_goal_payload(db, payload)

    for field, value in payload.model_dump().items():
        setattr(goal, field, value)

    db.commit()
    db.refresh(goal)

    return _serialize_goal(db, goal)


@router.post("/goals/{goal_id}/archive", response_model=GoalResponse)
def archive_goal(goal_id: int, db: Session = Depends(get_db)):
    """Archiving is not deleting - see Category.archived's docstring in
    models.py for the same reversible-hide pattern this mirrors. An
    archived goal also stops counting toward its account's envelope
    allocation total (services.goals.account_envelope_summaries), since it
    no longer represents a real commitment.
    """

    goal = db.get(SavingsGoal, goal_id)

    if goal is None:
        raise HTTPException(status_code=404, detail="Goal not found")

    goal.archived = True
    db.commit()
    db.refresh(goal)

    return _serialize_goal(db, goal)


@router.post("/goals/{goal_id}/restore", response_model=GoalResponse)
def restore_goal(goal_id: int, db: Session = Depends(get_db)):

    goal = db.get(SavingsGoal, goal_id)

    if goal is None:
        raise HTTPException(status_code=404, detail="Goal not found")

    goal.archived = False
    db.commit()
    db.refresh(goal)

    return _serialize_goal(db, goal)


@router.delete("/goals/{goal_id}", status_code=204)
def delete_goal(goal_id: int, db: Session = Depends(get_db)):

    goal = db.get(SavingsGoal, goal_id)

    if goal is None:
        raise HTTPException(status_code=404, detail="Goal not found")

    db.delete(goal)
    db.commit()
