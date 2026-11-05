from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..deps import get_db
from ..models import (
    ACCOUNT_TYPES,
    BALANCE_SIGNS,
    Account,
    AccountGroup,
    ImportBatch,
    RecurringDismissal,
    SavingsGoal,
    Transaction,
)
from ..schemas import (
    AccountCoverageResponse,
    AccountCreate,
    AccountMergeRequest,
    AccountMergeResponse,
    AccountResponse,
    AccountUpdate,
    BalanceHistoryResponse,
    BalanceSignInferenceResponse,
    CategoryGridPeriodResponse,
)
from ..services.coverage import account_coverage_gaps
from ..services.ledger import account_balance, account_balances
from ..services.net_worth import group_contributors_by_period, infer_balance_sign
from ..services.reporting import (
    DEFAULT_GRID_MONTHS,
    MAX_GRID_MONTHS,
    chart_period_bounds,
    contiguous_periods,
    default_period,
)
from ..services.trends import account_balance_history

router = APIRouter()


def _label(year: int, month: int) -> str:

    return f"{year:04d}-{month:02d}"


def _serialize_account(account: Account, balance, balance_as_of) -> AccountResponse:

    return AccountResponse.model_validate(account).model_copy(
        update={"balance": balance, "balance_as_of": balance_as_of}
    )


def _validate_account_payload(db: Session, payload):
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

    if payload.group_id is not None and db.get(AccountGroup, payload.group_id) is None:
        raise HTTPException(status_code=404, detail="Account group not found")


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

    _validate_account_payload(db, payload)

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


@router.post("/accounts/merge", response_model=AccountMergeResponse)
def merge_accounts_endpoint(
    payload: AccountMergeRequest,
    db: Session = Depends(get_db)
):
    """Combines one or more duplicate accounts into `target_id`.

    For each transaction in the source accounts:
    - If an identical transaction (matching date, narration, debit, credit,
      and balance) already exists in the target account, the duplicate row
      is removed (after preserving any category/splits/notes on the kept
      target row if the target row was uncategorized).
    - Otherwise, the transaction is moved onto `target_id` and its stored
      `account_number` is updated to match the target account.
    """

    target = db.get(Account, payload.target_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Target account not found")

    unique_source_ids = [
        source_id for source_id in dict.fromkeys(payload.source_ids)
        if source_id != payload.target_id
    ]
    if not unique_source_ids:
        raise HTTPException(
            status_code=422,
            detail="Choose at least one other account to combine into the target",
        )

    sources: list[Account] = []
    for source_id in unique_source_ids:
        source = db.get(Account, source_id)
        if source is None:
            raise HTTPException(status_code=404, detail="Source account not found")
        sources.append(source)

    target_transactions = (
        db.query(Transaction)
        .filter(Transaction.account_id == target.id)
        .order_by(Transaction.id)
        .all()
    )

    def _dup_key(tx: Transaction):
        return (tx.transaction_date, tx.narration, tx.debit, tx.credit, tx.balance)

    target_by_key: dict[tuple, Transaction] = {}
    for tx in target_transactions:
        target_by_key.setdefault(_dup_key(tx), tx)

    source_ids_only = [source.id for source in sources]
    source_transactions = (
        db.query(Transaction)
        .filter(Transaction.account_id.in_(source_ids_only))
        .order_by(Transaction.id)
        .all()
    )

    transactions_moved = 0
    duplicates_removed = 0
    affected_batch_ids: set[int] = set()

    for src_tx in source_transactions:
        key = _dup_key(src_tx)
        existing_tx = target_by_key.get(key)

        if existing_tx is not None:
            if existing_tx.category_id is None and not existing_tx.splits:
                if src_tx.category_id is not None:
                    existing_tx.category_id = src_tx.category_id
                    existing_tx.categorized_by_rule_id = src_tx.categorized_by_rule_id
            if not existing_tx.note and src_tx.note:
                existing_tx.note = src_tx.note
            if src_tx.import_batch_id is not None:
                affected_batch_ids.add(src_tx.import_batch_id)
            db.delete(src_tx)
            duplicates_removed += 1
        else:
            src_tx.account_id = target.id
            src_tx.account_number = target.account_number
            if not src_tx.bsb_number and target.bsb_number:
                src_tx.bsb_number = target.bsb_number
            target_by_key[key] = src_tx
            transactions_moved += 1

    db.flush()

    if affected_batch_ids:
        for batch in db.query(ImportBatch).filter(ImportBatch.id.in_(affected_batch_ids)).all():
            remaining = (
                db.query(Transaction)
                .filter(Transaction.import_batch_id == batch.id)
                .count()
            )
            removed_from_batch = max(0, batch.row_count - remaining)
            batch.row_count = remaining
            batch.skipped_duplicate_count = (batch.skipped_duplicate_count or 0) + removed_from_batch

    db.query(SavingsGoal).filter(SavingsGoal.account_id.in_(source_ids_only)).update(
        {"account_id": target.id}, synchronize_session=False
    )

    target_dismissal_keys = {
        d.narration_key
        for d in db.query(RecurringDismissal).filter(RecurringDismissal.account_id == target.id).all()
    }
    for dismissal in db.query(RecurringDismissal).filter(RecurringDismissal.account_id.in_(source_ids_only)).all():
        if dismissal.narration_key in target_dismissal_keys:
            db.delete(dismissal)
        else:
            dismissal.account_id = target.id
            target_dismissal_keys.add(dismissal.narration_key)

    for source in sources:
        if not target.institution and source.institution:
            target.institution = source.institution
        if not target.account_type and source.account_type:
            target.account_type = source.account_type
            target.balance_sign = source.balance_sign
        if not target.bsb_number and source.bsb_number:
            target.bsb_number = source.bsb_number
        if target.group_id is None and source.group_id is not None:
            target.group_id = source.group_id

    merged_names = [source.name for source in sources]

    db.flush()
    for source in sources:
        db.refresh(source)
        db.delete(source)

    db.commit()
    db.refresh(target)

    balance, balance_as_of = account_balance(db, target.id)
    return AccountMergeResponse(
        target=_serialize_account(target, balance, balance_as_of),
        merged_account_names=merged_names,
        transactions_moved=transactions_moved,
        duplicates_removed=duplicates_removed,
    )


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


@router.get("/accounts/{account_id}/coverage", response_model=AccountCoverageResponse)
def get_account_coverage(
    account_id: int,
    db: Session = Depends(get_db)
):
    """Whether this account's own imported history is provably continuous -
    see services/coverage.py's module docstring for the arithmetic. Never
    crosses into a grouped account's other members (each is checked purely
    on its own transactions), so a group's own succession of accounts never
    reads as a false gap.
    """

    if db.get(Account, account_id) is None:
        raise HTTPException(status_code=404, detail="Account not found")

    gaps = account_coverage_gaps(db, account_id)
    return AccountCoverageResponse(account_id=account_id, gaps=gaps)


@router.put("/accounts/{account_id}", response_model=AccountResponse)
def update_account(
    account_id: int,
    payload: AccountUpdate,
    db: Session = Depends(get_db)
):

    account = db.get(Account, account_id)

    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")

    _validate_account_payload(db, payload)

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

    A GROUPED account instead gets its group's STITCHED history: for each
    period, whichever member was the group's contributor that period (see
    services/net_worth.group_contributors_by_period) - so a reissued card's
    chart is one continuous line across the handover, not a line that
    starts partway through (the replacement) sitting next to one that ends
    partway through (the original). Every member of the same group shows
    this identical stitched series, since they represent one logical
    account regardless of which member's id the page was opened with.
    """

    account = db.get(Account, account_id)

    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")

    year, month = chart_period_bounds(db)
    periods = contiguous_periods(year, month, months)

    history = account_balance_history(db, periods)

    if account.group_id is not None:
        contributors_by_period = group_contributors_by_period(db, periods)
        balances = {
            period: history.get(contributors_by_period[period].get(account.group_id), {}).get(period)
            for period in periods
        }
    else:
        balances = history.get(account_id, {})

    return BalanceHistoryResponse(
        periods=[CategoryGridPeriodResponse(year=y, month=m, label=_label(y, m)) for y, m in periods],
        balances={_label(y, m): balances.get((y, m)) for y, m in periods},
    )
