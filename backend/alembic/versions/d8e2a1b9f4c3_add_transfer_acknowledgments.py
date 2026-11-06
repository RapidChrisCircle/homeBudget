"""add transfer acknowledgments table

Revision ID: d8e2a1b9f4c3
Revises: c1f8a4b2e9d3
Create Date: 2026-11-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd8e2a1b9f4c3'
down_revision: Union[str, Sequence[str], None] = 'c1f8a4b2e9d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'transfer_acknowledgments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('key', sa.String(), nullable=False),
        sa.Column('leg_a_id', sa.Integer(), sa.ForeignKey('transactions.id', ondelete='CASCADE'), nullable=True),
        sa.Column('leg_b_id', sa.Integer(), sa.ForeignKey('transactions.id', ondelete='CASCADE'), nullable=True),
        sa.Column('transaction_id', sa.Integer(), sa.ForeignKey('transactions.id', ondelete='CASCADE'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('key', name='uq_transfer_acknowledgments_key'),
    )
    op.create_index('ix_transfer_acknowledgments_key', 'transfer_acknowledgments', ['key'])
    op.create_index('ix_transfer_acknowledgments_leg_a_id', 'transfer_acknowledgments', ['leg_a_id'])
    op.create_index('ix_transfer_acknowledgments_leg_b_id', 'transfer_acknowledgments', ['leg_b_id'])
    op.create_index('ix_transfer_acknowledgments_transaction_id', 'transfer_acknowledgments', ['transaction_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_transfer_acknowledgments_transaction_id', table_name='transfer_acknowledgments')
    op.drop_index('ix_transfer_acknowledgments_leg_b_id', table_name='transfer_acknowledgments')
    op.drop_index('ix_transfer_acknowledgments_leg_a_id', table_name='transfer_acknowledgments')
    op.drop_index('ix_transfer_acknowledgments_key', table_name='transfer_acknowledgments')
    op.drop_table('transfer_acknowledgments')

