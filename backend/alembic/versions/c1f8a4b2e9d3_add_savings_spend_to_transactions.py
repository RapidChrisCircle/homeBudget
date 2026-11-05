"""add savings spend to transactions and splits

Revision ID: c1f8a4b2e9d3
Revises: b4e7c9d2f1a8
Create Date: 2026-11-05 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1f8a4b2e9d3'
down_revision: Union[str, Sequence[str], None] = 'b4e7c9d2f1a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'transactions',
        sa.Column('is_savings_spend', sa.Boolean(), nullable=False, server_default=sa.text('false'))
    )
    op.create_index('ix_transactions_is_savings_spend', 'transactions', ['is_savings_spend'])
    op.add_column(
        'transaction_splits',
        sa.Column('is_savings_spend', sa.Boolean(), nullable=False, server_default=sa.text('false'))
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('transaction_splits', 'is_savings_spend')
    op.drop_index('ix_transactions_is_savings_spend', table_name='transactions')
    op.drop_column('transactions', 'is_savings_spend')

