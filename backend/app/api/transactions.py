from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from ..deps import get_db
from ..models import Category, ImportBatch, Transaction
from ..schemas import (
    BulkCategoryUpdate,
    ImportBatchResponse,
    ImportResultResponse,
    TransactionCategoryUpdate,
    TransactionListResponse,
    TransactionResponse,
)
from ..services.csv_import import CsvValidationError, import_rows, parse_and_validate
from ..services.ledger import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, TransactionFilters, build_transaction_query, paginate

router = APIRouter()


@router.post("/transactions/import", response_model=ImportResultResponse, status_code=201)
def import_transactions(
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):

    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv file")

    content = file.file.read()

    try:
        csv_format, rows = parse_and_validate(content)

    except CsvValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "detail": "CSV import rejected: one or more rows are invalid",
                "errors": [{"row_number": n, "message": m} for n, m in exc.errors],
            },
        )

    batch, new_account_count, auto_categorized_count = import_rows(
        db, filename=file.filename, csv_format=csv_format, rows=rows
    )

    return ImportResultResponse(
        batch=ImportBatchResponse.model_validate(batch),
        imported_count=batch.row_count,
        skipped_duplicate_count=batch.skipped_duplicate_count,
        new_account_count=new_account_count,
        auto_categorized_count=auto_categorized_count,
    )


@router.get("/transactions", response_model=TransactionListResponse)
def list_transactions(
    account_id: int | None = None,
    category_id: int | None = None,
    uncategorized: bool = False,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
    transaction_type: str | None = None,
    min_amount: Decimal | None = None,
    max_amount: Decimal | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db)
):

    if uncategorized and category_id is not None:
        raise HTTPException(
            status_code=422,
            detail="uncategorized and category_id are contradictory - use one or the other",
        )

    filters = TransactionFilters(
        account_id=account_id,
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
    items, total = paginate(query, page=page, page_size=page_size)

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
    used to populate the Transaction type dropdown on the Rules page rather
    than leaving it as free text.
    """

    rows = (
        db.query(Transaction.transaction_type)
        .filter(Transaction.transaction_type.isnot(None))
        .distinct()
        .order_by(Transaction.transaction_type)
        .all()
    )

    return [row[0] for row in rows]


@router.patch("/transactions/{transaction_id}/category", response_model=TransactionResponse)
def update_transaction_category(
    transaction_id: int,
    payload: TransactionCategoryUpdate,
    db: Session = Depends(get_db)
):

    transaction = db.get(Transaction, transaction_id)

    if transaction is None:
        raise HTTPException(status_code=404, detail="Transaction not found")

    if payload.category_id is not None and db.get(Category, payload.category_id) is None:
        raise HTTPException(status_code=404, detail="Category not found")

    # Setting a category by hand makes it permanent - clearing the rule
    # marker takes this transaction out of scope for future rule runs.
    transaction.category_id = payload.category_id
    transaction.categorized_by_rule_id = None
    db.commit()
    db.refresh(transaction)

    return transaction


@router.post("/transactions/bulk-category")
def bulk_update_transaction_category(
    payload: BulkCategoryUpdate,
    db: Session = Depends(get_db)
):

    if payload.category_id is not None and db.get(Category, payload.category_id) is None:
        raise HTTPException(status_code=404, detail="Category not found")

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
