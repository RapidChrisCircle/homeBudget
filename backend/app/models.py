from sqlalchemy import Column, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, UniqueConstraint, func
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

    @property
    def account_name(self):

        return self.account.name if self.account else None

    @property
    def category_name(self):

        return self.category.name if self.category else None

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
