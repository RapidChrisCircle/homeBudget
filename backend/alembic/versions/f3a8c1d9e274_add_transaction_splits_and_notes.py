"""add transaction splits and notes

Revision ID: f3a8c1d9e274
Revises: b14b6f2a9c31
Create Date: 2026-08-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f3a8c1d9e274'
down_revision: Union[str, Sequence[str], None] = 'b14b6f2a9c31'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('transactions', sa.Column('note', sa.String(), nullable=True))

    op.create_table(
        'transaction_splits',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('transaction_id', sa.Integer(), nullable=False),
        sa.Column('category_id', sa.Integer(), nullable=True),
        sa.Column('amount', sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column('note', sa.String(), nullable=True),
        sa.ForeignKeyConstraint(
            ['transaction_id'], ['transactions.id'],
            name='fk_transaction_splits_transaction_id_transactions', ondelete='CASCADE'
        ),
        sa.ForeignKeyConstraint(
            ['category_id'], ['categories.id'],
            name='fk_transaction_splits_category_id_categories', ondelete='SET NULL'
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_transaction_splits_transaction_id'), 'transaction_splits', ['transaction_id'], unique=False
    )
    op.create_index(
        op.f('ix_transaction_splits_category_id'), 'transaction_splits', ['category_id'], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_transaction_splits_category_id'), table_name='transaction_splits')
    op.drop_index(op.f('ix_transaction_splits_transaction_id'), table_name='transaction_splits')
    op.drop_table('transaction_splits')
    op.drop_column('transactions', 'note')
