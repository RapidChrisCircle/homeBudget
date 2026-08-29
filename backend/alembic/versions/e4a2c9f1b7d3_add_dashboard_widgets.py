"""add dashboard_widgets, seeded with the default layout

Revision ID: e4a2c9f1b7d3
Revises: d1a9f4c6b8e2
Create Date: 2026-08-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e4a2c9f1b7d3'
down_revision: Union[str, Sequence[str], None] = 'd1a9f4c6b8e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'dashboard_widgets',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('widget_type', sa.String(), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('width', sa.String(), nullable=False, server_default='quarter'),
        sa.Column('config', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    # Seeded HERE, once, rather than by the application on first read of an
    # empty table - a user's own edit (removing a widget entirely) has to
    # stay removed, and an app-level "seed if empty" check can't tell that
    # apart from "nobody has customised this yet". This is the exact
    # dashboard every install had BEFORE it became customisable (see
    # DashboardPage.jsx's own history), plus one representative instance of
    # each of the four NEW widget families this migration's release adds -
    # every widget_type here is described in app.models.DASHBOARD_WIDGET_TYPES
    # (not imported from there, for the same reason
    # e91c2a5d7f38_add_account_type_and_balance_sign.py's own comment gives:
    # a migration keeps working even if that tuple's shape changes later).
    dashboard_widgets = sa.table(
        'dashboard_widgets',
        sa.column('widget_type', sa.String()),
        sa.column('position', sa.Integer()),
        sa.column('width', sa.String()),
        sa.column('config', sa.JSON()),
    )

    op.bulk_insert(dashboard_widgets, [
        {'widget_type': 'stat_tile', 'position': 1, 'width': 'quarter',
         'config': {'metric': 'total_income', 'months': 6}},
        {'widget_type': 'stat_tile', 'position': 2, 'width': 'quarter',
         'config': {'metric': 'total_expenses', 'months': 6}},
        {'widget_type': 'stat_tile', 'position': 3, 'width': 'quarter',
         'config': {'metric': 'avg_per_month', 'months': 6}},
        {'widget_type': 'stat_tile', 'position': 4, 'width': 'quarter',
         'config': {'metric': 'avg_per_transaction', 'months': 6}},
        {'widget_type': 'accounts', 'position': 5, 'width': 'half', 'config': None},
        {'widget_type': 'goals', 'position': 6, 'width': 'half', 'config': None},
        {'widget_type': 'cash_flow', 'position': 7, 'width': 'half', 'config': None},
        {'widget_type': 'net_worth_chart', 'position': 8, 'width': 'half', 'config': None},
        {'widget_type': 'net_worth_change', 'position': 9, 'width': 'quarter', 'config': {'months': 6}},
        {'widget_type': 'comparison_sparkline', 'position': 10, 'width': 'half',
         'config': {'comparisonBasis': 'last_month'}},
        {'widget_type': 'summary', 'position': 11, 'width': 'half', 'config': None},
        {'widget_type': 'needs_attention', 'position': 12, 'width': 'half', 'config': None},
        {'widget_type': 'recurring', 'position': 13, 'width': 'half', 'config': None},
        {'widget_type': 'uncategorized', 'position': 14, 'width': 'half', 'config': None},
        {'widget_type': 'transaction_calendar', 'position': 15, 'width': 'full', 'config': {'months': 1}},
        {'widget_type': 'recent_activity', 'position': 16, 'width': 'full', 'config': None},
    ])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('dashboard_widgets')
