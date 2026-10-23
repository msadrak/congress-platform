"""Shared rate limits and the SMS outbox lease

Revision ID: 0022
Revises: 0019
Create Date: 2026-10-23

`rate_limit_counters` holds throttling counts in PostgreSQL so every API process (and every restart) sees the
same budgets. `sms_messages.lease_until` lets the outbox claim a message (`status = 'sending'`) in a short
transaction and send it outside any transaction; a lease that runs out marks the message `unknown`.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0022"
down_revision: Union[str, Sequence[str], None] = "0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "rate_limit_counters",
        sa.Column("key", sa.String(length=200), nullable=False),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("key", "window_start"),
    )
    op.create_index(op.f("ix_rate_limit_counters_expires_at"), "rate_limit_counters", ["expires_at"], unique=False)
    op.add_column("sms_messages", sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    # A message claimed at that moment is left `sending`; mark it unknown so it is never sent twice.
    op.execute("UPDATE sms_messages SET status = 'unknown', last_error = 'LEASE_EXPIRED' WHERE status = 'sending'")
    op.drop_column("sms_messages", "lease_until")
    op.drop_index(op.f("ix_rate_limit_counters_expires_at"), table_name="rate_limit_counters")
    op.drop_table("rate_limit_counters")
