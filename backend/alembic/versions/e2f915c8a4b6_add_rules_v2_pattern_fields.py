"""add rules v2 pattern fields

Revision ID: e2f915c8a4b6
Revises: d5e83a1c4f97
Create Date: 2026-09-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e2f915c8a4b6'
down_revision: Union[str, Sequence[str], None] = 'd5e83a1c4f97'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('category_rules', sa.Column('additional_patterns', sa.JSON(), nullable=True))
    op.add_column(
        'category_rules',
        sa.Column('use_regex', sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('category_rules', 'use_regex')
    op.drop_column('category_rules', 'additional_patterns')
