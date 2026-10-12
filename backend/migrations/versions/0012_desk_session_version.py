"""add monotonic desk session generations

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-12
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0012"
down_revision: Union[str, Sequence[str], None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "desk_operators",
        sa.Column("session_version", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_check_constraint(
        "ck_desk_operators_session_version", "desk_operators", "session_version >= 0",
    )


def downgrade() -> None:
    # Lossy: generation history is security state. Never use as operational rollback.
    op.drop_constraint(
        "ck_desk_operators_session_version", "desk_operators", type_="check",
    )
    op.drop_column("desk_operators", "session_version")
