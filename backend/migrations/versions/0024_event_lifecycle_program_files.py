"""event lifecycle, tier sales windows and schedule files

Revision ID: 0024
Revises: 0023
Create Date: 2026-10-22

Events gain a time zone (IANA, default Asia/Tehran), a registration switch and optional window, a `listed`
flag for the public event list and `archived_at`. Ticket tiers gain an optional sales window. `program_files`
holds the congress schedule uploaded as a PDF or an image; its bytes live under the media root at a
server-generated key, and deleting an event removes its rows.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0024"
down_revision: Union[str, Sequence[str], None] = "0023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None
# Expand only (new columns with defaults or nullable, a new table): the 0023 release runs on this schema.
backward_compatible = True


def upgrade() -> None:
    op.add_column("events", sa.Column("timezone", sa.String(length=64), server_default="Asia/Tehran", nullable=False))
    op.add_column("events", sa.Column("registration_enabled", sa.Boolean(), server_default="true", nullable=False))
    op.add_column("events", sa.Column("registration_opens_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("events", sa.Column("registration_closes_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("events", sa.Column("listed", sa.Boolean(), server_default="false", nullable=False))
    op.add_column("events", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))

    op.add_column("ticket_tiers", sa.Column("sales_starts_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("ticket_tiers", sa.Column("sales_ends_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "program_files",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_visible", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("content_type", sa.String(length=32), nullable=False),
        sa.Column("storage_key", sa.String(length=200), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("page_count", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("kind IN ('pdf', 'image')", name="ck_program_files_kind"),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("storage_key"),
    )
    op.create_index(op.f("ix_program_files_event_id"), "program_files", ["event_id"], unique=False)


def downgrade() -> None:
    # Lossy: drops every schedule file row (the stored bytes stay on the media volume) and the lifecycle fields.
    op.drop_index(op.f("ix_program_files_event_id"), table_name="program_files")
    op.drop_table("program_files")
    op.drop_column("ticket_tiers", "sales_ends_at")
    op.drop_column("ticket_tiers", "sales_starts_at")
    for column in ("archived_at", "listed", "registration_closes_at", "registration_opens_at", "registration_enabled", "timezone"):
        op.drop_column("events", column)
