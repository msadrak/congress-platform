"""scanner devices and per-device revocation

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-10 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0008'
down_revision: Union[str, Sequence[str], None] = '0007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'scanner_devices',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('checkin_point_id', sa.Uuid(), nullable=False),
        sa.Column('event_id', sa.Uuid(), nullable=False),
        sa.Column('device_name', sa.String(length=100), nullable=False, server_default='Scanner Client'),
        sa.Column('is_revoked', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['checkin_point_id'], ['checkin_points.id']),
        sa.ForeignKeyConstraint(['event_id'], ['events.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_scanner_devices_checkin_point_id'), 'scanner_devices', ['checkin_point_id'], unique=False)
    op.create_index(op.f('ix_scanner_devices_event_id'), 'scanner_devices', ['event_id'], unique=False)
    op.create_index(op.f('ix_scanner_devices_is_revoked'), 'scanner_devices', ['is_revoked'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_scanner_devices_is_revoked'), table_name='scanner_devices')
    op.drop_index(op.f('ix_scanner_devices_event_id'), table_name='scanner_devices')
    op.drop_index(op.f('ix_scanner_devices_checkin_point_id'), table_name='scanner_devices')
    op.drop_table('scanner_devices')
