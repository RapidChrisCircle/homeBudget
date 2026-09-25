from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from pydantic import ValidationError
from sqlalchemy.orm import Session

from ..deps import get_db
from ..models import CATEGORY_KINDS, Account, Category, ImportBatch, Transaction, TransactionSplit
from ..schemas import (
    BulkCategoryUpdate,
    CsvColumnMappingInput,
    CsvImportPreviewResponse,
    CsvPreviewRowResponse,
    ImportBatchResponse,
    ImportResultResponse,
    TransactionCategoryUpdate,
    TransactionCreate,
    TransactionGroupListResponse,
    TransactionListResponse,
    TransactionNoteUpdate,
    TransactionResponse,
    TransactionSplitsUpdate,
    TransactionUpdate,
)
from ..services.categorization import apply_rules_to_transaction, load_rules
from ..services.csv_formats import ColumnMapping, validate_mapping_input
from ..services.export import ledger_csv
from ..services.csv_import import (
    CsvValidationError,
    UnrecognizedFormatError,
    import_rows,
    parse_and_validate,
    preview_import,
)
from ..services.ledger import (
    DEFAULT_PAGE_SIZE,
    LIST_LOADERS,
    MAX_PAGE_SIZE,
    SORTABLE_COLUMNS,
    TransactionFilters,
    account_balance,
    build_transaction_query,
    ledger_totals,
    paginate,
    transaction_group_totals,
    transaction_groups,
)

router = APIRouter()

# The single ImportBatch every manual transaction (POST /transactions)
# belongs to - Transaction.import_batch_id is NOT NULL, so a hand-entered
# row needs one the same as an imported one does. Reused across every
# manual entry rather than a fresh batch per transaction, so a household
# adding cash spend a few times a week doesn't flood the Import card's
# batch history with one-row batches - and it makes "delete every manual
# entry at once" a real, visible action (DELETE /import-batches/{id} on
# this one, same as any other batch) rather than a hidden special case.
MANUAL_BATCH_FILENAME = "Manually added"

# The built-in format's own convention (see README's Importing section) -
# used to default a manual entry's transaction_type when left blank, so a
# hand-entered row never has to invent a value the app has no opinion
# about, and reads consistently with transactions that DO come from that
# built-in layout.
_DEFAULT_DEBIT_TYPE = "WDL"
_DEFAULT_CREDIT_TYPE = "DEP"


def _get_or_create_manual_batch(db: Session) -> ImportBatch:

    batch = db.query(ImportBatch).filter(ImportBatch.filename == MANUAL_BATCH_FILENAME).first()

    if batch is None:
        batch = ImportBatch(
            filename=MANUAL_BATCH_FILENAME, row_count=0, skipped_duplicate_count=0, skipped_authorisation_count=0
        )
        db.add(batch)
        db.flush()

    return batch


def _validate_positive_signed_amount(debit: Decimal | None, credit: Decimal | None) -> None:
    """Mirrors the CSV import invariant that exactly one of debit/credit is
    ever populated (services/csv_import.py) - but unlike an imported row,
    which stores whatever sign the bank's own file happened to use, a
    manual entry's two fields are deliberately POSITIVE dollar amounts (a
    "money out" / "money in" pair) so a user typing a $45 coffee purchase
    never has to remember to type it as -45.00 - see TransactionCreate's
    own docstring.
    """

    if (debit is None) == (credit is None):
        raise HTTPException(status_code=422, detail="Provide exactly one of debit or credit, not both")

    amount = debit if debit is not None else credit

    if amount <= 0:
        raise HTTPException(status_code=422, detail="Amount must be a positive dollar value")


def _signed_amount_and_type(debit: Decimal | None, credit: Decimal | None, transaction_type: str | None):
    """(signed_debit, signed_credit, transaction_type) from a
    TransactionCreate/TransactionUpdate's positive debit/credit pair -
    applies the actual storage convention (debit NEGATIVE, credit
    positive) exactly once, so create and update can't apply it two
    slightly different ways.
    """

    if debit is not None:
        return -debit, None, (transaction_type or "").strip() or _DEFAULT_DEBIT_TYPE

    return None, credit, (transaction_type or "").strip() or _DEFAULT_CREDIT_TYPE


def _validate_assignable_category(db: Session, category_id: int | None) -> None:
    """A transaction can only be assigned to a LEAF category - never one
    that has children. Parents are grouping only (see api/categories.py's
    module docstring); letting one be assigned directly would make "the
    total for this parent" ambiguous between its own direct transactions
    and its children's, which is exactly the roll-up question this feature
    deliberately doesn't take on.
    """

    if category_id is None:
        return

    category = db.get(Category, category_id)

    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")

    if category.children:
        raise HTTPException(
            status_code=422,
            detail=(
                "This category has sub-categories and cannot be assigned directly - "
                "choose one of its sub-categories instead"
            ),
        )


def _column_mapping_from_input(payload: CsvColumnMappingInput) -> ColumnMapping:

    return ColumnMapping(
        institution=payload.institution,
        date_format=payload.date_format,
        amount_mode=payload.amount_mode,
        bsb_index=payload.bsb_index,
        account_number_index=payload.account_number_index,
        transaction_date_index=payload.transaction_date_index,
        narration_index=payload.narration_index,
        cheque_number_index=payload.cheque_number_index,
        debit_index=payload.debit_index,
        credit_index=payload.credit_index,
        amount_index=payload.amount_index,
        balance_index=payload.balance_index,
        transaction_type_index=payload.transaction_type_index,
    )


@router.post("/transactions/import", response_model=ImportResultResponse, status_code=201)
def import_transactions(
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):

    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv file")

    content = file.file.read()

    try:
        mapping, rows, skipped_authorisation_count = parse_and_validate(db, content)

    except UnrecognizedFormatError as exc:
        # Distinct from the row-validation shape below via needs_mapping -
        # the frontend uses that flag to open the mapping panel instead of
        # showing a flat error list. header/sample_rows are what the panel
        # needs to build itself (dropdowns populated from the file's own
        # column names, plus a peek at real data).
        raise HTTPException(
            status_code=422,
            detail={
                "detail": "Unrecognized CSV format - map its columns to import it",
                "needs_mapping": True,
                "header": exc.header,
                "sample_rows": exc.sample_rows,
            },
        )

    except CsvValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "detail": "CSV import rejected: one or more rows are invalid",
                "errors": [{"row_number": n, "message": m} for n, m in exc.errors],
            },
        )

    batch, new_account_count, auto_categorized_count = import_rows(
        db, filename=file.filename, mapping=mapping, rows=rows,
        skipped_authorisation_count=skipped_authorisation_count,
    )

    return ImportResultResponse(
        batch=ImportBatchResponse.model_validate(batch),
        imported_count=batch.row_count,
        skipped_duplicate_count=batch.skipped_duplicate_count,
        skipped_authorisation_count=batch.skipped_authorisation_count,
        new_account_count=new_account_count,
        auto_categorized_count=auto_categorized_count,
    )


@router.post("/transactions/import/preview", response_model=CsvImportPreviewResponse)
def preview_transaction_import(
    file: UploadFile = File(...),
    mapping_json: str = Form(...),
    db: Session = Depends(get_db)
):
    """Parses with the caller's own candidate mapping - not necessarily
    saved, not even necessarily valid yet - and returns a HANDFUL of
    resulting rows plus any errors. Writes nothing regardless of outcome,
    so this is safe to call repeatedly while the mapping UI's column
    choices are still being adjusted. See services.csv_import.preview_import
    for the parsing side of this; saving a mapping for real is a separate
    step (POST /csv-formats), never a side effect of previewing it.
    """

    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv file")

    try:
        payload = CsvColumnMappingInput.model_validate_json(mapping_json)

    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=f"invalid mapping: {exc}")

    error = validate_mapping_input(payload)
    if error:
        raise HTTPException(status_code=422, detail=error)

    mapping = _column_mapping_from_input(payload)
    content = file.file.read()

    rows, errors, skipped_authorisation_count = preview_import(db, content, mapping)

    return CsvImportPreviewResponse(
        rows=[CsvPreviewRowResponse(**vars(row)) for row in rows],
        errors=[{"row_number": n, "message": m} for n, m in errors],
        skipped_authorisation_count=skipped_authorisation_count,
    )


def _validated_ledger_query(
    db: Session,
    *,
    account_id: int | None,
    account_group_id: int | None,
    category_id: int | None,
    uncategorized: bool,
    kind: str | None,
    date_from: date | None,
    date_to: date | None,
    search: str | None,
    transaction_type: str | None,
    min_amount: Decimal | None,
    max_amount: Decimal | None,
    sort: str | None,
    direction: str,
):
    """The validation and query-building GET /transactions and
    GET /transactions/export share - factored out so an export can never
    silently accept a filter combination the ledger view itself would have
    rejected, or vice versa. Returns the built, unpaginated query.
    """

    # Contradictory combinations are rejected rather than silently returning
    # nothing - an empty ledger looks like "no matching transactions", which
    # hides the mistake instead of surfacing it.
    if uncategorized and category_id is not None:
        raise HTTPException(
            status_code=422,
            detail="uncategorized and category_id are contradictory - use one or the other",
        )

    if uncategorized and kind is not None:
        raise HTTPException(
            status_code=422,
            detail="uncategorized and kind are contradictory - an uncategorized transaction has no kind",
        )

    if kind is not None and kind not in CATEGORY_KINDS:
        raise HTTPException(status_code=422, detail=f"kind must be one of: {', '.join(CATEGORY_KINDS)}")

    if account_id is not None and account_group_id is not None:
        raise HTTPException(
            status_code=422,
            detail="account_id and account_group_id are contradictory - use one or the other",
        )

    if date_from is not None and date_to is not None and date_from > date_to:
        raise HTTPException(
            status_code=422,
            detail="date_from must not be after date_to",
        )

    if min_amount is not None and max_amount is not None and min_amount > max_amount:
        raise HTTPException(
            status_code=422,
            detail="min_amount must not be greater than max_amount",
        )

    # Sorting this endpoint client-side would silently sort only the current
    # page - see build_transaction_query's own docstring for why the whole
    # result set is sorted in SQL instead. An unrecognized column or
    # direction is rejected rather than silently falling back to the
    # default order, which would look like "sorting did nothing".
    if sort is not None and sort not in SORTABLE_COLUMNS:
        raise HTTPException(
            status_code=422,
            detail=f"sort must be one of: {', '.join(SORTABLE_COLUMNS)}",
        )

    if direction not in ("asc", "desc"):
        raise HTTPException(
            status_code=422,
            detail="direction must be 'asc' or 'desc'",
        )

    filters = TransactionFilters(
        account_id=account_id,
        account_group_id=account_group_id,
        category_id=category_id,
        uncategorized=uncategorized,
        kind=kind,
        date_from=date_from,
        date_to=date_to,
        search=search,
        transaction_type=transaction_type,
        min_amount=min_amount,
        max_amount=max_amount,
    )

    return build_transaction_query(db, filters, sort=sort, direction=direction)


@router.get("/transactions", response_model=TransactionListResponse)
def list_transactions(
    account_id: int | None = None,
    account_group_id: int | None = None,
    category_id: int | None = None,
    uncategorized: bool = False,
    kind: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
    transaction_type: str | None = None,
    # Amounts are POSITIVE dollars compared against an absolute value (see
    # services/ledger.py) - a negative bound is a client bug, not a query.
    min_amount: Decimal | None = Query(None, ge=0),
    max_amount: Decimal | None = Query(None, ge=0),
    sort: str | None = None,
    direction: str = "asc",
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db)
):

    query = _validated_ledger_query(
        db,
        account_id=account_id, account_group_id=account_group_id, category_id=category_id,
        uncategorized=uncategorized, kind=kind, date_from=date_from, date_to=date_to,
        search=search, transaction_type=transaction_type, min_amount=min_amount, max_amount=max_amount,
        sort=sort, direction=direction,
    )
    items, total = paginate(query, page=page, page_size=page_size, options=LIST_LOADERS)
    total_in, total_out, net_total = ledger_totals(query)

    return TransactionListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=max(1, -(-total // page_size)),
        total_in=total_in,
        total_out=total_out,
        net_total=net_total,
    )


# Static path, declared before /transactions/{transaction_id} for the same
# ordering reason as /transactions/types and /transactions/groups below -
# though GET has no {transaction_id} route to collide with today, this
# keeps the file's own convention rather than being the one exception to it.
@router.get("/transactions/export")
def export_transactions(
    account_id: int | None = None,
    account_group_id: int | None = None,
    category_id: int | None = None,
    uncategorized: bool = False,
    kind: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
    transaction_type: str | None = None,
    min_amount: Decimal | None = Query(None, ge=0),
    max_amount: Decimal | None = Query(None, ge=0),
    sort: str | None = None,
    direction: str = "asc",
    db: Session = Depends(get_db)
):
    """The filtered ledger as a CSV download - exactly the rows GET
    /transactions would return for the SAME query params (this validates
    and builds its query through the identical _validated_ledger_query the
    list endpoint uses), with no pagination: an export is precisely the
    case where "everything I filtered to" must not be cut down to one page.

    NOT designed to round-trip back through import - see services/export.py's
    module docstring for why (a different header than any bank layout, plus
    Category/Note/split detail no bank format has a column for). This is
    the "send it to the accountant" export; services/export.database_snapshot
    (GET /export/database) is the backup case.
    """

    query = _validated_ledger_query(
        db,
        account_id=account_id, account_group_id=account_group_id, category_id=category_id,
        uncategorized=uncategorized, kind=kind, date_from=date_from, date_to=date_to,
        search=search, transaction_type=transaction_type, min_amount=min_amount, max_amount=max_amount,
        sort=sort, direction=direction,
    )

    csv_text = ledger_csv(query)

    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="transactions.csv"'},
    )


@router.get("/transactions/types", response_model=list[str])
def list_transaction_types(db: Session = Depends(get_db)):
    """Distinct transaction_type values seen in the ledger (e.g. DEP/WDL/TFD),
    used to populate the Transaction type dropdown on the Rules page and the
    ledger's own Type filter, rather than leaving it as free text.

    transaction_type is NOT NULL, so isnot(None) alone was once sufficient -
    but a mapped CSV format (services/csv_formats.py) can leave its
    transaction_type_index unset for a bank export with no such column, and
    that stores "" (services/csv_import.py), never None. Excluding "" here
    too is what keeps a blank option out of both dropdowns.
    """

    rows = (
        db.query(Transaction.transaction_type)
        .filter(Transaction.transaction_type.isnot(None), Transaction.transaction_type != "")
        .distinct()
        .order_by(Transaction.transaction_type)
        .all()
    )

    return [row[0] for row in rows]


@router.get("/transactions/groups", response_model=TransactionGroupListResponse)
def list_transaction_groups(
    account_id: int | None = None,
    account_group_id: int | None = None,
    category_id: int | None = None,
    uncategorized: bool = False,
    kind: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
    transaction_type: str | None = None,
    min_amount: Decimal | None = Query(None, ge=0),
    max_amount: Decimal | None = Query(None, ge=0),
    include_categorized: bool = False,
    db: Session = Depends(get_db)
):
    """Rows grouped by merchant, scoped to the same filters the ledger itself
    accepts (see services/ledger.transaction_groups).

    By default (include_categorized=False) a group is always uncategorized
    regardless of what account_group_id/category_id/uncategorized were
    passed - services.ledger.transaction_groups overrides them the same way
    it always has. include_categorized=True (the ledger's Group by merchant
    toggle) is what makes them matter: without accepting and forwarding
    them here, a caller with "Uncategorized only" or an account group
    applied would see groups spanning rows outside that filter, and a
    group's own "categorize all N" could reach a row the caller couldn't
    actually see - exactly the guarantee transaction_groups' own docstring
    promises and this endpoint used to silently break for these three.
    """

    # Same contradiction checks list_transactions applies, for the same
    # reason: a 422 surfaces the mistake instead of quietly grouping the
    # wrong rows.
    if uncategorized and category_id is not None:
        raise HTTPException(
            status_code=422,
            detail="uncategorized and category_id are contradictory - use one or the other",
        )

    if uncategorized and kind is not None:
        raise HTTPException(
            status_code=422,
            detail="uncategorized and kind are contradictory - an uncategorized transaction has no kind",
        )

    if kind is not None and kind not in CATEGORY_KINDS:
        raise HTTPException(status_code=422, detail=f"kind must be one of: {', '.join(CATEGORY_KINDS)}")

    if account_id is not None and account_group_id is not None:
        raise HTTPException(
            status_code=422,
            detail="account_id and account_group_id are contradictory - use one or the other",
        )

    if date_from is not None and date_to is not None and date_from > date_to:
        raise HTTPException(
            status_code=422,
            detail="date_from must not be after date_to",
        )

    if min_amount is not None and max_amount is not None and min_amount > max_amount:
        raise HTTPException(
            status_code=422,
            detail="min_amount must not be greater than max_amount",
        )

    filters = TransactionFilters(
        account_id=account_id,
        account_group_id=account_group_id,
        category_id=category_id,
        uncategorized=uncategorized,
        kind=kind,
        date_from=date_from,
        date_to=date_to,
        search=search,
        transaction_type=transaction_type,
        min_amount=min_amount,
        max_amount=max_amount,
    )

    total_in, total_out, net_total = transaction_group_totals(db, filters, include_categorized=include_categorized)

    return TransactionGroupListResponse(
        groups=transaction_groups(db, filters, include_categorized=include_categorized),
        total_in=total_in,
        total_out=total_out,
        net_total=net_total,
    )


@router.post("/transactions", response_model=TransactionResponse, status_code=201)
def create_transaction(payload: TransactionCreate, db: Session = Depends(get_db)):
    """Records a transaction by hand - cash spending, a reimbursement, or
    anything else that hasn't (yet, or ever will) come from a bank export.
    See README's Importing section for pairing this with a dedicated cash
    account (any Account works - POST /accounts creates one with whatever
    account_number you choose).

    Unlike an imported row, there is no bank-reported balance to trust:
    Transaction.balance is instead COMPUTED here as the account's current
    latest balance (services.ledger.account_balance - the same "most
    recent by (date, id)" resolution the rest of the app already uses for
    "the account's balance") plus this row's own signed amount. That
    computation is only correct if this row BECOMES the new latest
    transaction, so a manual entry must be dated on or after the account's
    current latest one - inserting it into the middle of real bank history
    would leave every later imported row's own balance silently
    inconsistent with what the bank actually reported, with no way to fix
    it short of recomputing balances the bank never gave us in the first
    place.
    """

    account = db.get(Account, payload.account_id)

    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")

    _validate_positive_signed_amount(payload.debit, payload.credit)
    _validate_assignable_category(db, payload.category_id)

    previous_balance, latest_date = account_balance(db, account.id)

    if latest_date is not None and payload.transaction_date < latest_date:
        raise HTTPException(
            status_code=422,
            detail=(
                "Manual transactions must be dated on or after this account's latest transaction "
                f"({latest_date.isoformat()}) - a hand-entered row can only extend the ledger forward, "
                "never be inserted into its middle"
            ),
        )

    debit, credit, transaction_type = _signed_amount_and_type(payload.debit, payload.credit, payload.transaction_type)
    new_balance = (previous_balance or Decimal(0)) + (debit or Decimal(0)) + (credit or Decimal(0))

    batch = _get_or_create_manual_batch(db)

    transaction = Transaction(
        import_batch_id=batch.id,
        account_id=account.id,
        bsb_number=account.bsb_number,
        account_number=account.account_number,
        transaction_date=payload.transaction_date,
        narration=payload.narration,
        debit=debit,
        credit=credit,
        balance=new_balance,
        transaction_type=transaction_type,
        category_id=payload.category_id,
        note=payload.note,
        is_manual=True,
    )

    # Matches import's own behaviour: a row with no explicit category is
    # eligible for auto-categorization the moment it exists, not just once
    # "Apply rules now" is next clicked - a manual entry with an obvious
    # rule match shouldn't need a second action to land where the rest of
    # its merchant's transactions already do.
    if payload.category_id is None:
        apply_rules_to_transaction(load_rules(db), transaction)

    db.add(transaction)
    batch.row_count += 1
    db.commit()
    db.refresh(transaction)

    return transaction


@router.put("/transactions/{transaction_id}", response_model=TransactionResponse)
def update_transaction(transaction_id: int, payload: TransactionUpdate, db: Session = Depends(get_db)):
    """Edits a manual transaction's own fields - date, narration, amount,
    category, note, type. An IMPORTED row's fields are the bank's own
    record and are never editable this way (only via category/note/splits,
    exactly as before this endpoint existed) - see Transaction.is_manual's
    own docstring.

    The account never changes (there is no account_id in TransactionUpdate)
    - moving a manual row to a different account is a balance recomputation
    on TWO accounts' sequences at once, which delete-and-recreate already
    covers with far less risk of leaving either sequence inconsistent.

    Balance is recomputed exactly like creation: the account's latest
    balance EXCLUDING this row, plus this row's own new signed amount - so
    the same "must still be the latest" rule applies, now measured against
    every OTHER transaction on the account.
    """

    transaction = db.get(Transaction, transaction_id)

    if transaction is None:
        raise HTTPException(status_code=404, detail="Transaction not found")

    if not transaction.is_manual:
        raise HTTPException(
            status_code=422,
            detail="Only manually entered transactions can be edited this way - "
            "an imported row's fields are the bank's own record",
        )

    _validate_positive_signed_amount(payload.debit, payload.credit)
    _validate_assignable_category(db, payload.category_id)

    # account_balance() would happily return THIS row's own current balance
    # if it is still the account's latest - excluded explicitly (id !=)
    # since re-saving a transaction against its own prior balance would be
    # circular the moment its amount actually changes.
    other_latest_row = (
        db.query(Transaction)
        .filter(Transaction.account_id == transaction.account_id, Transaction.id != transaction.id)
        .order_by(Transaction.transaction_date.desc(), Transaction.id.desc())
        .first()
    )

    if other_latest_row is not None and payload.transaction_date < other_latest_row.transaction_date:
        raise HTTPException(
            status_code=422,
            detail=(
                "Manual transactions must be dated on or after this account's other latest transaction "
                f"({other_latest_row.transaction_date.isoformat()})"
            ),
        )

    previous_balance = Decimal(other_latest_row.balance) if other_latest_row is not None else Decimal(0)

    debit, credit, transaction_type = _signed_amount_and_type(payload.debit, payload.credit, payload.transaction_type)

    transaction.transaction_date = payload.transaction_date
    transaction.narration = payload.narration
    transaction.debit = debit
    transaction.credit = credit
    transaction.balance = previous_balance + (debit or Decimal(0)) + (credit or Decimal(0))
    transaction.transaction_type = transaction_type
    transaction.category_id = payload.category_id
    transaction.categorized_by_rule_id = None
    transaction.note = payload.note

    db.commit()
    db.refresh(transaction)

    return transaction


@router.patch("/transactions/{transaction_id}/category", response_model=TransactionResponse)
def update_transaction_category(
    transaction_id: int,
    payload: TransactionCategoryUpdate,
    db: Session = Depends(get_db)
):

    transaction = db.get(Transaction, transaction_id)

    if transaction is None:
        raise HTTPException(status_code=404, detail="Transaction not found")

    _validate_assignable_category(db, payload.category_id)

    # Setting a category by hand makes it permanent - clearing the rule
    # marker takes this transaction out of scope for future rule runs.
    transaction.category_id = payload.category_id
    transaction.categorized_by_rule_id = None
    # Directly categorizing supersedes any existing split - a transaction is
    # either unsplit-with-its-own-category or split-into-N-rows, never both
    # (see TransactionSplit's docstring). ORM-level clear (not a bulk
    # delete) so the cascade/delete-orphan relationship handles it.
    transaction.splits = []
    db.commit()
    db.refresh(transaction)

    return transaction


@router.post("/transactions/bulk-category")
def bulk_update_transaction_category(
    payload: BulkCategoryUpdate,
    db: Session = Depends(get_db)
):

    _validate_assignable_category(db, payload.category_id)

    # Bulk-assigning supersedes any existing split on the affected rows, the
    # same reason the single-transaction PATCH above clears them - a bulk
    # query, not an ORM delete, so the cascade/delete-orphan relationship
    # doesn't fire and this has to be explicit.
    db.query(TransactionSplit).filter(TransactionSplit.transaction_id.in_(payload.transaction_ids)).delete(
        synchronize_session=False
    )

    updated = (
        db.query(Transaction)
        .filter(Transaction.id.in_(payload.transaction_ids))
        .update(
            {"category_id": payload.category_id, "categorized_by_rule_id": None},
            synchronize_session=False
        )
    )
    db.commit()

    return {"updated_count": updated}


@router.put("/transactions/{transaction_id}/splits", response_model=TransactionResponse)
def update_transaction_splits(
    transaction_id: int,
    payload: TransactionSplitsUpdate,
    db: Session = Depends(get_db)
):
    """Replaces a transaction's full set of splits. An empty list is the
    "un-split" action - it reverts to a single, uncategorized transaction
    (there is no unambiguous single category to fall back to), skipping the
    sum check below entirely rather than failing it against zero.

    Otherwise the splits must sum EXACTLY to the transaction's own signed
    amount - see TransactionSplit's docstring in models.py for why a
    partial allocation can never be allowed to save: every report reads
    through services/allocations.py, which trusts that invariant rather
    than re-deriving or re-checking it on every read.
    """

    transaction = db.get(Transaction, transaction_id)

    if transaction is None:
        raise HTTPException(status_code=404, detail="Transaction not found")

    if payload.splits:

        transaction_amount = (transaction.debit or Decimal(0)) + (transaction.credit or Decimal(0))
        split_total = sum((s.amount for s in payload.splits), Decimal(0))

        if split_total != transaction_amount:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Splits must sum to the transaction's amount "
                    f"({transaction_amount}), got {split_total}"
                ),
            )

        for split in payload.splits:
            _validate_assignable_category(db, split.category_id)

    # ORM-level replace (not a bulk delete + bulk insert) so the
    # cascade/delete-orphan relationship removes the old rows - consistent
    # with the single-transaction category PATCH above, and correct
    # regardless of dialect (no SQLite-ignores-ondelete concern here, since
    # this never goes through a bulk query).
    transaction.splits = [
        TransactionSplit(category_id=s.category_id, amount=s.amount, note=s.note)
        for s in payload.splits
    ]
    # Splitting supersedes direct categorization, the same reason it goes
    # the other way above - a transaction is never both at once.
    transaction.category_id = None
    transaction.categorized_by_rule_id = None
    db.commit()
    db.refresh(transaction)

    return transaction


@router.patch("/transactions/{transaction_id}/note", response_model=TransactionResponse)
def update_transaction_note(
    transaction_id: int,
    payload: TransactionNoteUpdate,
    db: Session = Depends(get_db)
):

    transaction = db.get(Transaction, transaction_id)

    if transaction is None:
        raise HTTPException(status_code=404, detail="Transaction not found")

    transaction.note = payload.note
    db.commit()
    db.refresh(transaction)

    return transaction


@router.delete("/transactions/{transaction_id}", status_code=204)
def delete_transaction(
    transaction_id: int,
    db: Session = Depends(get_db)
):

    transaction = db.get(Transaction, transaction_id)

    if transaction is None:
        raise HTTPException(status_code=404, detail="Transaction not found")

    db.delete(transaction)
    db.commit()


@router.delete("/transactions", status_code=204)
def wipe_transactions(db: Session = Depends(get_db)):

    # Explicit, not left to the FK's ondelete=CASCADE - a bulk query (unlike
    # delete_transaction's ORM db.delete()) never triggers the ORM cascade,
    # and SQLite ignores ondelete without PRAGMA foreign_keys=ON regardless.
    db.query(TransactionSplit).delete()
    db.query(Transaction).delete()
    db.query(ImportBatch).delete()
    db.commit()


@router.get("/import-batches", response_model=list[ImportBatchResponse])
def list_import_batches(db: Session = Depends(get_db)):

    return (
        db.query(ImportBatch)
        .order_by(ImportBatch.imported_at.desc(), ImportBatch.id.desc())
        .all()
    )


@router.delete("/import-batches/{batch_id}", status_code=204)
def delete_import_batch(
    batch_id: int,
    db: Session = Depends(get_db)
):

    batch = db.get(ImportBatch, batch_id)

    if batch is None:
        raise HTTPException(status_code=404, detail="Import batch not found")

    db.delete(batch)
    db.commit()
