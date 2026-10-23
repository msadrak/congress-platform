"""exhibitor leads can be deleted and restored (soft delete)

Revision ID: 0027
Revises: 0023
Create Date: 2026-10-23

`leads.deleted_at` marks a lead the booth removed from its list and exports; it can be restored, and scanning
the attendee again restores it. Booth staff removal deletes the assignment row (leads keep their
`captured_by_user_id`), and networking/bookmark rules are enforced in code, so no other column is needed.

Expand only: a nullable column. The previous release still works on it (it simply shows deleted leads).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0027"
down_revision: Union[str, Sequence[str], None] = "0023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None
backward_compatible = True


def upgrade() -> None:
    op.add_column("leads", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("leads", "deleted_at")
