from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, computed_field

from .services.narration import merchant_label as _merchant_label


class AccountResponse(BaseModel):

    id: int
    name: str
    institution: Optional[str]
    account_type: Optional[str]
    balance_sign: str
    bsb_number: Optional[str]
    account_number: str
    created_at: datetime
    # Optional - see AccountGroup in models.py. group_name is read straight
    # off the relationship (Account.group_name), the same pattern
    # Transaction.account_name/category_name already establish, so the
    # frontend never has to cross-reference a separate groups list just to
    # label a row.
    group_id: Optional[int] = None
    group_name: Optional[str] = None
    # Not columns on Account - populated from the most recent transaction's
    # running balance (see services/ledger.py). None (not 0.00) means the
    # account has no transactions yet; zero is a real balance and the two
    # must render differently.
    balance: Optional[Decimal] = None
    balance_as_of: Optional[date] = None

    model_config = ConfigDict(from_attributes=True)


class AccountCreate(BaseModel):

    name: str
    institution: Optional[str] = None
    account_type: Optional[str] = None
    balance_sign: str = "natural"
    bsb_number: Optional[str] = None
    account_number: str
    group_id: Optional[int] = None


class AccountUpdate(BaseModel):

    name: str
    institution: Optional[str] = None
    account_type: Optional[str] = None
    balance_sign: str = "natural"
    bsb_number: Optional[str] = None
    account_number: str
    group_id: Optional[int] = None


class AccountGroupResponse(BaseModel):

    id: int
    name: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AccountGroupCreate(BaseModel):

    name: str


class AccountGroupUpdate(BaseModel):

    name: str


class BalanceSignInferenceResponse(BaseModel):
    """GET /accounts/{id}/infer-balance-sign - a suggestion, never applied
    automatically (see services/net_worth.infer_balance_sign). sample_size
    is how many balances the inference actually looked at, so the frontend
    can show "based on 12 transactions" rather than a bare guess with no
    indication of how much evidence backs it.
    """

    inferred_sign: Optional[str]
    sample_size: int


class CategoryResponse(BaseModel):

    id: int
    name: str
    kind: str
    budget_amount: Optional[Decimal]
    parent_id: Optional[int]
    parent_name: Optional[str]
    archived: bool

    model_config = ConfigDict(from_attributes=True)


class CategoryCreate(BaseModel):

    name: str
    kind: str = "expense"
    budget_amount: Optional[Decimal] = None
    parent_id: Optional[int] = None


class CategoryUpdate(BaseModel):

    name: str
    kind: str = "expense"
    budget_amount: Optional[Decimal] = None
    parent_id: Optional[int] = None


class CategoryBulkDelete(BaseModel):

    category_ids: list[int]


class CategoryUsageResponse(BaseModel):
    """Whole-ledger (unscoped to any period) usage for one category - what
    /categories' Unused card uses to tell a genuinely zero-activity category
    from one that merely has no budget. transaction_count is read through
    services/allocations.py's own view, so a category used only via a split
    (which has no Transaction.category_id of its own at all) is correctly
    counted as used. Returned for every category, archived or not, so the
    same endpoint serves both the Unused and Archived cards.

    A PARENT category's own transaction_count is always 0 by construction -
    a parent is never itself assignable (api/categories.py) - which is
    expected, not a bug: "unused" is evaluated per LEAF category, and the
    frontend does not treat a parent's own zero count as meaning anything
    about whether its children are used.
    """

    category_id: int
    category_name: str
    parent_id: Optional[int]
    budget_amount: Optional[Decimal]
    archived: bool
    transaction_count: int
    rule_count: int


class CategoryPresetResultResponse(BaseModel):

    created: list[str]
    skipped: list[str]


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

    model_config = ConfigDict(from_attributes=True)


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


class RuleReviewFinding(BaseModel):
    """See services/rule_review.py for what `kind` means and why - duplicate
    and subsumed are safe to auto-remove, shadowed never is.
    """

    rule_id: int
    narration_pattern: str
    category_id: int
    category_name: Optional[str]
    kind: str
    blocking_rule_id: int
    blocking_narration_pattern: str

    model_config = ConfigDict(from_attributes=True)


class RuleReviewResponse(BaseModel):

    findings: list[RuleReviewFinding]


class RemoveRedundantRulesResponse(BaseModel):

    removed_count: int


class TransactionCategoryUpdate(BaseModel):

    category_id: Optional[int]


class BulkCategoryUpdate(BaseModel):

    transaction_ids: list[int]
    category_id: Optional[int]


class TransactionSplitResponse(BaseModel):

    id: int
    category_id: Optional[int]
    category_name: Optional[str]
    amount: Decimal
    note: Optional[str]

    model_config = ConfigDict(from_attributes=True)


class TransactionSplitInput(BaseModel):

    category_id: Optional[int] = None
    amount: Decimal
    note: Optional[str] = None


class TransactionSplitsUpdate(BaseModel):

    splits: list[TransactionSplitInput]


class TransactionNoteUpdate(BaseModel):

    note: Optional[str] = None


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
    note: Optional[str]
    is_split: bool
    splits: list[TransactionSplitResponse]

    model_config = ConfigDict(from_attributes=True)

    @computed_field
    @property
    def merchant_label(self) -> str:
        """The same merchant-name derivation services/narration.py uses for
        recurring detection and ledger grouping - exposed here so a rule
        prefilled FROM a transaction (RuleEditor) proposes the same merchant
        name a "similar transactions" group would, rather than a second,
        independently-drifting guess at "the merchant".
        """
        return _merchant_label(self.narration)


class TransactionListResponse(BaseModel):

    items: list[TransactionResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class TransactionGroupResponse(BaseModel):

    narration_key: str
    merchant: str
    sample_narration: str
    transaction_count: int
    total_amount: Decimal
    direction: str
    first_date: date
    last_date: date
    account_names: list[str]
    transaction_ids: list[int]

    model_config = ConfigDict(from_attributes=True)


class TransactionGroupListResponse(BaseModel):

    groups: list[TransactionGroupResponse]


class ImportBatchResponse(BaseModel):

    id: int
    filename: str
    imported_at: datetime
    row_count: int
    skipped_duplicate_count: int

    model_config = ConfigDict(from_attributes=True)


class ImportResultResponse(BaseModel):

    batch: ImportBatchResponse
    imported_count: int
    skipped_duplicate_count: int
    new_account_count: int
    auto_categorized_count: int


class CsvColumnMappingInput(BaseModel):
    """A candidate (not-yet-saved) or about-to-be-saved column mapping -
    see services/csv_formats.ColumnMapping and CsvFormatMapping in
    models.py for the full field-by-field reasoning. balance_index is the
    one column that is never optional - a format with no running balance
    is out of scope (see services/ledger.py's module docstring on why the
    app never derives one).
    """

    name: str
    institution: Optional[str] = None
    date_format: str
    amount_mode: str = "debit_credit"
    bsb_index: Optional[int] = None
    account_number_index: int
    transaction_date_index: int
    narration_index: int
    cheque_number_index: Optional[int] = None
    debit_index: Optional[int] = None
    credit_index: Optional[int] = None
    amount_index: Optional[int] = None
    balance_index: int
    transaction_type_index: Optional[int] = None


class CsvFormatMappingCreate(BaseModel):

    mapping: CsvColumnMappingInput
    header: list[str]


class CsvFormatMappingResponse(BaseModel):

    id: int
    name: str
    institution: Optional[str]
    header_signature: str
    date_format: str
    amount_mode: str
    bsb_index: Optional[int]
    account_number_index: int
    transaction_date_index: int
    narration_index: int
    cheque_number_index: Optional[int]
    debit_index: Optional[int]
    credit_index: Optional[int]
    amount_index: Optional[int]
    balance_index: int
    transaction_type_index: Optional[int]

    model_config = ConfigDict(from_attributes=True)


class CsvPreviewRowResponse(BaseModel):

    bsb_number: Optional[str]
    account_number: str
    transaction_date: date
    narration: str
    cheque_number: Optional[str]
    debit: Optional[Decimal]
    credit: Optional[Decimal]
    balance: Decimal
    transaction_type: str


class CsvImportPreviewResponse(BaseModel):

    rows: list[CsvPreviewRowResponse]
    errors: list[dict]


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
    archived: bool

    model_config = ConfigDict(from_attributes=True)


class CategoryGridPeriodResponse(BaseModel):

    year: int
    month: int
    label: str


class CategoryGridRowResponse(BaseModel):

    category_id: int
    category_name: str
    kind: str
    archived: bool
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


class RecurringSeriesResponse(BaseModel):

    account_id: int
    account_name: Optional[str]
    narration_key: str
    merchant: str
    sample_narration: str
    cadence: str
    interval_days: int
    occurrence_count: int
    first_date: date
    last_date: date
    direction: str
    typical_amount: Decimal
    latest_amount: Decimal
    amount_varies: bool
    amount_changed: bool
    next_due_date: date
    status: str
    annual_cost: Decimal
    category_id: Optional[int]
    category_name: Optional[str]
    dismissed: bool
    dismissal_id: Optional[int]

    model_config = ConfigDict(from_attributes=True)


class RecurringSummaryResponse(BaseModel):

    series_count: int
    total_annual_cost: Decimal
    due_soon_count: int
    due_soon_total: Decimal
    changed_count: int
    overdue_count: int


class RecurringResponse(BaseModel):

    series: list[RecurringSeriesResponse]
    summary: RecurringSummaryResponse
    # The most recent transaction_date across the WHOLE ledger, for display
    # only (an "as of" caption) - not the same as the per-account as_of used
    # internally to judge each series' status. None when the ledger is empty.
    as_of: Optional[date]


class RecurringDismissalCreate(BaseModel):

    account_id: int
    narration_key: str


class RecurringDismissalResponse(BaseModel):

    id: int
    account_id: int
    narration_key: str

    model_config = ConfigDict(from_attributes=True)


class TrendMonthlySummaryResponse(BaseModel):

    label: str
    total_income: Decimal
    total_spending: Decimal
    net_saved: Decimal


class TrendBudgetResponse(BaseModel):

    label: str
    budgeted: Decimal
    actual: Decimal


class TrendBalanceResponse(BaseModel):
    """A net worth figure per period (services.net_worth.net_worth_history),
    sign-aware across every classified account - not a straight sum."""

    label: str
    # None for a period before EVERY classified account has any history
    # yet (a real gap) - never a false 0 for "the whole ledger has no data
    # this far back".
    balance: Optional[Decimal]


class TrendsResponse(BaseModel):

    periods: list[CategoryGridPeriodResponse]
    # Reuses the Reports grid's own row shape - a trend category and a
    # report-grid category are the same data, just viewed over more months.
    categories: list[CategoryGridRowResponse]
    monthly: list[TrendMonthlySummaryResponse]
    budget: list[TrendBudgetResponse]
    balances: list[TrendBalanceResponse]


class BalanceHistoryResponse(BaseModel):

    periods: list[CategoryGridPeriodResponse]
    # Keyed by period label ("2026-01") rather than a parallel array, so the
    # frontend can look up a period without needing to zip two lists in
    # lockstep. None (not 0.00) means no data yet for that month - the same
    # "no transactions" distinction AccountResponse.balance already makes.
    balances: dict[str, Optional[Decimal]]


class NetWorthResponse(BaseModel):
    """GET /api/net-worth - a thin wrapper over services.net_worth.
    net_worth_now(). assets and liabilities are both positive-reading
    display figures (liabilities is "how much is owed"); net = assets -
    liabilities always, by construction of that function. unclassified_count
    is how many accounts (with a real balance) are excluded from every
    figure here - never guessed into assets, see ACCOUNT_TYPES's own
    comment in models.py.
    """

    assets: Decimal
    liabilities: Decimal
    net: Decimal
    unclassified_count: int


class BudgetPeriodCategoryResponse(BaseModel):

    category_id: int
    category_name: str
    # standing_amount and override_amount are the two RAW inputs;
    # effective_amount is services.budgets.effective_budget()'s already-
    # resolved output - never re-derive it from the other two on the
    # frontend, it exists so the UI doesn't have to.
    standing_amount: Optional[Decimal]
    override_amount: Optional[Decimal]
    effective_amount: Optional[Decimal]
    is_overridden: bool
    actual: Decimal
    difference: Optional[Decimal]


class BudgetPeriodTotalsResponse(BaseModel):

    budgeted: Decimal
    actual: Decimal
    difference: Decimal


class BudgetPeriodResponse(BaseModel):

    year: int
    month: int
    categories: list[BudgetPeriodCategoryResponse]
    totals: BudgetPeriodTotalsResponse


class BudgetOverrideUpdate(BaseModel):

    year: int
    month: int
    amount: Decimal


class BudgetCopyRequest(BaseModel):

    from_year: int
    from_month: int
    to_year: int
    to_month: int


class BudgetCopyResponse(BaseModel):

    copied_count: int


class ForecastPeriodResponse(BaseModel):

    year: int
    month: int
    label: str
    is_partial: bool


class ForecastMonthResponse(BaseModel):

    label: str
    is_partial: bool
    opening: Decimal
    recurring_in: Decimal
    recurring_out: Decimal
    estimated_other: Decimal
    closing: Decimal


class ForecastAccountResponse(BaseModel):

    account_id: int
    account_name: Optional[str]
    opening_balance: Decimal
    daily_run_rate: Decimal
    months: list[ForecastMonthResponse]


class ForecastCombinedResponse(BaseModel):

    opening_balance: Decimal
    months: list[ForecastMonthResponse]


class ForecastUpcomingResponse(BaseModel):

    due_date: date
    account_id: int
    merchant: str
    amount: Decimal
    direction: str


class ForecastResponse(BaseModel):

    # None on a completely empty ledger - there is nothing to anchor a
    # projection to, not a projection starting from zero.
    as_of: Optional[date]
    periods: list[ForecastPeriodResponse]
    accounts: list[ForecastAccountResponse]
    combined: Optional[ForecastCombinedResponse]
    upcoming: list[ForecastUpcomingResponse]


class VersionResponse(BaseModel):

    version: str
    commit: str


class GoalCreate(BaseModel):

    name: str
    target_amount: Decimal
    target_date: Optional[date] = None
    mode: str = "account_balance"
    account_id: Optional[int] = None
    allocated_amount: Optional[Decimal] = None


class GoalUpdate(GoalCreate):
    pass


class GoalResponse(BaseModel):
    """Progress fields (current_amount/percent/remaining/monthly_required)
    are computed fresh on every read by services/goals.goal_progress - see
    that function's own docstring for exactly what each one means and
    when monthly_required is None.
    """

    id: int
    name: str
    target_amount: Decimal
    target_date: Optional[date]
    mode: str
    account_id: Optional[int]
    account_name: Optional[str]
    allocated_amount: Optional[Decimal]
    archived: bool
    current_amount: Decimal
    percent: Decimal
    remaining: Decimal
    monthly_required: Optional[Decimal]

    model_config = ConfigDict(from_attributes=True)


class AccountEnvelopeSummaryResponse(BaseModel):
    """See services.goals.account_envelope_summaries - the envelope
    over-allocation check. account_balance is None only when the account
    has no transactions yet, in which case over_allocated is always False
    (there is nothing yet to compare against, not proof of a problem)."""

    account_id: int
    account_name: str
    account_balance: Optional[Decimal]
    allocated_total: Decimal
    over_allocated: bool
    over_allocated_by: Optional[Decimal]


class GoalListResponse(BaseModel):

    goals: list[GoalResponse]
    account_envelope_summaries: list[AccountEnvelopeSummaryResponse]
