"""attendee session version: signing out and account deletion end every session of the account

Revision ID: 0030
Revises: 0029
Create Date: 2026-10-23

User access tokens carry the account's `session_version` (claim `sv`); signing out and deleting the account
increment it, so every earlier token stops working at once (app/routes/auth.py).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0030"
down_revision: Union[str, Sequence[str], None] = "0029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None
# Expand only: a column with a server default that the previous release neither reads nor writes
# (CODING_STANDARDS §2.D). An older API on this schema simply ignores it (its tokens carry no `sv`).
backward_compatible = True


def upgrade() -> None:
    op.add_column("users", sa.Column("session_version", sa.Integer(), server_default="0", nullable=False))
    op.create_check_constraint("ck_users_session_version", "users", "session_version >= 0")


def downgrade() -> None:
    op.drop_constraint("ck_users_session_version", "users", type_="check")
    op.drop_column("users", "session_version")
