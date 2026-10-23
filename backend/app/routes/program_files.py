"""Schedule files: the congress program uploaded as a PDF or an image, beside the structured sessions.

Operational data like the program (ADR 0014): a visible file is live for attendees as soon as it is saved,
once the event's page is published. Uploads are the raw bytes with their `Content-Type` (as Page Studio
images), so no multipart parser is needed and the size limit is enforced while streaming. PDFs are accepted
by magic bytes and stored as uploaded; images go through the Page Studio re-encode pipeline. Either way the
file is stored under a server-generated name inside the media root and served with `nosniff` and a sandboxing
Content-Security-Policy.
"""

import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Header, HTTPException, Query, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionDep
from app.errors import ApiError, error_responses
from app.media import (
    ACCEPTED_UPLOAD_TYPES,
    RejectedImage,
    RejectedPdf,
    check_pdf,
    delete_file,
    process_image,
    resolve_storage_path,
    write_file,
)
from app.models import Event, EventPage, ProgramFile
from app.routes.events import OwnedEventDep, WritableEventDep

router = APIRouter(tags=["program files"])

PDF_TYPE = "application/pdf"
ACCEPTED_TYPES = frozenset({PDF_TYPE, *ACCEPTED_UPLOAD_TYPES})
# The edge (Caddy `request_body max_size 8MB`) caps bodies at 8,000,000 bytes; the API says the same.
MAX_PROGRAM_FILE_BYTES = 8_000_000
MAX_PROGRAM_FILES_PER_EVENT = 20
PUBLIC_CACHE = "public, max-age=3600"
_IMAGE_HEADERS = {"X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox"}
_PDF_HEADERS = {"X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox"}
_UNSAFE_FILENAME = re.compile(r'[\x00-\x1f\x7f"\\/:*?<>|]+')

Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class ProgramFileUpdate(BaseModel):
    label: Label | None = None
    position: Annotated[int, Field(ge=0, le=1_000_000)] | None = None
    is_visible: bool | None = None


class PublicProgramFile(BaseModel):
    id: uuid.UUID
    label: str
    kind: str
    content_type: str
    byte_size: int
    width: int | None
    height: int | None
    page_count: int | None
    # Anonymous URL (`/api/public/program-files/{id}`).
    url: str


class ProgramFileOut(BaseModel):
    id: uuid.UUID
    event_id: uuid.UUID
    label: str
    kind: str
    content_type: str
    position: int
    is_visible: bool
    byte_size: int
    width: int | None
    height: int | None
    page_count: int | None
    created_at: datetime
    # Needs the organizer's Authorization header (fetch it as a blob).
    content_url: str


def public_program_file_url(item: ProgramFile) -> str:
    return f"/api/public/program-files/{item.id}"


def _out(item: ProgramFile) -> ProgramFileOut:
    return ProgramFileOut(
        id=item.id,
        event_id=item.event_id,
        label=item.label,
        kind=item.kind,
        content_type=item.content_type,
        position=item.position,
        is_visible=item.is_visible,
        byte_size=item.byte_size,
        width=item.width,
        height=item.height,
        page_count=item.page_count,
        created_at=item.created_at,
        content_url=f"/api/events/{item.event_id}/program-files/{item.id}/content",
    )


def _ordered(event_id: uuid.UUID) -> Select[ProgramFile]:
    return (
        select(ProgramFile)
        .where(ProgramFile.event_id == event_id)
        .order_by(ProgramFile.position, ProgramFile.created_at, ProgramFile.id)
    )


async def visible_program_files(session: AsyncSession, event_id: uuid.UUID) -> list[PublicProgramFile]:
    """The schedule files attendees see, in the organizer's order. Part of the public event payload."""
    items = await session.scalars(_ordered(event_id).where(ProgramFile.is_visible.is_(True)))
    return [
        PublicProgramFile(
            id=item.id,
            label=item.label,
            kind=item.kind,
            content_type=item.content_type,
            byte_size=item.byte_size,
            width=item.width,
            height=item.height,
            page_count=item.page_count,
            url=public_program_file_url(item),
        )
        for item in items
    ]


def _media_root(request: Request) -> Path:
    root: Path = request.app.state.settings.media_root
    return root


async def _own_file(session: AsyncSession, event: Event, file_id: uuid.UUID) -> ProgramFile:
    item = await session.scalar(
        select(ProgramFile).where(ProgramFile.id == file_id, ProgramFile.event_id == event.id)
    )
    if item is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "PROGRAM_FILE_NOT_FOUND", "Schedule file not found")
    return item


def _download_name(item: ProgramFile) -> str:
    extension = Path(item.storage_key).suffix
    base = " ".join(_UNSAFE_FILENAME.sub(" ", item.label).split())[:100].strip(" .") or "schedule"
    return f"{base}{extension}"


def _file_response(request: Request, item: ProgramFile, cache_control: str) -> FileResponse:
    path = resolve_storage_path(_media_root(request), item.storage_key)
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Schedule file not found")
    fallback = "schedule" + path.suffix
    disposition = f"inline; filename=\"{fallback}\"; filename*=UTF-8''{quote(_download_name(item), safe='')}"
    security = _PDF_HEADERS if item.kind == "pdf" else _IMAGE_HEADERS
    return FileResponse(
        path,
        media_type=item.content_type,
        headers={**security, "Cache-Control": cache_control, "Content-Disposition": disposition},
    )


@router.get("/api/events/{event_id}/program-files")
async def list_program_files(event: OwnedEventDep, session: SessionDep) -> list[ProgramFileOut]:
    return [_out(item) for item in await session.scalars(_ordered(event.id))]


@router.post(
    "/api/events/{event_id}/program-files",
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(
        status.HTTP_400_BAD_REQUEST,
        status.HTTP_409_CONFLICT,
        status.HTTP_413_CONTENT_TOO_LARGE,
        status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        status.HTTP_422_UNPROCESSABLE_CONTENT,
    ),
    openapi_extra={
        "requestBody": {
            "required": True,
            "description": "The file bytes: a PDF, or a PNG, JPEG or WebP image. At most 8 MB.",
            "content": {t: {"schema": {"type": "string", "format": "binary"}} for t in sorted(ACCEPTED_TYPES)},
        }
    },
)
async def upload_program_file(
    request: Request,
    event: WritableEventDep,
    session: SessionDep,
    label: Annotated[str, Query(max_length=120, description="Name shown to attendees")],
    content_type: Annotated[str | None, Header()] = None,
    content_length: Annotated[int | None, Header()] = None,
) -> ProgramFileOut:
    label = label.strip()
    if not label:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_CONTENT, "PROGRAM_FILE_LABEL_REQUIRED", "Give the schedule file a label")
    declared = (content_type or "").split(";")[0].strip().lower()
    if declared not in ACCEPTED_TYPES:
        raise ApiError(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            "PROGRAM_FILE_TYPE_UNSUPPORTED",
            "Upload a PDF, or a PNG, JPEG or WebP image",
        )
    too_large = ApiError(status.HTTP_413_CONTENT_TOO_LARGE, "PROGRAM_FILE_TOO_LARGE", "Schedule files are limited to 8 MB")
    if content_length is not None and content_length > MAX_PROGRAM_FILE_BYTES:
        raise too_large
    count = await session.scalar(select(func.count(ProgramFile.id)).where(ProgramFile.event_id == event.id)) or 0
    if count >= MAX_PROGRAM_FILES_PER_EVENT:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "PROGRAM_FILE_LIMIT_REACHED",
            f"An event can have at most {MAX_PROGRAM_FILES_PER_EVENT} schedule files; delete one first",
        )

    received = bytearray()
    async for chunk in request.stream():
        received.extend(chunk)
        if len(received) > MAX_PROGRAM_FILE_BYTES:
            raise too_large
    if not received:
        raise ApiError(status.HTTP_400_BAD_REQUEST, "PROGRAM_FILE_EMPTY", "The upload is empty")
    raw = bytes(received)

    file_id = uuid.uuid4()
    item = ProgramFile(id=file_id, event_id=event.id, label=label)
    if declared == PDF_TYPE:
        try:
            pdf = check_pdf(raw)
        except RejectedPdf as exc:
            raise ApiError(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "PROGRAM_FILE_PDF_REJECTED", str(exc)) from None
        data, extension = raw, "pdf"
        item.kind, item.content_type, item.sha256, item.page_count = "pdf", PDF_TYPE, pdf.sha256, pdf.page_count
    else:
        try:
            image = await run_in_threadpool(process_image, raw)
        except RejectedImage as exc:
            raise ApiError(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "PROGRAM_FILE_IMAGE_REJECTED", str(exc)) from None
        data, extension = image.data, image.extension
        item.kind, item.content_type, item.sha256 = "image", image.content_type, image.sha256
        item.width, item.height = image.width, image.height
    item.byte_size = len(data)
    # Generated name only: neither the label nor anything else the client sent reaches the filesystem.
    item.storage_key = f"{event.id}/program/{file_id}.{extension}"
    highest = await session.scalar(select(func.max(ProgramFile.position)).where(ProgramFile.event_id == event.id))
    item.position = 0 if highest is None else highest + 1

    root = _media_root(request)
    await run_in_threadpool(write_file, root, item.storage_key, data)
    session.add(item)
    try:
        await session.commit()
    except BaseException:
        await run_in_threadpool(delete_file, root, item.storage_key)
        raise
    await session.refresh(item)
    return _out(item)


@router.get(
    "/api/events/{event_id}/program-files/{file_id}/content",
    response_class=FileResponse,
    responses={200: {"content": {PDF_TYPE: {}, "image/*": {}}}},
)
async def organizer_program_file_content(
    file_id: uuid.UUID, request: Request, event: OwnedEventDep, session: SessionDep
) -> FileResponse:
    item = await _own_file(session, event, file_id)
    return _file_response(request, item, "private, max-age=300")


@router.patch(
    "/api/events/{event_id}/program-files/{file_id}",
    responses=error_responses(status.HTTP_404_NOT_FOUND, status.HTTP_409_CONFLICT),
)
async def update_program_file(
    file_id: uuid.UUID, body: ProgramFileUpdate, event: WritableEventDep, session: SessionDep
) -> ProgramFileOut:
    item = await _own_file(session, event, file_id)
    if body.label is not None:
        item.label = body.label
    if body.position is not None:
        item.position = body.position
    if body.is_visible is not None:
        item.is_visible = body.is_visible
    await session.commit()
    await session.refresh(item)
    return _out(item)


@router.delete(
    "/api/events/{event_id}/program-files/{file_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(status.HTTP_404_NOT_FOUND, status.HTTP_409_CONFLICT),
)
async def delete_program_file(
    file_id: uuid.UUID, request: Request, event: WritableEventDep, session: SessionDep
) -> Response:
    item = await _own_file(session, event, file_id)
    key = item.storage_key
    await session.delete(item)
    await session.commit()
    await run_in_threadpool(delete_file, _media_root(request), key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/api/public/program-files/{file_id}",
    response_class=FileResponse,
    responses={200: {"content": {PDF_TYPE: {}, "image/*": {}}}},
    tags=["public"],
)
async def public_program_file(file_id: uuid.UUID, request: Request, session: SessionDep) -> FileResponse:
    """Anonymous access: only visible files of unarchived events whose page is published."""
    row = (
        await session.execute(
            select(ProgramFile)
            .join(Event, Event.id == ProgramFile.event_id)
            .join(EventPage, EventPage.event_id == Event.id)
            .where(
                ProgramFile.id == file_id,
                ProgramFile.is_visible.is_(True),
                Event.archived_at.is_(None),
                EventPage.published.is_not(None),
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Schedule file not found")
    return _file_response(request, row, PUBLIC_CACHE)
