from sqlalchemy import Column, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, func
from sqlalchemy.orm import relationship

from .database import Base


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
