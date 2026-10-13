"""page studio: per-event public page (draft + published snapshot) and uploaded media

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-13

Compatibility policy: every event that exists when this runs was public, so it gets a page whose draft
and published snapshot both equal the pre-Page-Studio layout. Its public URL keeps working unchanged.
Events created afterwards start with a draft only and become public on their first Publish.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0013"
down_revision: Union[str, Sequence[str], None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Frozen copy of app.page_document.default_page_document() at this revision (migrations never import app code).
LEGACY_PAGE_DOCUMENT = '{"version":1,"primary_locale":"auto","branding":{"accent":"auto","logo_asset_id":null},"hero":{"layout":"signature","eyebrow":{"fa":"","en":""},"title":{"fa":"","en":""},"subtitle":{"fa":"","en":""},"cta_label":{"fa":"","en":""},"cover_asset_id":null},"seo":{"title":{"fa":"","en":""},"description":{"fa":"","en":""},"share_image_asset_id":null},"sections":[{"id":"about","visible":true,"eyebrow":{"fa":"","en":""},"title":{"fa":"","en":""},"type":"about","body":{"fa":"","en":""}},{"id":"highlights","visible":true,"eyebrow":{"fa":"","en":""},"title":{"fa":"","en":""},"type":"highlights","layout":"list","items":[{"icon":"qr","title":{"fa":"کارت ورود دیجیتال QR","en":"Digital QR Pass"},"body":{"fa":"نشان پرکنتراست برای پذیرش سریع در گیت\u200cهای ورود.","en":"Instant high-contrast badge for seamless check-in at venue gates."}},{"icon":"booth","title":{"fa":"دسترسی به نمایشگاه","en":"Exhibition Access"},"body":{"fa":"غرفه\u200cهای شرکت\u200cهای حاضر را ببینید و بروشورهای دیجیتال را دریافت کنید.","en":"Discover participating company booths and download digital brochures."}},{"icon":"users","title":{"fa":"شبکه\u200cسازی","en":"Peer Networking"},"body":{"fa":"با دیگر شرکت\u200cکنندگان ارتباط بگیرید و کارت ویزیت دیجیتال آن\u200cها را دریافت کنید.","en":"Connect with fellow delegates and download vCards directly."}},{"icon":"wifi-off","title":{"fa":"دسترسی آفلاین","en":"Offline Pass Access"},"body":{"fa":"کارت ورود در مرورگر دستگاه شما ذخیره می\u200cماند تا ورود سریع باشد.","en":"Passes stay saved in your personal device browser for fast entry."}}]},{"id":"passes","visible":true,"eyebrow":{"fa":"","en":""},"title":{"fa":"","en":""},"type":"passes","lead":{"fa":"","en":""}},{"id":"exhibitors","visible":true,"eyebrow":{"fa":"","en":""},"title":{"fa":"","en":""},"type":"exhibitors","lead":{"fa":"","en":""}}]}'


def upgrade() -> None:
    op.create_table(
        "event_pages",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("draft", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("draft_revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("draft_updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("published", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("published_revision", sa.Integer(), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_asset_ids", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False),
        sa.CheckConstraint("draft_revision >= 1", name="ck_event_pages_draft_revision"),
        sa.CheckConstraint("(published IS NULL) = (published_at IS NULL)", name="ck_event_pages_published_pair"),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("event_id"),
    )
    op.create_table(
        "media_assets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("content_type", sa.String(length=32), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("storage_key", sa.String(length=200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("storage_key"),
    )
    op.create_index(op.f("ix_media_assets_event_id"), "media_assets", ["event_id"], unique=False)

    # Existing events stay public: draft == published == the layout they already had.
    op.execute(
        sa.text(
            "INSERT INTO event_pages (event_id, draft, draft_revision, published, published_revision, published_at) "
            "SELECT id, CAST(:doc AS jsonb), 1, CAST(:doc AS jsonb), 1, now() FROM events"
        ).bindparams(doc=LEGACY_PAGE_DOCUMENT)
    )


def downgrade() -> None:
    # Lossy: drops page drafts, published pages and media metadata (files under the media root remain).
    op.drop_index(op.f("ix_media_assets_event_id"), table_name="media_assets")
    op.drop_table("media_assets")
    op.drop_table("event_pages")
