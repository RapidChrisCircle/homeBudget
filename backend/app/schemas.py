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
    # Not columns on Account - populated from the most recent transaction's
    # running balance (see services/ledger.py). None (not 0.00) means the
    # account has no transactions yet; zero is a real balance and the two
    # must render differently.
    balance: Optional[Decimal] = None
    balance_as_of: Optional[date] = None

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
    kind: str
    budget_amount: Optional[Decimal]

    class Config:
        from_attributes = True


class CategoryCreate(BaseModel):

    name: str
    kind: str = "expense"
    budget_amount: Optional[Decimal] = None


class CategoryUpdate(BaseModel):

    name: str
    kind: str = "expense"
    budget_amount: Optional[Decimal] = None


class CategoryRuleResponse(BaseModel):

    id: int
    narration_pattern: str
    transaction_type: Optional[str]
    min_amount: Optional[Decimal]
    max_amount: Optional[Decimal]
    category_id: int
    category_name: Optional[str]
    priority: int
    created_at: datetime

    class Config:
        from_attributes = True


class CategoryRuleCreate(BaseModel):

    narration_pattern: str
    transaction_type: Optional[str] = None
    min_amount: Optional[Decimal] = None
    max_amount: Optional[Decimal] = None
    category_id: int


class CategoryRuleUpdate(BaseModel):

    narration_pattern: str
    transaction_type: Optional[str] = None
    min_amount: Optional[Decimal] = None
    max_amount: Optional[Decimal] = None
    category_id: int


class CategoryRuleMove(BaseModel):

    direction: str


class CategoryRulePreviewRequest(BaseModel):

    narration_pattern: str
    transaction_type: Optional[str] = None
    min_amount: Optional[Decimal] = None
    max_amount: Optional[Decimal] = None
    category_id: Optional[int] = None
    exclude_rule_id: Optional[int] = None


class CategoryRulePreviewResponse(BaseModel):

    match_count: int
    would_categorize_count: int


class ApplyRulesResponse(BaseModel):

    categorized_count: int


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
    categorized_by_rule_id: Optional[int]
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


class TransactionListResponse(BaseModel):

    items: list[TransactionResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


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
    auto_categorized_count: int


class ReportPeriodResponse(BaseModel):

    year: int
    month: int
    label: str
    transaction_count: int


class MonthlySummaryResponse(BaseModel):

    total_income: Decimal
    total_spending: Decimal
    net_saved: Decimal


class BudgetLineResponse(BaseModel):

    category_id: int
    category_name: str
    budget_amount: Optional[Decimal]
    actual: Decimal
    difference: Optional[Decimal]
    transaction_count: int

    class Config:
        from_attributes = True


class CategoryGridPeriodResponse(BaseModel):

    year: int
    month: int
    label: str


class CategoryGridRowResponse(BaseModel):

    category_id: int
    category_name: str
    kind: str
    amounts: dict[str, Decimal]
    total: Decimal


class CategoryGridResponse(BaseModel):

    periods: list[CategoryGridPeriodResponse]
    rows: list[CategoryGridRowResponse]


class UncategorizedSummaryResponse(BaseModel):

    transaction_count: int
    uncategorized_count: int
    total_in: Decimal
    total_out: Decimal
    net_total: Decimal


class MonthlyReportResponse(BaseModel):

    year: int
    month: int
    label: str
    start_date: date
    end_date: date
    summary: MonthlySummaryResponse
    budgets: list[BudgetLineResponse]
    grid: CategoryGridResponse
    uncategorized: UncategorizedSummaryResponse
