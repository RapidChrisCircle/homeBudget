"""add account type validation and balance sign

Revision ID: e91c2a5d7f38
Revises: a4f7b4f9bfe6
Create Date: 2026-08-05 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e91c2a5d7f38'
down_revision: Union[str, Sequence[str], None] = 'a4f7b4f9bfe6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Mirrors app.models.ACCOUNT_TYPES - not imported from there, since a
# migration must keep working even if that tuple changes shape later; this
# is the set as it existed the day this migration was written.
_KNOWN_TYPES = "'everyday', 'savings', 'investment', 'credit_card', 'loan', 'mortgage'"


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'accounts',
        sa.Column('balance_sign', sa.String(), nullable=False, server_default='natural'),
    )

    # account_type was always free text (no CHECK constraint), so existing
    # rows can hold anything - normalize to one of the six known types
    # (case/whitespace-insensitive) and NULL out everything else, rather
    # than force-fitting unrecognised text into a guessed type. NULL means
    # "unclassified" - see Account's own docstring in models.py for why
    # services/net_worth.py deliberately excludes those from the total
    # instead of guessing. This is a genuine data migration, not just DDL -
    # there is no default-everything-to-"everyday" step here on purpose.
    op.execute(
        f"""
        UPDATE accounts
        SET account_type = CASE
            WHEN LOWER(TRIM(account_type)) IN ({_KNOWN_TYPES})
            THEN LOWER(TRIM(account_type))
            ELSE NULL
        END
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('accounts', 'balance_sign')
