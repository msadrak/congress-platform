"""desk operators and walk-in ticket attribution

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-11 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0011"
down_revision: Union[str, Sequence[str], None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "desk_operators",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("operator_name", sa.String(length=200), nullable=False),
        sa.Column("is_revoked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", "user_id", name="uq_desk_operators_event_user"),
    )
    op.create_index("ix_desk_operators_event_id", "desk_operators", ["event_id"], unique=False)
    op.create_index("ix_desk_operators_user_id", "desk_operators", ["user_id"], unique=False)
    op.create_index("ix_desk_operators_is_revoked", "desk_operators", ["is_revoked"], unique=False)

    op.add_column(
        "tickets",
        sa.Column("issued_by_operator_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_tickets_desk_operator",
        "tickets",
        "desk_operators",
        ["issued_by_operator_id"],
        ["id"],
    )
    op.create_index(
        "ix_tickets_issued_by_operator_id",
        "tickets",
        ["issued_by_operator_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_tickets_issued_by_operator_id", table_name="tickets")
    op.drop_constraint("fk_tickets_desk_operator", "tickets", type_="foreignkey")
    op.drop_column("tickets", "issued_by_operator_id")
    op.drop_index("ix_desk_operators_is_revoked", table_name="desk_operators")
    op.drop_index("ix_desk_operators_user_id", table_name="desk_operators")
    op.drop_index("ix_desk_operators_event_id", table_name="desk_operators")
    op.drop_table("desk_operators")
