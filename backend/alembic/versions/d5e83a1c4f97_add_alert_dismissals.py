"""add alert dismissals

Revision ID: d5e83a1c4f97
Revises: c4d72f8e91a3
Create Date: 2026-09-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd5e83a1c4f97'
down_revision: Union[str, Sequence[str], None] = 'c4d72f8e91a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'alert_dismissals',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('alert_key', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('alert_key', name='uq_alert_dismissals_alert_key'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('alert_dismissals')
