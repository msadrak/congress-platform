"""Turns a stored page document into what the public renderer consumes: the document plus the images it
references, each with its intrinsic size (the client reserves the space, so nothing shifts on load)."""

import uuid
from collections.abc import Callable
from typing import Any

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MediaAsset
from app.page_document import PageDocument


class PageAsset(BaseModel):
    id: uuid.UUID
    url: str
    width: int
    height: int
    content_type: str


class PublicPage(BaseModel):
    document: PageDocument
    assets: list[PageAsset]


def public_media_url(asset: MediaAsset) -> str:
    return public_media_path(asset.id)


def public_media_path(asset_id: uuid.UUID) -> str:
    return f"/api/public/media/{asset_id}"


def booth_logo_url(asset_id: uuid.UUID | None) -> str | None:
    """A booth's logo as the public image address, or None. Needs no query: the foreign key keeps the id valid."""
    return public_media_path(asset_id) if asset_id is not None else None


def organizer_media_url(asset: MediaAsset) -> str:
    """Needs the organizer's Authorization header: the preview fetches it as a blob."""
    return f"/api/events/{asset.event_id}/media/{asset.id}/content"


async def render_page(
    session: AsyncSession,
    event_id: uuid.UUID,
    stored: dict[str, Any],
    url_for: Callable[[MediaAsset], str],
) -> PublicPage:
    document = PageDocument.model_validate(stored)
    wanted = document.asset_ids()
    assets: list[PageAsset] = []
    if wanted:
        rows = await session.scalars(
            select(MediaAsset)
            .where(MediaAsset.event_id == event_id, MediaAsset.id.in_(wanted))
            .order_by(MediaAsset.created_at, MediaAsset.id)
        )
        assets = [
            PageAsset(
                id=row.id,
                url=url_for(row),
                width=row.width,
                height=row.height,
                content_type=row.content_type,
            )
            for row in rows
        ]
    return PublicPage(document=document, assets=assets)
