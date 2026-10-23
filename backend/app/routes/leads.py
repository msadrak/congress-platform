import csv
import io
import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select

from app.db import SessionDep, add_or_existing
from app.models import Booth, BoothStaff, EntityQR, Event, Lead, Ticket, TicketTier, User
from app.routes.auth import CurrentUserDep
from app.security import sanitize_csv_cell
from app.sms.phone import ascii_digits, search_digits

router = APIRouter(prefix="/api/booths/{booth_id}/leads", tags=["leads"])


class LeadScanRequest(BaseModel):
    qr_secret: str
    rating: str = Field(default="WARM", description="HOT, WARM, COLD")
    tags: list[str] = Field(default_factory=list)
    notes: str = ""


class LeadUpdate(BaseModel):
    rating: Literal["HOT", "WARM", "COLD"] | None = None
    tags: list[str] | None = None
    notes: str | None = None


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


async def authorized_booth_staff(
    booth_id: uuid.UUID,
    user: CurrentUserDep,
    session: SessionDep,
) -> Booth:
    booth = await session.get(Booth, booth_id)
    if booth is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booth not found")

    is_staff = await session.scalar(
        select(BoothStaff.id).where(
            BoothStaff.booth_id == booth.id, BoothStaff.user_id == user.id
        )
    )
    if not is_staff:
        event = await session.get(Event, booth.event_id)
        if event is None:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "You are not authorized to access this booth portal",
            )
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "You are not authorized to access this booth portal",
        )

    return booth


AuthorizedBoothDep = Annotated[Booth, Depends(authorized_booth_staff)]


@router.post("/scan")
async def scan_attendee_lead(
    booth: AuthorizedBoothDep,
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
        now = datetime.now()
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
        existing.updated_at = datetime.now()
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


@router.patch("/{lead_id}")
async def update_lead_qualification(
    booth: AuthorizedBoothDep,
    lead_id: uuid.UUID,
    body: LeadUpdate,
    session: SessionDep,
) -> LeadOut:
    lead = await session.get(Lead, lead_id)
    if lead is None or lead.booth_id != booth.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lead not found")

    if body.rating is not None:
        lead.rating = body.rating
    if body.tags is not None:
        lead.tags = body.tags
    if body.notes is not None:
        lead.notes = body.notes.strip()

    lead.updated_at = datetime.now()
    await session.commit()

    ticket_row = await session.execute(
        select(Ticket, TicketTier, User)
        .join(TicketTier, Ticket.ticket_tier_id == TicketTier.id)
        .join(User, Ticket.user_id == User.id)
        .where(Ticket.id == lead.ticket_id)
    )
    row = ticket_row.one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Associated ticket not found")

    ticket, tier, attendee = row[0], row[1], row[2]

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


@router.get("")
async def list_booth_leads(
    booth: AuthorizedBoothDep,
    session: SessionDep,
    q: Annotated[str, Query()] = "",
    rating: Annotated[Literal["HOT", "WARM", "COLD"] | None, Query()] = None,
) -> list[LeadOut]:
    term = q.strip()

    query = (
        select(Lead, Ticket, TicketTier, User)
        .join(Ticket, Lead.ticket_id == Ticket.id)
        .join(TicketTier, Ticket.ticket_tier_id == TicketTier.id)
        .join(User, Ticket.user_id == User.id)
        .where(Lead.booth_id == booth.id)
    )

    if rating is not None:
        query = query.where(Lead.rating == rating)

    if term:
        like_term = f"%{ascii_digits(term)}%"
        digits = search_digits(term)
        query = query.where(
            or_(
                User.full_name.ilike(like_term),
                User.organization.ilike(like_term),
                Lead.notes.ilike(like_term),
                *([User.mobile.contains(digits)] if digits else []),
            )
        )

    query = query.order_by(Lead.created_at.desc())
    res = await session.execute(query)
    rows = res.all()

    return [
        LeadOut(
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
        for lead, ticket, tier, attendee in rows
    ]


@router.get("/export-csv")
async def export_booth_leads_csv(
    booth: AuthorizedBoothDep,
    session: SessionDep,
) -> Response:
    query = (
        select(Lead, Ticket, TicketTier, User)
        .join(Ticket, Lead.ticket_id == Ticket.id)
        .join(TicketTier, Ticket.ticket_tier_id == TicketTier.id)
        .join(User, Ticket.user_id == User.id)
        .where(Lead.booth_id == booth.id)
        .order_by(Lead.created_at.desc())
    )
    res = await session.execute(query)
    rows = res.all()

    output = io.StringIO()
    writer = csv.writer(output)

    # CSV Header
    writer.writerow(
        [
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
    )

    for lead, ticket, tier, attendee in rows:
        writer.writerow(
            [
                str(lead.id),
                sanitize_csv_cell(attendee.full_name),
                sanitize_csv_cell(attendee.mobile if attendee.share_contact_with_exhibitors else ""),
                sanitize_csv_cell(attendee.organization),
                sanitize_csv_cell(attendee.title),
                sanitize_csv_cell(tier.name),
                sanitize_csv_cell(lead.rating),
                sanitize_csv_cell("; ".join(lead.tags or [])),
                sanitize_csv_cell(lead.notes),
                lead.created_at.isoformat(),
                lead.updated_at.isoformat(),
            ]
        )

    content = "\ufeff" + output.getvalue()
    filename = f"{booth.slug}-leads.csv"
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
