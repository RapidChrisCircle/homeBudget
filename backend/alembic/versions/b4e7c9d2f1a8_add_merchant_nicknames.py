"""add merchant nicknames

Revision ID: b4e7c9d2f1a8
Revises: a9c4b1e8d203
Create Date: 2026-11-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b4e7c9d2f1a8'
down_revision: Union[str, Sequence[str], None] = 'a9c4b1e8d203'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'merchant_nicknames',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('narration_key', sa.String(), nullable=False),
        sa.Column('nickname', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('narration_key', name='uq_merchant_nicknames_narration_key'),
    )
    op.create_index('ix_merchant_nicknames_narration_key', 'merchant_nicknames', ['narration_key'], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_merchant_nicknames_narration_key', table_name='merchant_nicknames')
    op.drop_table('merchant_nicknames')

