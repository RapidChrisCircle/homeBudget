"""add skipped_authorisation_count to import_batches

Revision ID: d1a9f4c6b8e2
Revises: 4a4f62ef9386
Create Date: 2026-08-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd1a9f4c6b8e2'
down_revision: Union[str, Sequence[str], None] = '4a4f62ef9386'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'import_batches',
        sa.Column('skipped_authorisation_count', sa.Integer(), nullable=False, server_default='0'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('import_batches', 'skipped_authorisation_count')
