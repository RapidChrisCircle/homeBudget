"""add budget rollover to categories

Revision ID: b891fd23e6a1
Revises: a762ac78878d
Create Date: 2026-09-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b891fd23e6a1'
down_revision: Union[str, Sequence[str], None] = 'a762ac78878d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'categories',
        sa.Column('rolls_over', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column('categories', sa.Column('rollover_start_year', sa.Integer(), nullable=True))
    op.add_column('categories', sa.Column('rollover_start_month', sa.Integer(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('categories', 'rollover_start_month')
    op.drop_column('categories', 'rollover_start_year')
    op.drop_column('categories', 'rolls_over')
