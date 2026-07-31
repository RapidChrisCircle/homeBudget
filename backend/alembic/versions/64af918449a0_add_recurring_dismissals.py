"""add recurring dismissals

Revision ID: 64af918449a0
Revises: 7bb1999e6c44
Create Date: 2026-08-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '64af918449a0'
down_revision: Union[str, Sequence[str], None] = '7bb1999e6c44'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('recurring_dismissals',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('account_id', sa.Integer(), nullable=False),
    sa.Column('narration_key', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], name='fk_recurring_dismissals_account_id_accounts', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('account_id', 'narration_key', name='uq_recurring_dismissals_account_narration_key')
    )
    op.create_index(op.f('ix_recurring_dismissals_account_id'), 'recurring_dismissals', ['account_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_recurring_dismissals_account_id'), table_name='recurring_dismissals')
    op.drop_table('recurring_dismissals')
