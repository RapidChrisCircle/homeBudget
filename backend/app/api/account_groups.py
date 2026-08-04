from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..deps import get_db
from ..models import Account, AccountGroup
from ..schemas import AccountGroupCreate, AccountGroupResponse, AccountGroupUpdate

router = APIRouter()


@router.get("/account-groups", response_model=list[AccountGroupResponse])
def list_account_groups(db: Session = Depends(get_db)):

    return (
        db.query(AccountGroup)
        .order_by(AccountGroup.name)
        .all()
    )


@router.post("/account-groups", response_model=AccountGroupResponse, status_code=201)
def create_account_group(
    payload: AccountGroupCreate,
    db: Session = Depends(get_db)
):

    group = AccountGroup(name=payload.name)
    db.add(group)
    db.commit()
    db.refresh(group)

    return group


@router.put("/account-groups/{group_id}", response_model=AccountGroupResponse)
def update_account_group(
    group_id: int,
    payload: AccountGroupUpdate,
    db: Session = Depends(get_db)
):

    group = db.get(AccountGroup, group_id)

    if group is None:
        raise HTTPException(status_code=404, detail="Account group not found")

    group.name = payload.name
    db.commit()
    db.refresh(group)

    return group


@router.delete("/account-groups/{group_id}", status_code=204)
def delete_account_group(
    group_id: int,
    db: Session = Depends(get_db)
):
    """Unlinks every member account rather than deleting them - a group is
    just a succession label over otherwise-ordinary accounts (see
    AccountGroup's own docstring in models.py). Enforced explicitly here,
    not left to the FK's ondelete=SET NULL, since SQLite ignores ondelete
    without PRAGMA foreign_keys=ON - the same reasoning as every other
    cascade in this codebase.
    """

    group = db.get(AccountGroup, group_id)

    if group is None:
        raise HTTPException(status_code=404, detail="Account group not found")

    db.query(Account).filter(Account.group_id == group_id).update(
        {"group_id": None}, synchronize_session=False
    )

    db.delete(group)
    db.commit()
