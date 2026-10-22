"""mobile number identity with SMS one-time codes; e-mail and passwords removed

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-15

Users are identified by an Iranian mobile number proven by an SMS code (ADR 0012). The e-mail and password
columns are dropped; existing accounts keep their id, profile, tickets and roles but have no mobile until an
organizer or the person signs in with a number (only test/staging data existed when this shipped).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0015"
down_revision: Union[str, Sequence[str], None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("mobile", sa.String(length=11), nullable=True))
    op.create_index(op.f("ix_users_mobile"), "users", ["mobile"], unique=True)
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_column("users", "email")
    op.drop_column("users", "password_hash")

    op.create_table(
        "otp_challenges",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("mobile", sa.String(length=11), nullable=False),
        sa.Column("purpose", sa.String(length=16), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_otp_challenges_lookup", "otp_challenges", ["mobile", "purpose", "created_at"])

    op.create_table(
        "sms_messages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("mobile", sa.String(length=11), nullable=False),
        sa.Column("template_id", sa.Integer(), nullable=False),
        sa.Column("params", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("ticket_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("provider_message_id", sa.BigInteger(), nullable=True),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("send_after", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_error", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["ticket_id"], ["tickets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("kind", "ticket_id", name="uq_sms_messages_kind_ticket"),
    )
    op.create_index(op.f("ix_sms_messages_status"), "sms_messages", ["status"])
    op.create_index(op.f("ix_sms_messages_send_after"), "sms_messages", ["send_after"])
    op.create_index(op.f("ix_sms_messages_ticket_id"), "sms_messages", ["ticket_id"])


def downgrade() -> None:
    # Lossy: mobile numbers and the SMS log are discarded; every account gets an unusable placeholder e-mail
    # and password. Never use as operational rollback.
    op.drop_index(op.f("ix_sms_messages_ticket_id"), table_name="sms_messages")
    op.drop_index(op.f("ix_sms_messages_send_after"), table_name="sms_messages")
    op.drop_index(op.f("ix_sms_messages_status"), table_name="sms_messages")
    op.drop_table("sms_messages")
    op.drop_index("ix_otp_challenges_lookup", table_name="otp_challenges")
    op.drop_table("otp_challenges")

    op.add_column("users", sa.Column("password_hash", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("email", sa.String(length=255), nullable=True))
    op.execute("UPDATE users SET email = 'user-' || id::text || '@migrated.invalid', password_hash = '!'")
    op.alter_column("users", "password_hash", nullable=False)
    op.alter_column("users", "email", nullable=False)
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)
    op.drop_index(op.f("ix_users_mobile"), table_name="users")
    op.drop_column("users", "mobile")
