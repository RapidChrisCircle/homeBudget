"""add savings goals

Revision ID: c3d8f4a29e6b
Revises: e91c2a5d7f38
Create Date: 2026-08-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3d8f4a29e6b'
down_revision: Union[str, Sequence[str], None] = 'e91c2a5d7f38'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'savings_goals',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('target_amount', sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column('target_date', sa.Date(), nullable=True),
        sa.Column('mode', sa.String(), nullable=False, server_default='account_balance'),
        sa.Column('account_id', sa.Integer(), nullable=True),
        sa.Column('allocated_amount', sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column('archived', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(
            ['account_id'], ['accounts.id'],
            name='fk_savings_goals_account_id_accounts', ondelete='SET NULL'
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_savings_goals_account_id'), 'savings_goals', ['account_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_savings_goals_account_id'), table_name='savings_goals')
    op.drop_table('savings_goals')
