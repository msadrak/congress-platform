"""organizer members: people who sign in to an organizer's console with a role (ADR 0016)

Revision ID: 0029
Revises: 0028
Create Date: 2026-10-23

Existing organizers keep working with their API key (treated as the owner); members are added by the platform
admin (the first owner) and then by owners.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0029"
down_revision: Union[str, Sequence[str], None] = "0028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None
# Expand only: a new table the previous release never reads or writes (CODING_STANDARDS §2.D).
backward_compatible = True


def upgrade() -> None:
    op.create_table(
        "organizer_members",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organizer_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("invited_by", sa.String(length=200), server_default="", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("session_version", sa.Integer(), server_default="0", nullable=False),
        sa.CheckConstraint("role IN ('owner', 'manager', 'staff', 'viewer')", name="ck_organizer_members_role"),
        sa.CheckConstraint("session_version >= 0", name="ck_organizer_members_session_version"),
        sa.ForeignKeyConstraint(["organizer_id"], ["organizers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organizer_id", "user_id", name="uq_organizer_members_organizer_user"),
    )
    op.create_index("ix_organizer_members_organizer_id", "organizer_members", ["organizer_id"])
    op.create_index("ix_organizer_members_user_id", "organizer_members", ["user_id"])


def downgrade() -> None:
    # Lossy: members are forgotten; the organizer's API key keeps working.
    op.drop_index("ix_organizer_members_user_id", table_name="organizer_members")
    op.drop_index("ix_organizer_members_organizer_id", table_name="organizer_members")
    op.drop_table("organizer_members")
