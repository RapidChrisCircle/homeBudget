"""add category budgets

Revision ID: 2996d3c0ebdd
Revises: 64af918449a0
Create Date: 2026-08-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2996d3c0ebdd'
down_revision: Union[str, Sequence[str], None] = '64af918449a0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('category_budgets',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('category_id', sa.Integer(), nullable=False),
    sa.Column('year', sa.Integer(), nullable=False),
    sa.Column('month', sa.Integer(), nullable=False),
    sa.Column('amount', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.ForeignKeyConstraint(['category_id'], ['categories.id'], name='fk_category_budgets_category_id_categories', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('category_id', 'year', 'month', name='uq_category_budgets_category_year_month')
    )
    op.create_index(op.f('ix_category_budgets_category_id'), 'category_budgets', ['category_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_category_budgets_category_id'), table_name='category_budgets')
    op.drop_table('category_budgets')
