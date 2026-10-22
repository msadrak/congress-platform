"""check-in client verdict and clock-skew audit columns

Revision ID: 0020
Revises: 0018
Create Date: 2026-10-22

A scanner that decided a scan on its own (offline, or when the server did not answer in time) now says
so when it uploads it. `client_verdict` keeps that decision (ADMITTED, PROVISIONAL or REJECTED); a scan
the device rejected is recorded as REJECTED and is never turned into an admission at sync time.

`clock_skew` marks a scan whose device time was later than the server's clock allows; its `scanned_at`
is then the server's receive time and the device's claim is kept in `client_scanned_at` for audit.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0020"
down_revision: Union[str, Sequence[str], None] = "0018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("checkins", sa.Column("client_verdict", sa.String(length=16), nullable=True))
    op.add_column(
        "checkins",
        sa.Column("clock_skew", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column(
        "checkins", sa.Column("client_scanned_at", sa.DateTime(timezone=True), nullable=True)
    )
    # The manifest delta asks "which tickets changed admission state at this point since the cursor".
    op.create_index(
        "ix_checkins_point_synced_at", "checkins", ["checkin_point_id", "synced_at"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_checkins_point_synced_at", table_name="checkins")
    op.drop_column("checkins", "client_scanned_at")
    op.drop_column("checkins", "clock_skew")
    op.drop_column("checkins", "client_verdict")
