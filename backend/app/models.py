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

    budget_amount is a single recurring MONTHLY figure (positive dollars,
    NULL = no budget set) that applies to every month - there is no
    per-month override. Only meaningful when kind == "expense".
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

    transactions = relationship(
        "Transaction",
        back_populates="category"
    )

    rules = relationship(
        "CategoryRule",
        back_populates="category"
    )

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
