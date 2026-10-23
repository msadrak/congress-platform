"""ticket prints and desk check-in attribution

Revision ID: 0026
Revises: 0025
Create Date: 2026-10-23

`ticket_prints`: every badge printed at the reception desk (first print or reprint), who printed it, and a
fingerprint of what the badge showed (registration name, organization, title, tier and QR code), so the desk
can tell when a registration changed after its last print. The fingerprint is a hash: no personal data is
copied, and deleting an account needs nothing here.

`desk_checkins`: a check-in recorded from the desk ("admit at point X"), and which desk operator or organizer
member recorded it. The check-in itself is an ordinary `checkins` row decided by the gate rules.

Expand only: two new tables the previous release never reads or writes (CODING_STANDARDS §2.D).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0026"
down_revision: Union[str, Sequence[str], None] = "0025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None
backward_compatible = True


def upgrade() -> None:
    op.create_table(
        "ticket_prints",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("ticket_id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("printed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("printed_by_type", sa.String(length=32), nullable=False),
        sa.Column("printed_by_id", sa.String(length=64), nullable=True),
        sa.Column("printed_by_label", sa.String(length=200), server_default="", nullable=False),
        sa.Column("reason", sa.String(length=16), nullable=False),
        sa.Column("content_fingerprint", sa.String(length=64), nullable=False),
        sa.CheckConstraint("reason IN ('first', 'reprint')", name="ck_ticket_prints_reason"),
        sa.ForeignKeyConstraint(["ticket_id"], ["tickets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ticket_prints_ticket_printed_at", "ticket_prints", ["ticket_id", "printed_at"])
    op.create_index("ix_ticket_prints_event_id", "ticket_prints", ["event_id"])

    op.create_table(
        "desk_checkins",
        sa.Column("checkin_id", sa.Uuid(), nullable=False),
        sa.Column("desk_operator_id", sa.Uuid(), nullable=True),
        sa.Column("actor_type", sa.String(length=32), nullable=False),
        sa.Column("actor_label", sa.String(length=200), server_default="", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["checkin_id"], ["checkins.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["desk_operator_id"], ["desk_operators.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("checkin_id"),
    )
    op.create_index("ix_desk_checkins_desk_operator_id", "desk_checkins", ["desk_operator_id"])


def downgrade() -> None:
    # Lossy: print history and desk attribution are forgotten; the check-ins themselves stay.
    op.drop_index("ix_desk_checkins_desk_operator_id", table_name="desk_checkins")
    op.drop_table("desk_checkins")
    op.drop_index("ix_ticket_prints_event_id", table_name="ticket_prints")
    op.drop_index("ix_ticket_prints_ticket_printed_at", table_name="ticket_prints")
    op.drop_table("ticket_prints")
