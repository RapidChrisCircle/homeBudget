from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import ValidationError
from sqlalchemy.orm import Session

from ..deps import get_db
from ..models import Category, ImportBatch, Transaction, TransactionSplit
from ..schemas import (
    BulkCategoryUpdate,
    CsvColumnMappingInput,
    CsvImportPreviewResponse,
    CsvPreviewRowResponse,
    ImportBatchResponse,
    ImportResultResponse,
    TransactionCategoryUpdate,
    TransactionGroupListResponse,
    TransactionListResponse,
    TransactionNoteUpdate,
    TransactionResponse,
    TransactionSplitsUpdate,
)
from ..services.csv_formats import ColumnMapping, validate_mapping_input
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
    TransactionFilters,
    build_transaction_query,
    paginate,
    transaction_groups,
)

router = APIRouter()


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
        mapping, rows = parse_and_validate(db, content)

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
        db, filename=file.filename, mapping=mapping, rows=rows
    )

    return ImportResultResponse(
        batch=ImportBatchResponse.model_validate(batch),
        imported_count=batch.row_count,
        skipped_duplicate_count=batch.skipped_duplicate_count,
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

    rows, errors = preview_import(db, content, mapping)

    return CsvImportPreviewResponse(
        rows=[CsvPreviewRowResponse(**vars(row)) for row in rows],
        errors=[{"row_number": n, "message": m} for n, m in errors],
    )


@router.get("/transactions", response_model=TransactionListResponse)
def list_transactions(
    account_id: int | None = None,
    account_group_id: int | None = None,
    category_id: int | None = None,
    uncategorized: bool = False,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
    transaction_type: str | None = None,
    # Amounts are POSITIVE dollars compared against an absolute value (see
    # services/ledger.py) - a negative bound is a client bug, not a query.
    min_amount: Decimal | None = Query(None, ge=0),
    max_amount: Decimal | None = Query(None, ge=0),
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db)
):

    # Contradictory combinations are rejected rather than silently returning
    # nothing - an empty ledger looks like "no matching transactions", which
    # hides the mistake instead of surfacing it.
    if uncategorized and category_id is not None:
        raise HTTPException(
            status_code=422,
            detail="uncategorized and category_id are contradictory - use one or the other",
        )

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
        date_from=date_from,
        date_to=date_to,
        search=search,
        transaction_type=transaction_type,
        min_amount=min_amount,
        max_amount=max_amount,
    )

    query = build_transaction_query(db, filters)
    items, total = paginate(query, page=page, page_size=page_size, options=LIST_LOADERS)

    return TransactionListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=max(1, -(-total // page_size)),
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

    # Same two contradiction checks list_transactions applies, for the same
    # reason: a 422 surfaces the mistake instead of quietly grouping the
    # wrong rows.
    if uncategorized and category_id is not None:
        raise HTTPException(
            status_code=422,
            detail="uncategorized and category_id are contradictory - use one or the other",
        )

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
        date_from=date_from,
        date_to=date_to,
        search=search,
        transaction_type=transaction_type,
        min_amount=min_amount,
        max_amount=max_amount,
    )

    return TransactionGroupListResponse(groups=transaction_groups(db, filters, include_categorized=include_categorized))


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
