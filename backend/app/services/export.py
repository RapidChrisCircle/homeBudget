"""Getting data OUT of the app - the two things README's Importing section
promises going IN never had a counterpart for. Two genuinely different
jobs, deliberately not one export with a format flag:

- `ledger_csv` is the "send it to the accountant" case: a filtered slice of
  the ledger, human-readable, with categories resolved to names. It is NOT
  designed to round-trip back through import - its header doesn't match
  the built-in bank layout (services/csv_formats.py matches a layout by
  EXACT header string), and it carries information (Category, Note, split
  detail) no bank export format has a column for. That is a deliberate
  trade: a categorized, split-aware CSV is what makes it useful outside
  the app at all, and building a second, re-importable layout alongside it
  would be a second export nobody asked for. Re-importing this file is
  unsupported, not merely untested - see backend/README's own note before
  trying to make it work.
- `database_snapshot` is the backup case: everything, structured, not
  filtered. It reuses the SAME response schemas every list endpoint
  already returns (AccountResponse, CategoryResponse, ...) rather than a
  second hand-rolled serialization, so the snapshot can never describe a
  record differently than the API itself does. There is deliberately no
  restore-from-snapshot endpoint - recreating a household's data by
  replaying each entity's own POST endpoint is possible by hand, but true
  point-in-time recovery is a Postgres-level restore, which this app has
  no business reimplementing.
"""

import csv
import io
from decimal import Decimal

from sqlalchemy.orm import Query, Session

from ..models import (
    Account,
    AccountGroup,
    Category,
    CategoryBudget,
    CategoryRule,
    CsvFormatMapping,
    DashboardWidget,
    ImportBatch,
    RecurringDismissal,
    SavingsGoal,
    Transaction,
)
from .ledger import LIST_LOADERS

CSV_COLUMNS = (
    "Date", "Account", "Narration", "Category", "Debit", "Credit", "Balance", "Type", "Note",
)


def _category_cell(transaction: Transaction) -> str:
    """One cell describing where a transaction's money was categorized -
    the split-aware case is why this exists at all: a split transaction has
    no single category_id (see TransactionSplit's docstring in models.py),
    so its slice-by-slice breakdown is flattened into one semicolon-joined
    string rather than either picking one allocation arbitrarily or adding
    a second CSV row per allocation, which would silently break "one row
    per transaction" for anything downstream that assumes it.
    """

    if transaction.splits:
        parts = [
            f"{split.category_name or 'Uncategorized'}: {Decimal(split.amount):.2f}"
            for split in transaction.splits
        ]
        return "; ".join(parts)

    return transaction.category_name or "Uncategorized"


def ledger_csv(query: Query) -> str:
    """Every transaction the query matches (no pagination - an export is
    exactly the point where "everything I filtered to" and "everything on
    this page" must not be conflated), as CSV text. `query` is expected to
    already be a filtered, ordered services.ledger.build_transaction_query
    result - this function doesn't know or care what filters produced it,
    the same separation build_transaction_query's own callers already rely
    on for GET /transactions.
    """

    transactions = query.options(*LIST_LOADERS).all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(CSV_COLUMNS)

    for transaction in transactions:
        writer.writerow([
            transaction.transaction_date.isoformat(),
            transaction.account_name or transaction.account_number,
            transaction.narration,
            _category_cell(transaction),
            f"{Decimal(transaction.debit):.2f}" if transaction.debit is not None else "",
            f"{Decimal(transaction.credit):.2f}" if transaction.credit is not None else "",
            f"{Decimal(transaction.balance):.2f}",
            transaction.transaction_type,
            transaction.note or "",
        ])

    return buffer.getvalue()


def _dump(rows, schema) -> list[dict]:
    """Every row through the SAME response schema the API's own list
    endpoints already return it through (from_attributes=True on each -
    see e.g. api/csv_formats.py's list_csv_formats, which hands FastAPI raw
    ORM rows and lets response_model validation do exactly this). A record
    in the snapshot can therefore never describe itself differently than
    GET-ing it from the app would.
    """

    return [schema.model_validate(row).model_dump(mode="json") for row in rows]


def database_snapshot(db: Session) -> dict:
    """Every table worth backing up, as plain JSON-able dicts. Deliberately
    unfiltered and unpaginated (archived categories/goals included, every
    account regardless of type) - a partial backup is a false sense of
    security.

    Ordered so a hand-replay (recreate each record via its own POST
    endpoint) can proceed top to bottom without hitting a foreign key that
    doesn't exist yet: groups before accounts, categories before rules and
    budgets, accounts and categories both before transactions.
    """

    # Imported here, not at module level, to avoid a real import cycle:
    # schemas.py has none of its own, but services/goals.py (needed below
    # for the same reason) is otherwise never imported by this module.
    from ..schemas import (
        AccountGroupResponse,
        AccountResponse,
        CategoryResponse,
        CategoryRuleResponse,
        CsvFormatMappingResponse,
        DashboardWidgetResponse,
        ImportBatchResponse,
        RecurringDismissalResponse,
        TransactionResponse,
    )
    from .goals import goal_progress
    from .ledger import account_balances

    balances = account_balances(db)

    accounts = db.query(Account).order_by(Account.id).all()
    account_rows = [
        AccountResponse.model_validate(account).model_dump(mode="json")
        | {
            "balance": (str(balances[account.id][0]) if account.id in balances else None),
            "balance_as_of": (balances[account.id][1].isoformat() if account.id in balances else None),
        }
        for account in accounts
    ]

    # GoalResponse's progress fields (current_amount, percent, ...) are
    # computed by services.goals.goal_progress, not stored on SavingsGoal
    # itself - from_attributes alone can't produce them, so each goal is
    # assembled the same way api/goals.py's own _serialize_goal does,
    # rather than importing that private helper across api/ -> services/
    # (the wrong direction for this codebase's layering).
    goals = db.query(SavingsGoal).order_by(SavingsGoal.id).all()
    goal_rows = [
        {
            "id": goal.id,
            "name": goal.name,
            "target_amount": str(goal.target_amount),
            "target_date": goal.target_date.isoformat() if goal.target_date else None,
            "mode": goal.mode,
            "account_id": goal.account_id,
            "account_name": goal.account.name if goal.account is not None else None,
            "allocated_amount": str(goal.allocated_amount) if goal.allocated_amount is not None else None,
            "archived": goal.archived,
            **{k: (str(v) if isinstance(v, Decimal) else v) for k, v in goal_progress(db, goal).items()},
        }
        for goal in goals
    ]

    category_budgets = db.query(CategoryBudget).order_by(CategoryBudget.id).all()

    transactions = (
        db.query(Transaction)
        .options(*LIST_LOADERS)
        .order_by(Transaction.id)
        .all()
    )

    return {
        "account_groups": _dump(db.query(AccountGroup).order_by(AccountGroup.id).all(), AccountGroupResponse),
        "accounts": account_rows,
        "categories": _dump(db.query(Category).order_by(Category.id).all(), CategoryResponse),
        "category_rules": _dump(db.query(CategoryRule).order_by(CategoryRule.id).all(), CategoryRuleResponse),
        "category_budgets": [
            {
                "category_id": row.category_id,
                "year": row.year,
                "month": row.month,
                "amount": str(row.amount),
            }
            for row in category_budgets
        ],
        "import_batches": _dump(db.query(ImportBatch).order_by(ImportBatch.id).all(), ImportBatchResponse),
        "transactions": _dump(transactions, TransactionResponse),
        "csv_format_mappings": _dump(
            db.query(CsvFormatMapping).order_by(CsvFormatMapping.id).all(), CsvFormatMappingResponse
        ),
        "savings_goals": goal_rows,
        "dashboard_widgets": _dump(
            db.query(DashboardWidget).order_by(DashboardWidget.id).all(), DashboardWidgetResponse
        ),
        "recurring_dismissals": _dump(
            db.query(RecurringDismissal).order_by(RecurringDismissal.id).all(), RecurringDismissalResponse
        ),
    }
