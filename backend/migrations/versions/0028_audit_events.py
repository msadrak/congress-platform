"""append-only audit log of organizer, desk and platform actions (ADR 0016)

Revision ID: 0028
Revises: 0027
Create Date: 2026-10-23

No foreign keys on purpose: an audit row outlives the organizer, event or person it names. A trigger refuses
UPDATE and DELETE, so the application (or anyone with its database role) cannot rewrite the trail; TRUNCATE by
an operator remains possible and is out of scope.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0028"
down_revision: Union[str, Sequence[str], None] = "0027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None
# Expand only: a new table the previous release never reads or writes (CODING_STANDARDS §2.D).
backward_compatible = True

ACTOR_TYPES = "'platform_admin', 'organizer_key', 'organizer_member', 'desk_operator', 'booth_staff', 'system'"


def upgrade() -> None:
    op.create_table(
        "audit_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("actor_type", sa.String(length=32), nullable=False),
        sa.Column("actor_id", sa.String(length=64), nullable=True),
        sa.Column("actor_label", sa.String(length=200), server_default="", nullable=False),
        sa.Column("organizer_id", sa.Uuid(), nullable=True),
        sa.Column("event_id", sa.Uuid(), nullable=True),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("entity_type", sa.String(length=50), nullable=True),
        sa.Column("entity_id", sa.String(length=64), nullable=True),
        sa.Column(
            "summary", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False
        ),
        sa.Column("ip", sa.String(length=64), nullable=True),
        sa.Column("request_id", sa.String(length=128), nullable=True),
        sa.CheckConstraint(f"actor_type IN ({ACTOR_TYPES})", name="ck_audit_events_actor_type"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_events_at", "audit_events", ["at"])
    op.create_index("ix_audit_events_organizer_at", "audit_events", ["organizer_id", "at"])
    op.create_index("ix_audit_events_event_at", "audit_events", ["event_id", "at"])
    op.execute(
        """
        CREATE FUNCTION audit_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'audit_events is append-only';
        END;
        $$
        """
    )
    op.execute(
        "CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events "
        "FOR EACH ROW EXECUTE FUNCTION audit_events_append_only()"
    )


def downgrade() -> None:
    # Lossy: the recorded trail is dropped.
    op.execute("DROP TRIGGER audit_events_append_only ON audit_events")
    op.execute("DROP FUNCTION audit_events_append_only()")
    op.drop_index("ix_audit_events_event_at", table_name="audit_events")
    op.drop_index("ix_audit_events_organizer_at", table_name="audit_events")
    op.drop_index("ix_audit_events_at", table_name="audit_events")
    op.drop_table("audit_events")
