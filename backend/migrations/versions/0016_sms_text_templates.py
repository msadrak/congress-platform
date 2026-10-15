"""SMS as plain text from the sms.ir service line, with templates stored in the app

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-15

sms.ir panel templates are no longer used: the platform sends text from its service line, and the wording is
kept in `sms_templates` (platform-wide, or one event's override). The SMS log keeps the final text instead of
a template id and parameters, plus the event it belongs to.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0016"
down_revision: Union[str, Sequence[str], None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sms_templates",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=True),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_sms_templates_platform", "sms_templates", ["kind"], unique=True,
        postgresql_where=sa.text("event_id IS NULL"),
    )
    op.create_index(
        "uq_sms_templates_event", "sms_templates", ["event_id", "kind"], unique=True,
        postgresql_where=sa.text("event_id IS NOT NULL"),
    )

    op.add_column("sms_messages", sa.Column("body", sa.Text(), nullable=True))
    op.add_column("sms_messages", sa.Column("event_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_sms_messages_event_id", "sms_messages", "events", ["event_id"], ["id"], ondelete="CASCADE"
    )
    op.create_index(op.f("ix_sms_messages_event_id"), "sms_messages", ["event_id"])
    # Queued confirmations keep their event (through the ticket); their text was never rendered, so they are
    # closed as failed rather than sent with the wrong wording. Only test data existed.
    op.execute(
        "UPDATE sms_messages m SET event_id = t.event_id FROM tickets t WHERE m.ticket_id = t.id"
    )
    op.execute(
        "UPDATE sms_messages SET status = 'failed', last_error = 'MIGRATED_TO_TEXT' WHERE status = 'pending'"
    )
    op.drop_column("sms_messages", "params")
    op.drop_column("sms_messages", "template_id")


def downgrade() -> None:
    op.add_column("sms_messages", sa.Column("template_id", sa.Integer(), server_default="0", nullable=False))
    op.add_column(
        "sms_messages", sa.Column("params", postgresql.JSONB(astext_type=sa.Text()), nullable=True)
    )
    op.drop_index(op.f("ix_sms_messages_event_id"), table_name="sms_messages")
    op.drop_constraint("fk_sms_messages_event_id", "sms_messages", type_="foreignkey")
    op.drop_column("sms_messages", "event_id")
    op.drop_column("sms_messages", "body")
    op.drop_index("uq_sms_templates_event", table_name="sms_templates")
    op.drop_index("uq_sms_templates_platform", table_name="sms_templates")
    op.drop_table("sms_templates")
