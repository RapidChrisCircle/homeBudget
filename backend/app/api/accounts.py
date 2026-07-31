from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..deps import get_db
from ..models import Account, Transaction
from ..schemas import AccountCreate, AccountResponse, AccountUpdate

router = APIRouter()


@router.get("/accounts", response_model=list[AccountResponse])
def list_accounts(db: Session = Depends(get_db)):

    return (
        db.query(Account)
        .order_by(Account.name)
        .all()
    )


@router.post("/accounts", response_model=AccountResponse, status_code=201)
def create_account(
    payload: AccountCreate,
    db: Session = Depends(get_db)
):

    account = Account(**payload.model_dump())
    db.add(account)

    try:
        db.commit()

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="An account with this account number already exists")

    db.refresh(account)
    return account


@router.get("/accounts/{account_id}", response_model=AccountResponse)
def get_account(
    account_id: int,
    db: Session = Depends(get_db)
):

    account = db.get(Account, account_id)

    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")

    return account


@router.put("/accounts/{account_id}", response_model=AccountResponse)
def update_account(
    account_id: int,
    payload: AccountUpdate,
    db: Session = Depends(get_db)
):

    account = db.get(Account, account_id)

    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")

    for field, value in payload.model_dump().items():
        setattr(account, field, value)

    try:
        db.commit()

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="An account with this account number already exists")

    db.refresh(account)
    return account


@router.delete("/accounts/{account_id}", status_code=204)
def delete_account(
    account_id: int,
    db: Session = Depends(get_db)
):

    account = db.get(Account, account_id)

    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")

    has_transactions = (
        db.query(Transaction)
        .filter(Transaction.account_id == account_id)
        .first()
        is not None
    )

    if has_transactions:
        raise HTTPException(status_code=409, detail="Cannot delete an account with existing transactions")

    db.delete(account)
    db.commit()
