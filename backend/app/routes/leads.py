import csv
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.audit import Actor, record
from app.db import SessionDep, add_or_existing
from app.errors import ApiError, error_responses
from app.models import Booth, EntityQR, Event, Lead, Ticket, TicketTier, User
from app.routes.auth import CurrentUserDep
from app.routes.booths import booth_for_staff, refuse_archived_lead_change
from app.search import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, before_cursor, encode_cursor, text_matches
from app.security import sanitize_csv_cell
from app.sms.phone import search_digits

router = APIRouter(prefix="/api/booths/{booth_id}/leads", tags=["leads"])

# Request size limits (422 beyond them): a QR secret, a follow-up note, and up to 20 short tags.
QR_SECRET_MAX = 512
NOTES_MAX = 2000
TAGS_MAX = 20
TAG_MAX = 40
# Search terms (`q`) on the lead and network lists.
SEARCH_TERM_MAX = 100
# The unpaginated legacy lists answer at most this many rows (newest first); `/search` pages through all.
LEGACY_LIST_MAX = 1000
CSV_BATCH_ROWS = 500

QrSecret = Annotated[str, Field(max_length=QR_SECRET_MAX)]
Notes = Annotated[str, Field(max_length=NOTES_MAX)]
LeadTags = Annotated[list[Annotated[str, Field(max_length=TAG_MAX)]], Field(max_length=TAGS_MAX)]


class LeadScanRequest(BaseModel):
    qr_secret: QrSecret
    rating: str = Field(default="WARM", max_length=16, description="HOT, WARM, COLD")
    tags: LeadTags = Field(default_factory=list)
    notes: Notes = ""


class LeadUpdate(BaseModel):
    rating: Literal["HOT", "WARM", "COLD"] | None = None
    tags: LeadTags | None = None
    notes: Notes | None = None


class LeadOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    booth_id: uuid.UUID
    ticket_id: uuid.UUID
    attendee_name: str
    attendee_mobile: str | None
    organization: str
    title: str
    ticket_tier_name: str
    rating: str
    tags: list[str]
    notes: str
    created_at: datetime
    updated_at: datetime
    # Set while the lead is deleted (it can be restored).
    deleted_at: datetime | None = None


class LeadPage(BaseModel):
    items: list[LeadOut]
    # Leads matching the filters, across all pages.
    total: int
    # Pass as `cursor` for the next page; null on the last page.
    next_cursor: str | None


LeadState = Literal["active", "deleted", "all"]


NOT_BOOTH_STAFF = "You are not authorized to access this booth portal"


async def authorized_booth_staff(
    booth_id: uuid.UUID,
    user: CurrentUserDep,
    session: SessionDep,
) -> Booth:
    """The booth, for its current staff only: a removed representative is refused from the next request on, and
    every representative while the congress's organizer is revoked. Reads stay open on an archived congress."""
    booth, _ = await booth_for_staff(session, booth_id, user, not_staff=NOT_BOOTH_STAFF)
    return booth


async def writable_booth_staff(
    booth_id: uuid.UUID,
    user: CurrentUserDep,
    session: SessionDep,
) -> Booth:
    """As `authorized_booth_staff`, for lead changes: refused with 409 EVENT_ARCHIVED on an archived congress."""
    booth, event = await booth_for_staff(session, booth_id, user, not_staff=NOT_BOOTH_STAFF)
    refuse_archived_lead_change(event)
    return booth


AuthorizedBoothDep = Annotated[Booth, Depends(authorized_booth_staff)]
WritableBoothDep = Annotated[Booth, Depends(writable_booth_staff)]
BOOTH_ERRORS = error_responses(status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND)
WRITE_ERRORS = error_responses(status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND, status.HTTP_409_CONFLICT)


def _lead_out(lead: Lead, ticket: Ticket, tier: TicketTier, attendee: User) -> LeadOut:
    return LeadOut(
        id=lead.id,
        booth_id=lead.booth_id,
        ticket_id=ticket.id,
        attendee_name=attendee.full_name,
        attendee_mobile=attendee.mobile if attendee.share_contact_with_exhibitors else None,
        organization=attendee.organization,
        title=attendee.title,
        ticket_tier_name=tier.name,
        rating=lead.rating,
        tags=lead.tags,
        notes=lead.notes,
        created_at=lead.created_at,
        updated_at=lead.updated_at,
        deleted_at=lead.deleted_at,
    )


def _lead_rows() -> Select[Lead, Ticket, TicketTier, User]:
    return (
        select(Lead, Ticket, TicketTier, User)
        .join(Ticket, Lead.ticket_id == Ticket.id)
        .join(TicketTier, Ticket.ticket_tier_id == TicketTier.id)
        .join(User, Ticket.user_id == User.id)
    )


def _lead_filters(
    booth: Booth, q: str = "", rating: str | None = None, state: LeadState = "active"
) -> list[Any]:
    """WHERE clauses of a booth's lead list. The search is Persian-folded and literal (app/search.py); a mobile
    number is searchable only where the attendee consented to share it with exhibitors."""
    filters: list[Any] = [Lead.booth_id == booth.id]
    if state == "active":
        filters.append(Lead.deleted_at.is_(None))
    elif state == "deleted":
        filters.append(Lead.deleted_at.is_not(None))
    if rating is not None:
        filters.append(Lead.rating == rating)
    term = q.strip()
    if term:
        digits = search_digits(term)
        filters.append(
            or_(
                text_matches(term, User.full_name, User.organization, User.title, Lead.notes),
                *(
                    [and_(User.share_contact_with_exhibitors.is_(True), User.mobile.contains(digits))]
                    if digits
                    else []
                ),
            )
        )
    return filters


async def _booth_lead(session: SessionDep, booth: Booth, lead_id: uuid.UUID) -> Lead:
    lead = await session.get(Lead, lead_id)
    if lead is None or lead.booth_id != booth.id:
        raise ApiError(status.HTTP_404_NOT_FOUND, "LEAD_NOT_FOUND", "Lead not found")
    return lead


async def _lead_out_by_id(session: SessionDep, lead_id: uuid.UUID) -> LeadOut:
    row = (await session.execute(_lead_rows().where(Lead.id == lead_id))).one()
    return _lead_out(*row)


@router.post("/scan", responses=WRITE_ERRORS)
async def scan_attendee_lead(
    booth: WritableBoothDep,
    body: LeadScanRequest,
    user: CurrentUserDep,
    session: SessionDep,
    response: Response,
) -> LeadOut:
    secret = body.qr_secret.strip().lower()

    # 1. Resolve EntityQR
    qr = await session.scalar(
        select(EntityQR).where(
            EntityQR.secret == secret, EntityQR.is_active.is_(True)
        )
    )
    if qr is None or qr.entity_type != "attendee_ticket":
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Invalid or unrecognized attendee badge QR"
        )

    # 2. Resolve Ticket, Tier, and Attendee User (a cancelled or otherwise inactive ticket is not a badge)
    ticket_row = await session.execute(
        select(Ticket, TicketTier, User)
        .join(TicketTier, Ticket.ticket_tier_id == TicketTier.id)
        .join(User, Ticket.user_id == User.id)
        .where(Ticket.id == qr.entity_id, Ticket.status == "active")
    )
    resolved = ticket_row.one_or_none()
    if resolved is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attendee ticket not found")

    ticket, tier, attendee = resolved[0], resolved[1], resolved[2]

    # 3. Check event match
    if ticket.event_id != booth.event_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Attendee ticket is for a different event"
        )

    # 4. Check if lead already captured
    existing = await session.scalar(
        select(Lead).where(
            Lead.booth_id == booth.id, Lead.ticket_id == ticket.id
        )
    )

    clean_rating = (
        body.rating.upper()
        if body.rating.upper() in {"HOT", "WARM", "COLD"}
        else "WARM"
    )

    if existing is None:
        # 5. Create the lead. Two staff members scanning the same badge at once: the first insert wins and the
        # other scan re-qualifies that lead below, like any re-scan.
        now = datetime.now(UTC)
        lead, created = await add_or_existing(
            session,
            Lead(
                event_id=booth.event_id,
                booth_id=booth.id,
                ticket_id=ticket.id,
                captured_by_user_id=user.id,
                rating=clean_rating,
                tags=body.tags,
                notes=body.notes.strip(),
                created_at=now,
                updated_at=now,
            ),
            select(Lead).where(Lead.booth_id == booth.id, Lead.ticket_id == ticket.id),
        )
        if not created:
            existing = lead

    if existing is not None:
        # Re-scanning an attendee updates only the qualification the caller actually sent, so an
        # accidental or deliberate re-scan with just the badge never resets rating/tags.
        provided = body.model_fields_set
        if "rating" in provided:
            existing.rating = clean_rating
        if "tags" in provided:
            existing.tags = body.tags
        if body.notes.strip():
            existing.notes = body.notes.strip()
        # Scanning the attendee again brings back a deleted lead.
        existing.deleted_at = None
        existing.updated_at = datetime.now(UTC)
        await session.commit()
        response.status_code = status.HTTP_200_OK

        return LeadOut(
            id=existing.id,
            booth_id=booth.id,
            ticket_id=ticket.id,
            attendee_name=attendee.full_name,
            attendee_mobile=attendee.mobile if attendee.share_contact_with_exhibitors else None,
            organization=attendee.organization,
            title=attendee.title,
            ticket_tier_name=tier.name,
            rating=existing.rating,
            tags=existing.tags,
            notes=existing.notes,
            created_at=existing.created_at,
            updated_at=existing.updated_at,
        )

    await session.commit()
    response.status_code = status.HTTP_201_CREATED

    return LeadOut(
        id=lead.id,
        booth_id=booth.id,
        ticket_id=ticket.id,
        attendee_name=attendee.full_name,
        attendee_mobile=attendee.mobile if attendee.share_contact_with_exhibitors else None,
        organization=attendee.organization,
        title=attendee.title,
        ticket_tier_name=tier.name,
        rating=lead.rating,
        tags=lead.tags,
        notes=lead.notes,
        created_at=lead.created_at,
        updated_at=lead.updated_at,
    )


@router.get("", responses=BOOTH_ERRORS, deprecated=True)
async def list_booth_leads(
    booth: AuthorizedBoothDep,
    session: SessionDep,
    q: Annotated[str, Query(max_length=SEARCH_TERM_MAX)] = "",
    rating: Annotated[Literal["HOT", "WARM", "COLD"] | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=LEGACY_LIST_MAX)] = LEGACY_LIST_MAX,
) -> list[LeadOut]:
    """The booth's leads that are not deleted, newest first: at most `limit` (1,000 by default and at most).

    Deprecated: use `/search`, which pages through every lead and reports the total.
    """
    query = (
        _lead_rows()
        .where(*_lead_filters(booth, q, rating))
        .order_by(Lead.created_at.desc(), Lead.id.desc())
        .limit(limit)
    )
    return [_lead_out(*row) for row in (await session.execute(query)).all()]


@router.get("/search", responses=error_responses(400, 403, 404))
async def search_booth_leads(
    booth: AuthorizedBoothDep,
    session: SessionDep,
    q: Annotated[str, Query(max_length=SEARCH_TERM_MAX)] = "",
    rating: Annotated[Literal["HOT", "WARM", "COLD"] | None, Query()] = None,
    state: Annotated[LeadState, Query(description="active (default), deleted (the trash) or all")] = "active",
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
    cursor: Annotated[str | None, Query(max_length=200)] = None,
) -> LeadPage:
    """One page of the booth's leads, newest first, with the total matching the filters.

    `q` matches name, organization, title and notes (Persian letters folded, `%`/`_` literal), and the mobile
    number of attendees who share it with exhibitors.
    """
    filters = _lead_filters(booth, q, rating, state)
    total = await session.scalar(
        select(func.count(Lead.id)).join(Ticket, Lead.ticket_id == Ticket.id).join(User, Ticket.user_id == User.id).where(*filters)
    ) or 0
    query = _lead_rows().where(*filters)
    if cursor:
        query = query.where(before_cursor(Lead.created_at, Lead.id, cursor))
    rows = (await session.execute(query.order_by(Lead.created_at.desc(), Lead.id.desc()).limit(limit + 1))).all()
    items = [_lead_out(*row) for row in rows[:limit]]
    last = rows[limit - 1][0] if len(rows) > limit else None
    return LeadPage(
        items=items, total=total, next_cursor=encode_cursor(last.created_at, last.id) if last else None
    )


class _Echo:
    """A file whose `write` returns the text, so `csv.writer(...).writerow` returns one line."""

    def write(self, value: str) -> str:
        return value


LEAD_CSV_HEADER = [
    "Lead ID",
    "Attendee Name",
    "Attendee Mobile",
    "Organization",
    "Title",
    "Ticket Tier",
    "Interest Rating",
    "Follow-Up Tags",
    "Notes",
    "Captured At (UTC)",
    "Last Updated (UTC)",
]


def _lead_csv_cells(lead: Lead, tier: TicketTier, attendee: User, include_deleted: bool) -> list[str]:
    cells = [
        str(lead.id),
        sanitize_csv_cell(attendee.full_name),
        sanitize_csv_cell(attendee.mobile if attendee.share_contact_with_exhibitors else ""),
        sanitize_csv_cell(attendee.organization),
        sanitize_csv_cell(attendee.title),
        sanitize_csv_cell(tier.name),
        sanitize_csv_cell(lead.rating),
        sanitize_csv_cell("; ".join(lead.tags or [])),
        sanitize_csv_cell(lead.notes),
        _utc(lead.created_at),
        _utc(lead.updated_at),
    ]
    if include_deleted:
        cells.append(_utc(lead.deleted_at) if lead.deleted_at else "")
    return cells


async def _lead_csv(
    sessionmaker: async_sessionmaker[AsyncSession],
    statement: Select[Lead, Ticket, TicketTier, User],
    include_deleted: bool,
) -> AsyncIterator[bytes]:
    writer = csv.writer(_Echo())
    header = [*LEAD_CSV_HEADER, "Deleted At (UTC)"] if include_deleted else LEAD_CSV_HEADER
    yield ("\ufeff" + writer.writerow(header)).encode()
    # Its own session: the request's may be closed while the body is still streaming.
    async with sessionmaker() as session:
        result = await session.stream(statement.execution_options(yield_per=CSV_BATCH_ROWS))
        async for rows in result.partitions():
            yield "".join(
                writer.writerow(_lead_csv_cells(lead, tier, attendee, include_deleted))
                for lead, _, tier, attendee in rows
            ).encode()


@router.get("/export-csv", response_class=StreamingResponse, responses=BOOTH_ERRORS)
async def export_booth_leads_csv(
    booth: AuthorizedBoothDep,
    user: CurrentUserDep,
    request: Request,
    session: SessionDep,
    include_deleted: Annotated[bool, Query(description="Also export deleted leads, with a Deleted At column")] = False,
) -> StreamingResponse:
    """The booth's leads as CSV, streamed from a server-side cursor. Each download is written to the congress
    organizer's audit log (ADR 0016): it carries attendees' personal data out of the platform."""
    filters = _lead_filters(booth, state="all" if include_deleted else "active")
    row_count = await session.scalar(select(func.count(Lead.id)).where(*filters)) or 0

    organizer_id = await session.scalar(select(Event.organizer_id).where(Event.id == booth.event_id))
    record(
        session, request, "export.download",
        actor=Actor("booth_staff", str(user.id), user.full_name, organizer_id),
        event_id=booth.event_id, entity_type="booth", entity_id=booth.id,
        summary={
            "method": "GET", "route": "/api/booths/{booth_id}/leads/export-csv",
            "include_deleted": include_deleted, "rows": row_count,
        },
    )
    await session.commit()

    statement = _lead_rows().where(*filters).order_by(Lead.created_at.desc(), Lead.id.desc())
    return StreamingResponse(
        _lead_csv(request.app.state.sessionmaker, statement, include_deleted),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{booth.slug}-leads.csv"'},
    )


def _utc(moment: datetime) -> str:
    """ISO 8601 in UTC, as the "(UTC)" column headers promise."""
    return moment.astimezone(UTC).isoformat()


@router.patch("/{lead_id}", responses=WRITE_ERRORS)
async def update_lead_qualification(
    booth: WritableBoothDep,
    lead_id: uuid.UUID,
    body: LeadUpdate,
    session: SessionDep,
) -> LeadOut:
    lead = await _booth_lead(session, booth, lead_id)
    if lead.deleted_at is not None:
        raise ApiError(status.HTTP_409_CONFLICT, "LEAD_DELETED", "Restore the lead before editing it")

    if body.rating is not None:
        lead.rating = body.rating
    if body.tags is not None:
        lead.tags = body.tags
    if body.notes is not None:
        lead.notes = body.notes.strip()

    lead.updated_at = datetime.now(UTC)
    await session.commit()
    return await _lead_out_by_id(session, lead.id)


@router.delete("/{lead_id}", status_code=status.HTTP_204_NO_CONTENT, responses=WRITE_ERRORS)
async def delete_lead(
    booth: WritableBoothDep,
    lead_id: uuid.UUID,
    session: SessionDep,
) -> Response:
    """Moves the lead to the booth's trash: gone from the list and exports, restorable (`/restore`)."""
    lead = await _booth_lead(session, booth, lead_id)
    if lead.deleted_at is None:
        lead.deleted_at = datetime.now(UTC)
        await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{lead_id}/restore", responses=WRITE_ERRORS)
async def restore_lead(
    booth: WritableBoothDep,
    lead_id: uuid.UUID,
    session: SessionDep,
) -> LeadOut:
    lead = await _booth_lead(session, booth, lead_id)
    if lead.deleted_at is not None:
        lead.deleted_at = None
        await session.commit()
    return await _lead_out_by_id(session, lead.id)
