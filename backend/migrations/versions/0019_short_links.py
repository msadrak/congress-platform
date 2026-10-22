"""SMS short links: a short code per ticket that opens the pass in one tap (ADR 0015)

Revision ID: 0019
Revises: 0018
Create Date: 2026-10-22

Every existing ticket gets one code, valid until 30 days after its event ends, so a confirmation resent
from the desk carries a short link too. Codes are generated here with `secrets` (the same alphabet and
length as app/links.py, copied so this migration never changes when the application code does).
"""
import secrets
from datetime import timedelta
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0019"
down_revision: Union[str, Sequence[str], None] = "0018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"
CODE_LENGTH = 10
LIFETIME_AFTER_EVENT = timedelta(days=30)


def upgrade() -> None:
    short_links = op.create_table(
        "short_links",
        sa.Column("code", sa.String(length=16), nullable=False),
        sa.Column("ticket_id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("first_opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("open_count", sa.Integer(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["ticket_id"], ["tickets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("code"),
    )
    op.create_index(op.f("ix_short_links_ticket_id"), "short_links", ["ticket_id"], unique=False)
    op.create_index(op.f("ix_short_links_event_id"), "short_links", ["event_id"], unique=False)

    rows = op.get_bind().execute(
        sa.text("SELECT t.id, t.event_id, e.ends_at FROM tickets t JOIN events e ON e.id = t.event_id")
    ).all()
    codes: set[str] = set()
    backfill = []
    for ticket_id, event_id, ends_at in rows:
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        while code in codes:
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        codes.add(code)
        backfill.append(
            {"code": code, "ticket_id": ticket_id, "event_id": event_id, "expires_at": ends_at + LIFETIME_AFTER_EVENT}
        )
    if backfill:
        op.bulk_insert(short_links, backfill)


def downgrade() -> None:
    # Lossy: every SMS link already sent stops working.
    op.drop_index(op.f("ix_short_links_event_id"), table_name="short_links")
    op.drop_index(op.f("ix_short_links_ticket_id"), table_name="short_links")
    op.drop_table("short_links")
