"""add pay schedule

Revision ID: c4d72f8e91a3
Revises: b891fd23e6a1
Create Date: 2026-09-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4d72f8e91a3'
down_revision: Union[str, Sequence[str], None] = 'b891fd23e6a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'pay_schedule',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('anchor_date', sa.Date(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('pay_schedule')
