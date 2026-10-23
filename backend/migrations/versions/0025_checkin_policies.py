"""check-in policies: admission windows, occupancy (entry/exit), point hierarchy, session doors, archive, device heartbeat

Revision ID: 0025
Revises: 0030
Create Date: 2026-10-23

`checkin_points` gains the rules ADR 0010 promised and ADR 0004 described:

* `reset_window` (EVENT or DAY): a SINGLE_USE point admits a ticket once per window; DAY windows are calendar days
  in the event's time zone (`events.timezone`), e.g. daily catering. A capped point without occupancy counts its
  admissions per window.
* `tracks_occupancy`: scans carry a direction (entry or exit) and the point knows who is inside; a capped point
  then caps the people inside instead of the cumulative admissions.
* `requires_point_id`: a ticket must have been admitted at that point (of the same event) first.
* `session_id`: the point is the door of a programme session; its admissions are the session's attendance.
* `archived_at`: hidden from scanners and pairing, kept with its scans for analytics.

`checkins` gains `direction` (IN or OUT) and `admission_window` ('event', or the local date of the scan for a DAY
point). The single-use unique index now includes the window: one admission per ticket, point and window.

`scanner_devices` gains what the scanner reports in its heartbeat (unsynced scans, app version, time).

Expand only (CODING_STANDARDS §2.D): new nullable columns or columns with a server default, new CHECK constraints
on the new columns only, and a unique index replaced by a less restrictive one. The previous release keeps working on
this schema; it ignores the new rules (a DAY point admits once per event, a tier filter on a non tier-restricted
point is not applied, exits are not offered), which is the expected behaviour of a rollback.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0025"
down_revision: Union[str, Sequence[str], None] = "0030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None
backward_compatible = True

SINGLE_USE_ADMITTED = "status = 'ADMITTED' AND policy_type = 'SINGLE_USE' AND ticket_id IS NOT NULL"


def upgrade() -> None:
    op.add_column(
        "checkin_points", sa.Column("reset_window", sa.String(length=8), server_default="EVENT", nullable=False)
    )
    op.add_column(
        "checkin_points", sa.Column("tracks_occupancy", sa.Boolean(), server_default=sa.false(), nullable=False)
    )
    op.add_column("checkin_points", sa.Column("requires_point_id", sa.Uuid(), nullable=True))
    op.add_column("checkin_points", sa.Column("session_id", sa.Uuid(), nullable=True))
    op.add_column("checkin_points", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint(
        "ck_checkin_points_reset_window", "checkin_points", "reset_window IN ('EVENT', 'DAY')"
    )
    op.create_foreign_key(
        "fk_checkin_points_requires_point_id",
        "checkin_points",
        "checkin_points",
        ["requires_point_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_checkin_points_session_id", "checkin_points", "event_sessions", ["session_id"], ["id"], ondelete="SET NULL"
    )
    op.create_index("ix_checkin_points_session_id", "checkin_points", ["session_id"])

    op.add_column("checkins", sa.Column("direction", sa.String(length=3), server_default="IN", nullable=False))
    op.add_column(
        "checkins", sa.Column("admission_window", sa.String(length=10), server_default="event", nullable=False)
    )
    op.create_check_constraint("ck_checkins_direction", "checkins", "direction IN ('IN', 'OUT')")
    op.create_check_constraint(
        "ck_checkins_admission_window",
        "checkins",
        "admission_window = 'event' OR admission_window ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'",
    )
    op.create_index(
        "uq_checkin_single_use_window",
        "checkins",
        ["checkin_point_id", "ticket_id", "admission_window"],
        unique=True,
        postgresql_where=sa.text(SINGLE_USE_ADMITTED),
    )
    op.drop_index("uq_checkin_single_use_admitted", table_name="checkins")

    op.add_column("scanner_devices", sa.Column("unsynced_count", sa.Integer(), nullable=True))
    op.add_column("scanner_devices", sa.Column("app_version", sa.String(length=40), nullable=True))
    op.add_column("scanner_devices", sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("scanner_devices", "last_heartbeat_at")
    op.drop_column("scanner_devices", "app_version")
    op.drop_column("scanner_devices", "unsynced_count")

    # Fails, as it should, while a ticket holds admissions in two windows of one single-use point.
    op.create_index(
        "uq_checkin_single_use_admitted",
        "checkins",
        ["checkin_point_id", "ticket_id"],
        unique=True,
        postgresql_where=sa.text(SINGLE_USE_ADMITTED),
    )
    op.drop_index("uq_checkin_single_use_window", table_name="checkins")
    op.drop_constraint("ck_checkins_admission_window", "checkins", type_="check")
    op.drop_constraint("ck_checkins_direction", "checkins", type_="check")
    op.drop_column("checkins", "admission_window")
    op.drop_column("checkins", "direction")

    op.drop_index("ix_checkin_points_session_id", table_name="checkin_points")
    op.drop_constraint("fk_checkin_points_session_id", "checkin_points", type_="foreignkey")
    op.drop_constraint("fk_checkin_points_requires_point_id", "checkin_points", type_="foreignkey")
    op.drop_constraint("ck_checkin_points_reset_window", "checkin_points", type_="check")
    op.drop_column("checkin_points", "archived_at")
    op.drop_column("checkin_points", "session_id")
    op.drop_column("checkin_points", "requires_point_id")
    op.drop_column("checkin_points", "tracks_occupancy")
    op.drop_column("checkin_points", "reset_window")
