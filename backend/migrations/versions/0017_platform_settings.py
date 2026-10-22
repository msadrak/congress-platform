"""platform settings edited in the platform console (SMS gateway, sign-in rules)

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-15

A key/value table: an absent key means the environment value (CONGRESS_*) applies, so existing deployments
behave exactly as before until the platform admin saves a setting. Credentials are stored encrypted
(app/secret_box.py).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0017"
down_revision: Union[str, Sequence[str], None] = "0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "platform_settings",
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    # Lossy: settings saved in the console are forgotten; the environment values apply again.
    op.drop_table("platform_settings")
