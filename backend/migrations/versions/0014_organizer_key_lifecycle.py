"""organizer API key lifecycle: revocation and rotation timestamps

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-13

Existing organizers keep their current key unchanged (both columns start NULL = active, never rotated).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0014"
down_revision: Union[str, Sequence[str], None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("organizers", sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("organizers", sa.Column("key_rotated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    # Lossy: forgets revocations, so a revoked key would work again. Never use as operational rollback.
    op.drop_column("organizers", "key_rotated_at")
    op.drop_column("organizers", "revoked_at")
