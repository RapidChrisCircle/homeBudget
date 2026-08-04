from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..deps import get_db
from ..models import ACCOUNT_TYPES, BALANCE_SIGNS, Account, SavingsGoal, Transaction
from ..schemas import (
    AccountCreate,
    AccountResponse,
    AccountUpdate,
    BalanceHistoryResponse,
    BalanceSignInferenceResponse,
    CategoryGridPeriodResponse,
)
from ..services.ledger import account_balance, account_balances
from ..services.net_worth import infer_balance_sign
from ..services.reporting import DEFAULT_GRID_MONTHS, MAX_GRID_MONTHS, contiguous_periods, default_period
from ..services.trends import account_balance_history

router = APIRouter()


def _label(year: int, month: int) -> str:

    return f"{year:04d}-{month:02d}"


def _serialize_account(account: Account, balance, balance_as_of) -> AccountResponse:

    return AccountResponse.model_validate(account).model_copy(
        update={"balance": balance, "balance_as_of": balance_as_of}
    )


def _validate_account_payload(payload):
    """account_type NULL/unset means "unclassified" and is always allowed -
    see ACCOUNT_TYPES's own comment in models.py for why that's a valid,
    deliberate state rather than something to reject. Only a NON-null value
    outside the known six is rejected.
    """

    if payload.account_type is not None and payload.account_type not in ACCOUNT_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"account_type must be one of: {', '.join(ACCOUNT_TYPES)}",
        )

    if payload.balance_sign not in BALANCE_SIGNS:
        raise HTTPException(
            status_code=422,
            detail=f"balance_sign must be one of: {', '.join(BALANCE_SIGNS)}",
        )


@router.get("/accounts", response_model=list[AccountResponse])
def list_accounts(db: Session = Depends(get_db)):

    accounts = (
        db.query(Account)
        .order_by(Account.name)
        .all()
    )

    # One window-function query for the whole list, not N per-account queries.
    balances = account_balances(db)

    return [
        _serialize_account(account, *balances.get(account.id, (None, None)))
        for account in accounts
    ]


@router.post("/accounts", response_model=AccountResponse, status_code=201)
def create_account(
    payload: AccountCreate,
    db: Session = Depends(get_db)
):

    _validate_account_payload(payload)

    account = Account(**payload.model_dump())
    db.add(account)

    try:
        db.commit()

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="An account with this account number already exists")

    db.refresh(account)
    # A brand new account has no transactions yet, so no balance - not queried.
    return _serialize_account(account, None, None)


@router.get("/accounts/{account_id}", response_model=AccountResponse)
def get_account(
    account_id: int,
    db: Session = Depends(get_db)
):

    account = db.get(Account, account_id)

    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")

    balance, balance_as_of = account_balance(db, account_id)
    return _serialize_account(account, balance, balance_as_of)


@router.get("/accounts/{account_id}/infer-balance-sign", response_model=BalanceSignInferenceResponse)
def infer_account_balance_sign(
    account_id: int,
    db: Session = Depends(get_db)
):
    """A suggestion for the Accounts page to pre-fill when classifying an
    account as a liability - never applied automatically. See
    services/net_worth.infer_balance_sign for the actual heuristic.
    """

    if db.get(Account, account_id) is None:
        raise HTTPException(status_code=404, detail="Account not found")

    inferred_sign, sample_size = infer_balance_sign(db, account_id)
    return BalanceSignInferenceResponse(inferred_sign=inferred_sign, sample_size=sample_size)


@router.put("/accounts/{account_id}", response_model=AccountResponse)
def update_account(
    account_id: int,
    payload: AccountUpdate,
    db: Session = Depends(get_db)
):

    account = db.get(Account, account_id)

    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")

    _validate_account_payload(payload)

    for field, value in payload.model_dump().items():
        setattr(account, field, value)

    try:
        db.commit()

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="An account with this account number already exists")

    db.refresh(account)
    balance, balance_as_of = account_balance(db, account_id)
    return _serialize_account(account, balance, balance_as_of)


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

    # A goal survives its account being deleted, just unlinked - see
    # SavingsGoal's own docstring in models.py (ondelete="SET NULL", not
    # CASCADE). Enforced explicitly here rather than left to the FK, the
    # same SQLite-ignores-ondelete reason every other cascade in this
    # codebase is explicit too.
    db.query(SavingsGoal).filter(SavingsGoal.account_id == account_id).update(
        {"account_id": None}, synchronize_session=False
    )

    db.delete(account)
    db.commit()


@router.get("/accounts/{account_id}/balance-history", response_model=BalanceHistoryResponse)
def get_account_balance_history(
    account_id: int,
    months: int = Query(DEFAULT_GRID_MONTHS, ge=1, le=MAX_GRID_MONTHS),
    db: Session = Depends(get_db)
):
    """Closing balance per month for one account, ending at the ledger's
    default period (the most recent month with any transactions). Computed
    across every account in one query (services.trends.account_balance_history),
    then this endpoint reads off just the requested account - see that
    function's docstring for why a month with no transactions carries the
    previous month's balance forward rather than showing a gap or a zero.
    """

    if db.get(Account, account_id) is None:
        raise HTTPException(status_code=404, detail="Account not found")

    year, month = default_period(db)
    periods = contiguous_periods(year, month, months)

    history = account_balance_history(db, periods)
    balances = history.get(account_id, {})

    return BalanceHistoryResponse(
        periods=[CategoryGridPeriodResponse(year=y, month=m, label=_label(y, m)) for y, m in periods],
        balances={_label(y, m): balances.get((y, m)) for y, m in periods},
    )
