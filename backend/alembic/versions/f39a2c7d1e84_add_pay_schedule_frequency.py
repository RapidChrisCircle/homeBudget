"""add pay schedule frequency

Revision ID: f39a2c7d1e84
Revises: e28fb4860a15
Create Date: 2026-09-29 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f39a2c7d1e84'
down_revision: Union[str, Sequence[str], None] = 'e28fb4860a15'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'pay_schedule',
        sa.Column('frequency', sa.String(), nullable=False, server_default='fortnightly'),
    )
    # anchor_date is only meaningful for a "fortnightly" schedule - a
    # "monthly" (last business day) schedule has no anchor to store, every
    # period boundary being derivable straight from the calendar. Existing
    # rows are untouched (they're all fortnightly by definition, since that
    # was the only frequency before this migration), so this widens the
    # constraint without needing a data backfill.
    op.alter_column('pay_schedule', 'anchor_date', existing_type=sa.Date(), nullable=True)


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column('pay_schedule', 'anchor_date', existing_type=sa.Date(), nullable=False)
    op.drop_column('pay_schedule', 'frequency')
