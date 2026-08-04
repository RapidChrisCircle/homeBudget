from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    false,
    func,
)
from sqlalchemy.orm import relationship

from .database import Base

# Shared by Category validation (api/categories.py) and the reporting service
# (services/reporting.py) so the set of valid kinds is defined exactly once.
CATEGORY_KINDS = ("expense", "income", "transfer")


class Account(Base):

    __tablename__ = "accounts"

    id = Column(
        Integer,
        primary_key=True
    )

    name = Column(
        String,
        nullable=False
    )

    institution = Column(
        String,
        nullable=True
    )

    account_type = Column(
        String,
        nullable=True
    )

    bsb_number = Column(
        String,
        nullable=True
    )

    account_number = Column(
        String,
        nullable=False
    )

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now()
    )

    transactions = relationship(
        "Transaction",
        back_populates="account"
    )

    # ORM-level cascade (mirroring ImportBatch.transactions below), not just
    # the FK's ondelete=CASCADE - delete_account only ever succeeds once an
    # account has no transactions, but a dismissal has no such guard, so it
    # must be cleaned up explicitly when the account goes.
    recurring_dismissals = relationship(
        "RecurringDismissal",
        back_populates="account",
        cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint(
            "account_number",
            name="uq_accounts_account_number"
        ),
    )


class Category(Base):
    """A spending/income grouping.

    kind is one of CATEGORY_KINDS:
    - "expense" - counts toward spending totals; budget_amount applies.
    - "income" - counts toward income totals.
    - "transfer" - excluded from every report. Use this for money moving
      between the user's own accounts (e.g. a credit card payment) so it
      doesn't inflate both income and spending.

    budget_amount is the STANDING monthly budget (positive dollars, NULL = no
    budget set) - it applies to every month that has no CategoryBudget row of
    its own. A CategoryBudget row is an override for one specific month;
    resolving "the budget for month X" always means override-if-present-else-
    standing, and that resolution happens in exactly one place
    (services/budgets.effective_budget) so it cannot drift between callers.
    Only meaningful when kind == "expense".

    parent_id is GROUPING ONLY - see api/categories.py's module docstring.
    A parent category exists purely to group its children in the UI
    (CategoriesPage, reports); it is never itself assignable to a
    transaction and never itself carries a budget. Transactions, rules and
    budget resolution all still attach to leaf categories exactly as before
    parents existed, so nothing downstream needs to know grouping exists.
    One level only - api/categories.py rejects a parent that already has a
    parent, and rejects a category that has children being given a parent.
    ondelete="SET NULL" so deleting a parent promotes its children to
    top-level categories rather than deleting them (also enforced in Python
    in delete_category, since SQLite ignores ondelete without PRAGMA
    foreign_keys=ON - see the budgets cascade comment below for the same
    reasoning).
    """

    __tablename__ = "categories"

    id = Column(
        Integer,
        primary_key=True
    )

    name = Column(
        String,
        nullable=False
    )

    kind = Column(
        String,
        nullable=False,
        default="expense",
        server_default="expense"
    )

    budget_amount = Column(
        Numeric(12, 2),
        nullable=True
    )

    # Archiving is NOT deleting - every historical assignment (transactions,
    # splits, rules) is left completely alone. It only changes AVAILABILITY:
    # GET /categories excludes archived by default (?include_archived=true
    # to see them), so every dropdown in the app gets clean data for free.
    # Reports and the category grid are the one place that does NOT simply
    # follow that exclusion - an archived category with real activity in
    # the reported period must still appear there, or total_spending would
    # silently drop real money. That filter is applied at the presentation
    # edge in services/reporting.py, never in SQL - see its module
    # docstring before "simplifying" this into a query-level filter.
    archived = Column(
        Boolean,
        nullable=False,
        default=False,
        server_default=false()
    )

    parent_id = Column(
        Integer,
        ForeignKey("categories.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )

    parent = relationship(
        "Category",
        remote_side=[id],
        back_populates="children"
    )

    children = relationship(
        "Category",
        back_populates="parent"
    )

    transactions = relationship(
        "Transaction",
        back_populates="category"
    )

    rules = relationship(
        "CategoryRule",
        back_populates="category"
    )

    # ORM-level cascade, not just the FK's ondelete=CASCADE - mirrors
    # Account.recurring_dismissals. delete_category already does its other
    # cascades explicitly in Python because SQLite ignores ondelete without
    # PRAGMA foreign_keys=ON, so an FK-only cascade here would pass every
    # test while behaving differently against Postgres.
    budgets = relationship(
        "CategoryBudget",
        back_populates="category",
        cascade="all, delete-orphan"
    )

    # No cascade - deleting a category nulls out a split's category_id
    # (matching Transaction.category_id's own ondelete="SET NULL"), it never
    # deletes the split itself. delete_category in api/categories.py does
    # this explicitly, for the standing SQLite-ignores-ondelete reason.
    splits = relationship(
        "TransactionSplit",
        back_populates="category"
    )

    @property
    def parent_name(self):

        return self.parent.name if self.parent else None

    __table_args__ = (
        UniqueConstraint(
            "name",
            name="uq_categories_name"
        ),
    )


class CategoryRule(Base):
    """A rule that automatically assigns a category to matching transactions.

    Criteria are ANDed: a transaction matches only if every populated
    criterion matches. narration_pattern is a case-insensitive substring
    match and is always required.

    min_amount/max_amount are entered as POSITIVE dollar values and are
    compared against the absolute value of whichever of debit/credit is
    populated - debits are stored negative, so a signed comparison would
    never match. Bounds are inclusive. Because the comparison is on
    magnitude, an amount range matches income as well as spending unless
    transaction_type is also set.

    Rules are evaluated in (priority, id) order and the first match wins.
    """

    __tablename__ = "category_rules"

    id = Column(
        Integer,
        primary_key=True
    )

    narration_pattern = Column(
        String,
        nullable=False
    )

    transaction_type = Column(
        String,
        nullable=True
    )

    min_amount = Column(
        Numeric(12, 2),
        nullable=True
    )

    max_amount = Column(
        Numeric(12, 2),
        nullable=True
    )

    category_id = Column(
        Integer,
        ForeignKey("categories.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    priority = Column(
        Integer,
        nullable=False,
        default=0
    )

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now()
    )

    category = relationship(
        "Category",
        back_populates="rules"
    )

    tagged_transactions = relationship(
        "Transaction",
        back_populates="categorized_by_rule"
    )

    @property
    def category_name(self):

        return self.category.name if self.category else None


class CsvFormatMapping(Base):
    """A user-defined column mapping for a bank CSV layout other than the
    one built in (ANZ - see services/csv_formats.py, which is what both this
    and the built-in format reduce to before parsing: one ColumnMapping
    shape, one parsing code path in services/csv_import.py, regardless of
    which kind matched a given upload).

    Every *_index column is the raw CSV column's 0-based position in the
    file this mapping was built from. amount_mode decides which of two
    mutually exclusive column pairs is populated:
    - "debit_credit": debit_index and credit_index, mirroring this app's
      own storage convention directly (debit negative, credit positive,
      exactly one populated per row).
    - "single_amount": amount_index only, one signed column split into
      debit/credit BY SIGN at parse time (negative -> debit, positive ->
      credit) so nothing downstream of import ever learns single-amount
      files exist.

    balance_index is NEVER nullable, unlike every other column here. This
    app's most load-bearing invariant is that Transaction.balance is the
    bank's OWN running balance, never derived by summing debits/credits
    (see services/ledger.py's module docstring) - a bank export with no
    balance column is out of scope, rejected with a clear message rather
    than silently deriving one and quietly breaking that invariant.

    header_signature is the exact header row this mapping was built from
    (see services/csv_formats.header_signature for the exact join format),
    matched EXACTLY on a later upload to auto-detect this mapping without
    the user re-mapping the same file's layout every time they import.
    """

    __tablename__ = "csv_format_mappings"

    id = Column(
        Integer,
        primary_key=True
    )

    name = Column(
        String,
        nullable=False
    )

    institution = Column(
        String,
        nullable=True
    )

    header_signature = Column(
        String,
        nullable=False
    )

    date_format = Column(
        String,
        nullable=False
    )

    amount_mode = Column(
        String,
        nullable=False,
        default="debit_credit",
        server_default="debit_credit"
    )

    bsb_index = Column(Integer, nullable=True)
    account_number_index = Column(Integer, nullable=False)
    transaction_date_index = Column(Integer, nullable=False)
    narration_index = Column(Integer, nullable=False)
    cheque_number_index = Column(Integer, nullable=True)
    debit_index = Column(Integer, nullable=True)
    credit_index = Column(Integer, nullable=True)
    amount_index = Column(Integer, nullable=True)
    balance_index = Column(Integer, nullable=False)
    transaction_type_index = Column(Integer, nullable=True)

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "header_signature",
            name="uq_csv_format_mappings_header_signature"
        ),
    )


class ImportBatch(Base):

    __tablename__ = "import_batches"

    id = Column(
        Integer,
        primary_key=True
    )

    filename = Column(
        String,
        nullable=False
    )

    imported_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now()
    )

    row_count = Column(
        Integer,
        nullable=False,
        default=0
    )

    skipped_duplicate_count = Column(
        Integer,
        nullable=False,
        default=0
    )

    transactions = relationship(
        "Transaction",
        back_populates="import_batch",
        cascade="all, delete-orphan"
    )


class Transaction(Base):

    __tablename__ = "transactions"

    id = Column(
        Integer,
        primary_key=True
    )

    import_batch_id = Column(
        Integer,
        ForeignKey("import_batches.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    account_id = Column(
        Integer,
        ForeignKey("accounts.id", ondelete="RESTRICT"),
        nullable=True,
        index=True
    )

    category_id = Column(
        Integer,
        ForeignKey("categories.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )

    categorized_by_rule_id = Column(
        Integer,
        ForeignKey("category_rules.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )

    bsb_number = Column(
        String,
        nullable=True
    )

    account_number = Column(
        String,
        nullable=False
    )

    transaction_date = Column(
        Date,
        nullable=False
    )

    narration = Column(
        String,
        nullable=False
    )

    cheque_number = Column(
        String,
        nullable=True
    )

    debit = Column(
        Numeric(12, 2),
        nullable=True
    )

    credit = Column(
        Numeric(12, 2),
        nullable=True
    )

    balance = Column(
        Numeric(12, 2),
        nullable=False
    )

    transaction_type = Column(
        String,
        nullable=False
    )

    # Free text, entirely separate from splits.note below (a per-transaction
    # note vs. a per-allocation one - a split transaction can have both).
    note = Column(
        String,
        nullable=True
    )

    import_batch = relationship(
        "ImportBatch",
        back_populates="transactions"
    )

    account = relationship(
        "Account",
        back_populates="transactions"
    )

    category = relationship(
        "Category",
        back_populates="transactions"
    )

    categorized_by_rule = relationship(
        "CategoryRule",
        back_populates="tagged_transactions"
    )

    # ORM-level cascade, not just the FK's ondelete=CASCADE - mirrors every
    # other cascade in this file (see delete_category's comment): SQLite
    # ignores ondelete without PRAGMA foreign_keys=ON, so an FK-only cascade
    # would pass every test while behaving differently against Postgres.
    # delete_transaction in api/transactions.py relies on this.
    splits = relationship(
        "TransactionSplit",
        back_populates="transaction",
        cascade="all, delete-orphan"
    )

    @property
    def account_name(self):

        return self.account.name if self.account else None

    @property
    def category_name(self):

        return self.category.name if self.category else None

    @property
    def is_split(self):

        return len(self.splits) > 0

    __table_args__ = (
        Index(
            "ix_transactions_dup_lookup",
            "account_number",
            "transaction_date",
            "narration",
            "debit",
            "credit",
            "balance"
        ),
    )


class TransactionSplit(Base):
    """One category's slice of a split transaction.

    A transaction is either UNSPLIT (its own category_id, exactly as before
    splits existed) or SPLIT (category_id NULL, N of these rows instead -
    see api/transactions.py's split endpoints, which enforce that a
    transaction is never both at once). Splits must sum EXACTLY to the
    transaction's own signed amount (debit negative, credit positive, same
    convention as everywhere else) - enforced on write in
    api/transactions.py, not just trusted, since a partial allocation would
    make every report silently under-count. amount here is signed the same
    way, not an absolute value - a split of a debit transaction has a
    negative amount.

    services/allocations.py is what every money query (reporting, trends,
    budgets) actually reads through instead of Transaction directly, so an
    unsplit transaction and a split one contribute to totals identically.

    category_id mirrors Transaction.category_id's own rules exactly: never
    a category that has children (see Category.parent_id's docstring -
    "grouping only" applies here too), and SET NULL (enforced explicitly in
    Python, not left to the FK - see delete_category) rather than deleted
    when its category goes.
    """

    __tablename__ = "transaction_splits"

    id = Column(
        Integer,
        primary_key=True
    )

    transaction_id = Column(
        Integer,
        ForeignKey("transactions.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    category_id = Column(
        Integer,
        ForeignKey("categories.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )

    amount = Column(
        Numeric(12, 2),
        nullable=False
    )

    note = Column(
        String,
        nullable=True
    )

    transaction = relationship(
        "Transaction",
        back_populates="splits"
    )

    category = relationship(
        "Category",
        back_populates="splits"
    )

    @property
    def category_name(self):

        return self.category.name if self.category else None


class RecurringDismissal(Base):
    """A user's decision that a detected recurring series is not actually
    recurring (a false positive). See services/recurring.py for how series
    are detected - detection itself is never stored, only this opt-out.

    Keyed on (account_id, narration_key) rather than a transaction or series
    id, because there is no persisted series to point at - the same key a
    future detection run produces is compared against this table to decide
    whether to exclude it.
    """

    __tablename__ = "recurring_dismissals"

    id = Column(
        Integer,
        primary_key=True
    )

    account_id = Column(
        Integer,
        ForeignKey("accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    narration_key = Column(
        String,
        nullable=False
    )

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now()
    )

    account = relationship("Account", back_populates="recurring_dismissals")

    __table_args__ = (
        UniqueConstraint(
            "account_id",
            "narration_key",
            name="uq_recurring_dismissals_account_narration_key"
        ),
    )


class CategoryBudget(Base):
    """A per-month override of a category's standing budget_amount.

    Only a ROW HERE means "this month is different" - the absence of a row
    means "use the standing amount", not "no budget this month". amount is
    NOT NULL specifically so an override of 0.00 (a real budget of zero,
    spending against it reads as over budget) can never be confused with "no
    override" - see services/budgets.effective_budget for the resolution
    rule every caller must go through rather than re-deriving.
    """

    __tablename__ = "category_budgets"

    id = Column(
        Integer,
        primary_key=True
    )

    category_id = Column(
        Integer,
        ForeignKey("categories.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    year = Column(
        Integer,
        nullable=False
    )

    month = Column(
        Integer,
        nullable=False
    )

    amount = Column(
        Numeric(12, 2),
        nullable=False
    )

    category = relationship("Category", back_populates="budgets")

    __table_args__ = (
        UniqueConstraint(
            "category_id",
            "year",
            "month",
            name="uq_category_budgets_category_year_month"
        ),
    )
