from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel


class AccountResponse(BaseModel):

    id: int
    name: str
    institution: Optional[str]
    account_type: Optional[str]
    bsb_number: Optional[str]
    account_number: str
    created_at: datetime

    class Config:
        from_attributes = True


class AccountCreate(BaseModel):

    name: str
    institution: Optional[str] = None
    account_type: Optional[str] = None
    bsb_number: Optional[str] = None
    account_number: str


class AccountUpdate(BaseModel):

    name: str
    institution: Optional[str] = None
    account_type: Optional[str] = None
    bsb_number: Optional[str] = None
    account_number: str


class CategoryResponse(BaseModel):

    id: int
    name: str

    class Config:
        from_attributes = True


class CategoryCreate(BaseModel):

    name: str


class CategoryUpdate(BaseModel):

    name: str


class TransactionCategoryUpdate(BaseModel):

    category_id: Optional[int]


class BulkCategoryUpdate(BaseModel):

    transaction_ids: list[int]
    category_id: Optional[int]


class TransactionResponse(BaseModel):

    id: int
    import_batch_id: int
    account_id: Optional[int]
    account_name: Optional[str]
    category_id: Optional[int]
    category_name: Optional[str]
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
    new_account_count: int
