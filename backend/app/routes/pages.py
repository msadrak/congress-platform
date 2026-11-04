"""Page Studio: the organizer's draft of the public page, its publication, preview and images.

Every route here is scoped by `OwnedEventDep` (another organizer's event is a 404). Saves and publishes
carry the draft revision they were based on and are refused with 409 when someone saved in between, so
two editors can never silently overwrite each other. Anonymous visitors only ever see the published
snapshot (see `routes/public.py`) and the images it references (`/api/public/media/{id}`).
"""

import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionDep
from app.errors import ApiError, error_responses
from app.media import (
    ACCEPTED_UPLOAD_TYPES,
    RejectedImage,
    delete_file,
    process_image,
    resolve_storage_path,
    storage_key_for,
    write_file,
)
from app.models import Booth, Event, EventPage, MediaAsset
from app.page_document import PageDocument
from app.page_render import organizer_media_url, render_page
from app.routes.events import OwnedEventDep, WritableEventDep, new_event_page
from app.routes.program import live_program
from app.routes.public import PublicBoothSummary, PublicEvent, booth_directory, event_lifecycle, event_tiers

router = APIRouter(tags=["page studio"])

MAX_ASSETS_PER_EVENT = 200
_IMAGE_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
}


class PageStateOut(BaseModel):
    event_id: uuid.UUID
    draft: PageDocument
    draft_revision: int
    draft_updated_at: datetime
    is_published: bool
    published_revision: int | None
    published_at: datetime | None
    # True while the draft holds edits that visitors do not see yet.
    has_unpublished_changes: bool


class PageDraftUpdate(BaseModel):
    revision: Annotated[int, Field(ge=1, description="draft_revision this edit was based on")]
    document: PageDocument


class PageRevision(BaseModel):
    revision: Annotated[int, Field(ge=1, description="draft_revision the action applies to")]


class PagePreview(PublicEvent):
    """The draft rendered with the same payload shape visitors get, plus the booth directory."""

    booths: list[PublicBoothSummary]


class MediaAssetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    content_type: str
    width: int
    height: int
    byte_size: int
    created_at: datetime


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _state(page: EventPage) -> PageStateOut:
    return PageStateOut(
        event_id=page.event_id,
        draft=PageDocument.model_validate(page.draft),
        draft_revision=page.draft_revision,
        draft_updated_at=page.draft_updated_at,
        is_published=page.published is not None,
        published_revision=page.published_revision,
        published_at=page.published_at,
        has_unpublished_changes=page.published is None or page.published_revision != page.draft_revision,
    )


async def _page(session: AsyncSession, event: Event, *, for_update: bool = False) -> EventPage:
    query = select(EventPage).where(EventPage.event_id == event.id)
    if for_update:
        query = query.with_for_update()
    page = await session.scalar(query)
    if page is None:
        # Only events inserted outside the API lack a page; they start unpublished like any new event.
        session.add(new_event_page(event.id))
        await session.flush()
        page = await session.scalar(query)
        assert page is not None
    return page


def _stale(page: EventPage) -> ApiError:
    return ApiError(
        status.HTTP_409_CONFLICT,
        "PAGE_DRAFT_STALE",
        f"The page was changed elsewhere (now at revision {page.draft_revision}). "
        "Reload the page studio before saving or publishing again.",
    )


async def _require_own_assets(session: AsyncSession, event: Event, document: PageDocument) -> None:
    wanted = document.asset_ids()
    if not wanted:
        return
    owned = set(
        await session.scalars(
            select(MediaAsset.id).where(MediaAsset.event_id == event.id, MediaAsset.id.in_(wanted))
        )
    )
    missing = wanted - owned
    if missing:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Image {sorted(str(m) for m in missing)[0]} is not one of this event's images",
        )


@router.get("/api/events/{event_id}/page")
async def get_page(event: OwnedEventDep, session: SessionDep) -> PageStateOut:
    page = await _page(session, event)
    await session.commit()
    return _state(page)


@router.put("/api/events/{event_id}/page", responses=error_responses(status.HTTP_409_CONFLICT))
async def save_page_draft(body: PageDraftUpdate, event: WritableEventDep, session: SessionDep) -> PageStateOut:
    page = await _page(session, event, for_update=True)
    if body.revision != page.draft_revision:
        raise _stale(page)
    await _require_own_assets(session, event, body.document)
    page.draft = body.document.model_dump(mode="json")
    page.draft_revision += 1
    page.draft_updated_at = _now()
    await session.commit()
    await session.refresh(page)
    return _state(page)


@router.post("/api/events/{event_id}/page/publish", responses=error_responses(status.HTTP_409_CONFLICT))
async def publish_page(body: PageRevision, event: WritableEventDep, session: SessionDep) -> PageStateOut:
    """Replaces the public page with the draft at `revision`, in one transaction."""
    page = await _page(session, event, for_update=True)
    if body.revision != page.draft_revision:
        raise _stale(page)
    document = PageDocument.model_validate(page.draft)
    await _require_own_assets(session, event, document)
    page.published = page.draft
    page.published_revision = page.draft_revision
    page.published_at = _now()
    page.published_asset_ids = sorted(str(asset_id) for asset_id in document.asset_ids())
    await session.commit()
    await session.refresh(page)
    return _state(page)


@router.post("/api/events/{event_id}/page/unpublish")
async def unpublish_page(event: WritableEventDep, session: SessionDep) -> PageStateOut:
    """Takes the public page (and the event's public booth pages) offline. The draft is kept; issued tickets,
    check-in and reception are unaffected, but attendees cannot reserve until the page is published again."""
    page = await _page(session, event, for_update=True)
    page.published = None
    page.published_revision = None
    page.published_at = None
    page.published_asset_ids = []
    await session.commit()
    await session.refresh(page)
    return _state(page)


@router.post("/api/events/{event_id}/page/discard", responses=error_responses(status.HTTP_409_CONFLICT))
async def discard_page_draft(body: PageRevision, event: WritableEventDep, session: SessionDep) -> PageStateOut:
    """Throws away unpublished edits: the draft becomes the published page again."""
    page = await _page(session, event, for_update=True)
    if body.revision != page.draft_revision:
        raise _stale(page)
    if page.published is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "The page has never been published; there is nothing to return to")
    page.draft = page.published
    page.draft_revision += 1
    page.published_revision = page.draft_revision
    page.draft_updated_at = _now()
    await session.commit()
    await session.refresh(page)
    return _state(page)


@router.get("/api/events/{event_id}/page/preview")
async def preview_page(event: OwnedEventDep, session: SessionDep) -> PagePreview:
    page = await _page(session, event)
    draft: dict[str, Any] = page.draft
    venue, sessions = await live_program(session, event.id)
    preview = PagePreview(
        id=event.id,
        name=event.name,
        slug=event.slug,
        starts_at=event.starts_at,
        ends_at=event.ends_at,
        location=event.location,
        description=event.description,
        ticket_tiers=await event_tiers(session, event.id),
        page=await render_page(session, event.id, draft, organizer_media_url),
        venue=venue,
        sessions=sessions,
        booths=await booth_directory(session, event.id),
        **event_lifecycle(event),
    )
    await session.commit()
    return preview


# ── Media ────────────────────────────────────────────────────────────────────────────────────────────


def _media_root(request: Request) -> Path:
    root: Path = request.app.state.settings.media_root
    return root


async def _own_asset(session: AsyncSession, event: Event, asset_id: uuid.UUID) -> MediaAsset:
    asset = await session.scalar(
        select(MediaAsset).where(MediaAsset.id == asset_id, MediaAsset.event_id == event.id)
    )
    if asset is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "MEDIA_NOT_FOUND", "Image not found")
    return asset


async def store_image(
    request: Request,
    session: AsyncSession,
    event_id: uuid.UUID,
    *,
    content_type: str | None,
    content_length: int | None,
    attach: Callable[[MediaAsset], Awaitable[None]] | None = None,
) -> MediaAsset:
    """Receives an uploaded image for the event's media library and commits it as a new `MediaAsset`.

    The declared type, the size (announced and streamed), emptiness and the per-event quota are checked first;
    then the bytes are decoded and re-encoded off the event loop (`process_image`) and written under a generated
    key. `attach` runs in the same transaction, before the commit (a booth taking the image as its logo, its
    audit row). When anything after the write fails, the file is removed again.
    """
    declared = (content_type or "").split(";")[0].strip().lower()
    if declared not in ACCEPTED_UPLOAD_TYPES:
        raise ApiError(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "IMAGE_TYPE_UNSUPPORTED", "Upload a PNG, JPEG or WebP image")
    limit: int = request.app.state.settings.media_max_bytes
    too_large = ApiError(
        status.HTTP_413_CONTENT_TOO_LARGE, "IMAGE_TOO_LARGE", f"Images are limited to {limit // (1024 * 1024)} MB"
    )
    if content_length is not None and content_length > limit:
        raise too_large
    count = await session.scalar(select(func.count(MediaAsset.id)).where(MediaAsset.event_id == event_id)) or 0
    if count >= MAX_ASSETS_PER_EVENT:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "MEDIA_LIMIT_REACHED",
            "This event already has the maximum number of images; delete unused ones first",
        )

    received = bytearray()
    async for chunk in request.stream():
        received.extend(chunk)
        if len(received) > limit:
            raise too_large
    if not received:
        raise ApiError(status.HTTP_400_BAD_REQUEST, "IMAGE_EMPTY", "The upload is empty")

    try:
        image = await run_in_threadpool(process_image, bytes(received))
    except RejectedImage as exc:
        raise ApiError(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "IMAGE_REJECTED", str(exc)) from None

    asset_id = uuid.uuid4()
    key = storage_key_for(event_id, asset_id, image.extension)
    root = _media_root(request)
    await run_in_threadpool(write_file, root, key, image.data)
    asset = MediaAsset(
        id=asset_id,
        event_id=event_id,
        content_type=image.content_type,
        width=image.width,
        height=image.height,
        byte_size=len(image.data),
        sha256=image.sha256,
        storage_key=key,
    )
    try:
        session.add(asset)
        await session.flush()
        if attach is not None:
            await attach(asset)
        await session.commit()
    except BaseException:
        await run_in_threadpool(delete_file, root, key)
        raise
    await session.refresh(asset)
    return asset


# Statuses `store_image` answers with, for `responses=` on the routes that call it.
IMAGE_UPLOAD_ERRORS = (
    status.HTTP_400_BAD_REQUEST,
    status.HTTP_409_CONFLICT,
    status.HTTP_413_CONTENT_TOO_LARGE,
    status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
)
IMAGE_REQUEST_BODY: dict[str, Any] = {
    "requestBody": {
        "required": True,
        "description": "The image bytes. PNG, JPEG or WebP; SVG and other formats are refused.",
        "content": {t: {"schema": {"type": "string", "format": "binary"}} for t in sorted(ACCEPTED_UPLOAD_TYPES)},
    }
}


async def delete_if_unused(session: AsyncSession, event_id: uuid.UUID, asset_id: uuid.UUID | None) -> str | None:
    """Deletes an image a booth stopped using as its logo, unless the event's page (draft or published) or a
    booth's logo still uses it. Call it after the booth change; returns the storage key, so the caller deletes
    the file once the transaction has committed (`delete_media_file`), or None when the image stays."""
    if asset_id is None:
        return None
    asset = await session.scalar(select(MediaAsset).where(MediaAsset.id == asset_id, MediaAsset.event_id == event_id))
    if asset is None:
        return None
    page = await session.scalar(select(EventPage).where(EventPage.event_id == event_id).with_for_update())
    if page is not None and (
        asset.id in PageDocument.model_validate(page.draft).asset_ids() or str(asset.id) in page.published_asset_ids
    ):
        return None
    if await session.scalar(select(Booth.id).where(Booth.logo_asset_id == asset.id).limit(1)) is not None:
        return None
    key = asset.storage_key
    await session.delete(asset)
    return key


async def delete_media_file(request: Request, key: str | None) -> None:
    if key is not None:
        await run_in_threadpool(delete_file, _media_root(request), key)


def _file_response(request: Request, asset: MediaAsset, cache_control: str) -> FileResponse:
    path = resolve_storage_path(_media_root(request), asset.storage_key)
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")
    return FileResponse(
        path,
        media_type=asset.content_type,
        headers={**_IMAGE_SECURITY_HEADERS, "Cache-Control": cache_control},
        content_disposition_type="inline",
        filename=path.name,
    )


@router.get("/api/events/{event_id}/media")
async def list_media(event: OwnedEventDep, session: SessionDep) -> list[MediaAssetOut]:
    assets = await session.scalars(
        select(MediaAsset).where(MediaAsset.event_id == event.id).order_by(MediaAsset.created_at.desc(), MediaAsset.id)
    )
    return [MediaAssetOut.model_validate(asset) for asset in assets]


@router.post(
    "/api/events/{event_id}/media",
    status_code=status.HTTP_201_CREATED,
    openapi_extra=IMAGE_REQUEST_BODY,
    responses=error_responses(*IMAGE_UPLOAD_ERRORS),
)
async def upload_media(
    request: Request,
    event: WritableEventDep,
    session: SessionDep,
    content_type: Annotated[str | None, Header()] = None,
    content_length: Annotated[int | None, Header()] = None,
) -> MediaAssetOut:
    asset = await store_image(request, session, event.id, content_type=content_type, content_length=content_length)
    return MediaAssetOut.model_validate(asset)


@router.get(
    "/api/events/{event_id}/media/{asset_id}/content",
    response_class=FileResponse,
    responses={200: {"content": {"image/*": {}}}},
)
async def organizer_media_content(
    asset_id: uuid.UUID, request: Request, event: OwnedEventDep, session: SessionDep
) -> FileResponse:
    asset = await _own_asset(session, event, asset_id)
    return _file_response(request, asset, "private, max-age=300")


@router.delete("/api/events/{event_id}/media/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_media(asset_id: uuid.UUID, request: Request, event: WritableEventDep, session: SessionDep) -> Response:
    page = await _page(session, event, for_update=True)
    asset = await _own_asset(session, event, asset_id)
    in_draft = asset.id in PageDocument.model_validate(page.draft).asset_ids()
    if in_draft or str(asset.id) in page.published_asset_ids:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This image is used by the page draft or the published page; remove it there (and publish) first",
        )
    key = asset.storage_key
    await session.delete(asset)
    await session.commit()
    await run_in_threadpool(delete_file, _media_root(request), key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/api/public/media/{asset_id}",
    response_class=FileResponse,
    responses={200: {"content": {"image/*": {}}}},
    tags=["public"],
)
async def public_media(asset_id: uuid.UUID, request: Request, session: SessionDep) -> FileResponse:
    """Anonymous image access: only images the published page of an unarchived event references, and its booths'
    logos (an archived event's public page is gone, like its schedule files)."""
    asset = await session.get(MediaAsset, asset_id)
    if asset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")
    page = await session.get(EventPage, asset.event_id)
    archived_at = await session.scalar(select(Event.archived_at).where(Event.id == asset.event_id))
    if page is None or page.published is None or archived_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")
    if str(asset.id) not in page.published_asset_ids:
        # A booth logo is public with the event's booth pages: while the page is published.
        logo_of = await session.scalar(
            select(Booth.id).where(Booth.logo_asset_id == asset.id, Booth.event_id == asset.event_id).limit(1)
        )
        if logo_of is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")
    return _file_response(request, asset, "public, max-age=3600")
