from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel


class HomeStatusResponse(BaseModel):

    id: int
    message: str

    class Config:
        from_attributes = True


class TransactionResponse(BaseModel):

    id: int
    import_batch_id: int
    bsb_number: Optional[str]
    account_number: str
    transaction_date: date
    narration: str
    cheque_number: Optional[str]
    debit: Optional[Decimal]
    credit: Optional[Decimal]
    balance: Decimal
    transaction_type: str

    class Config:
        from_attributes = True


class ImportBatchResponse(BaseModel):

    id: int
    filename: str
    imported_at: datetime
    row_count: int
    skipped_duplicate_count: int

    class Config:
        from_attributes = True


class ImportResultResponse(BaseModel):

    batch: ImportBatchResponse
    imported_count: int
    skipped_duplicate_count: int


class ImportErrorDetail(BaseModel):

    row_number: int
    message: str
