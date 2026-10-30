"""add transaction query indexes

Revision ID: a9c4b1e8d203
Revises: f39a2c7d1e84
Create Date: 2026-10-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a9c4b1e8d203'
down_revision: Union[str, Sequence[str], None] = 'f39a2c7d1e84'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_index(
        'ix_transactions_account_date_id',
        'transactions',
        ['account_id', 'transaction_date', 'id'],
        unique=False,
    )
    op.create_index(
        'ix_transactions_date_id',
        'transactions',
        ['transaction_date', 'id'],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_transactions_date_id', table_name='transactions')
    op.drop_index('ix_transactions_account_date_id', table_name='transactions')

