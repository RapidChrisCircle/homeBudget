"""add account groups

Revision ID: 4a4f62ef9386
Revises: c3d8f4a29e6b
Create Date: 2026-08-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4a4f62ef9386'
down_revision: Union[str, Sequence[str], None] = 'c3d8f4a29e6b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'account_groups',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
    )

    op.add_column('accounts', sa.Column('group_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_accounts_group_id'), 'accounts', ['group_id'], unique=False)
    op.create_foreign_key(
        'fk_accounts_group_id_account_groups',
        'accounts', 'account_groups',
        ['group_id'], ['id'],
        ondelete='SET NULL'
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('fk_accounts_group_id_account_groups', 'accounts', type_='foreignkey')
    op.drop_index(op.f('ix_accounts_group_id'), table_name='accounts')
    op.drop_column('accounts', 'group_id')
    op.drop_table('account_groups')
