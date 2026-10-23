"""ticket lifecycle and participant management: registration details, cancellation, reissue, privacy

Revision ID: 0023
Revises: 0019
Create Date: 2026-10-22

A user (one per mobile number) is shared by every congress on the platform, so an organizer edits the
registration, not the account: each ticket gets its own copy of the attendee's name, organization and title,
backfilled from the account. Tickets can now be cancelled (`status` is constrained to active/cancelled) and
reissued (a new QR secret). Users get exhibitor-contact consent (default off: a lead shows the mobile only
with consent) and `deleted_at` for self-service account deletion (the row is anonymised, not removed, so
check-in statistics still add up).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0023"
down_revision: Union[str, Sequence[str], None] = "0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tickets", sa.Column("attendee_full_name", sa.String(length=200), nullable=True))
    op.add_column(
        "tickets", sa.Column("attendee_organization", sa.String(length=200), server_default="", nullable=False)
    )
    op.add_column("tickets", sa.Column("attendee_title", sa.String(length=100), server_default="", nullable=False))
    op.add_column("tickets", sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tickets", sa.Column("cancelled_reason", sa.String(length=300), nullable=True))
    op.add_column("tickets", sa.Column("cancelled_by", sa.String(length=32), nullable=True))
    op.add_column("tickets", sa.Column("reissued_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "tickets",
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.execute(
        "UPDATE tickets AS t SET attendee_full_name = u.full_name, attendee_organization = u.organization, "
        "attendee_title = u.title FROM users AS u WHERE u.id = t.user_id"
    )
    op.alter_column("tickets", "attendee_full_name", nullable=False)
    # Every ticket issued so far is "active" (nothing ever wrote another value); the CHECK makes that explicit.
    op.create_check_constraint("ck_tickets_status", "tickets", "status IN ('active', 'cancelled')")

    op.add_column(
        "users",
        sa.Column("share_contact_with_exhibitors", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column("users", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    # Lossy: registration edits, cancellation details and consent are dropped (statuses are kept).
    op.drop_column("users", "deleted_at")
    op.drop_column("users", "share_contact_with_exhibitors")
    op.drop_constraint("ck_tickets_status", "tickets", type_="check")
    for column in (
        "updated_at",
        "reissued_at",
        "cancelled_by",
        "cancelled_reason",
        "cancelled_at",
        "attendee_title",
        "attendee_organization",
        "attendee_full_name",
    ):
        op.drop_column("tickets", column)
