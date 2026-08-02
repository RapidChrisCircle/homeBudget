"""add csv format mappings

Revision ID: a7c5e21b6f04
Revises: f3a8c1d9e274
Create Date: 2026-08-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7c5e21b6f04'
down_revision: Union[str, Sequence[str], None] = 'f3a8c1d9e274'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'csv_format_mappings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('institution', sa.String(), nullable=True),
        sa.Column('header_signature', sa.String(), nullable=False),
        sa.Column('date_format', sa.String(), nullable=False),
        sa.Column('amount_mode', sa.String(), nullable=False, server_default='debit_credit'),
        sa.Column('bsb_index', sa.Integer(), nullable=True),
        sa.Column('account_number_index', sa.Integer(), nullable=False),
        sa.Column('transaction_date_index', sa.Integer(), nullable=False),
        sa.Column('narration_index', sa.Integer(), nullable=False),
        sa.Column('cheque_number_index', sa.Integer(), nullable=True),
        sa.Column('debit_index', sa.Integer(), nullable=True),
        sa.Column('credit_index', sa.Integer(), nullable=True),
        sa.Column('amount_index', sa.Integer(), nullable=True),
        sa.Column('balance_index', sa.Integer(), nullable=False),
        sa.Column('transaction_type_index', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('header_signature', name='uq_csv_format_mappings_header_signature'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('csv_format_mappings')
