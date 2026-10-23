"""booth logo

Revision ID: 0031
Revises: 0026
Create Date: 2026-10-24

`booths.logo_asset_id`: the booth's logo, one of its event's images (`media_assets`). Booth representatives set
it from the booth panel and the organizer from the booth form; the public booth page and the booth directory
show it. Deleting the image clears the logo (ON DELETE SET NULL).

Expand only: a nullable column the previous release neither reads nor writes (CODING_STANDARDS §2.D).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0031"
down_revision: Union[str, Sequence[str], None] = "0026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None
backward_compatible = True


def upgrade() -> None:
    op.add_column("booths", sa.Column("logo_asset_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "booths_logo_asset_id_fkey", "booths", "media_assets", ["logo_asset_id"], ["id"], ondelete="SET NULL"
    )
    op.create_index("ix_booths_logo_asset_id", "booths", ["logo_asset_id"])


def downgrade() -> None:
    # Lossy: booths forget their logo; the images themselves stay in the event's media library.
    op.drop_index("ix_booths_logo_asset_id", table_name="booths")
    op.drop_constraint("booths_logo_asset_id_fkey", "booths", type_="foreignkey")
    op.drop_column("booths", "logo_asset_id")
