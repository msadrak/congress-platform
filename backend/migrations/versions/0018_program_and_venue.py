"""congress program and venue directory: sessions, entrances and halls

Revision ID: 0018
Revises: 0017
Create Date: 2026-10-22

Operational data shown to attendees as soon as it is saved (no Page Studio publish). Venue places are
informational (where to find an entrance or a hall), not Check-In Points. Deleting a hall keeps its
sessions without a hall; deleting an event removes both tables' rows.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0018"
down_revision: Union[str, Sequence[str], None] = "0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "venue_places",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("location", sa.String(length=300), server_default="", nullable=False),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("kind IN ('entrance', 'hall')", name="ck_venue_places_kind"),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_venue_places_event_id"), "venue_places", ["event_id"], unique=False)
    op.create_table(
        "event_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("track", sa.String(length=80), server_default="", nullable=False),
        sa.Column("speakers", sa.String(length=300), server_default="", nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("hall_id", sa.Uuid(), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("ends_at >= starts_at", name="ck_event_sessions_time_order"),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["hall_id"], ["venue_places.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_event_sessions_event_id"), "event_sessions", ["event_id"], unique=False)
    op.create_index(op.f("ix_event_sessions_hall_id"), "event_sessions", ["hall_id"], unique=False)


def downgrade() -> None:
    # Lossy: drops every event's program and venue directory.
    op.drop_index(op.f("ix_event_sessions_hall_id"), table_name="event_sessions")
    op.drop_index(op.f("ix_event_sessions_event_id"), table_name="event_sessions")
    op.drop_table("event_sessions")
    op.drop_index(op.f("ix_venue_places_event_id"), table_name="venue_places")
    op.drop_table("venue_places")
