"""add category archived flag

Revision ID: a4f7b4f9bfe6
Revises: a7c5e21b6f04
Create Date: 2026-08-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a4f7b4f9bfe6'
down_revision: Union[str, Sequence[str], None] = 'a7c5e21b6f04'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'categories',
        sa.Column('archived', sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('categories', 'archived')
