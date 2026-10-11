"""admission concurrency control and single use unique index

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-10 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0009'
down_revision: Union[str, Sequence[str], None] = '0008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # 1. Add policy_type column to checkins table
    op.add_column(
        'checkins',
        sa.Column('policy_type', sa.String(length=32), nullable=False, server_default='MULTI_ENTRY')
    )

    # 2. Backfill policy_type from parent checkin_points table
    op.execute(
        """
        UPDATE checkins
        SET policy_type = checkin_points.policy_type
        FROM checkin_points
        WHERE checkins.checkin_point_id = checkin_points.id
        """
    )

    # 3. Add partial unique index: at most one ADMITTED record per (checkin_point_id, ticket_id) for SINGLE_USE points
    op.create_index(
        'uq_checkin_single_use_admitted',
        'checkins',
        ['checkin_point_id', 'ticket_id'],
        unique=True,
        postgresql_where=sa.text("status = 'ADMITTED' AND policy_type = 'SINGLE_USE' AND ticket_id IS NOT NULL")
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('uq_checkin_single_use_admitted', table_name='checkins')
    op.drop_column('checkins', 'policy_type')
