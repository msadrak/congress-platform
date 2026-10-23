"""Participants: the organizer's register of one congress's registrations (tickets).

What is listed, edited and exported is the registration's own copy of the attendee's details (ticket
`attendee_*`), never the person's account, which every congress on the platform shares. Cancelling, reissuing,
transferring and deleting go through app/ticket_lifecycle.py. Organizer API key only; another organizer's
event or ticket is a 404 (OwnedEventDep).
"""

import csv
import io
import re
import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, Request, Response, status
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import ColumnElement, Select, delete, exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import QueryableAttribute

from app.db import SessionDep
from app.errors import ApiError, error_responses
from app.models import CheckIn, CheckInPoint, DeskOperator, EntityQR, Event, Lead, Ticket, TicketTier, User
from app.routes.events import OwnedEventDep
from app.security import sanitize_csv_cell
from app.sms.budgets import charge_organizer_notice
from app.sms.outbox import link_origin
from app.sms.phone import IranMobile, ascii_digits, search_digits
from app.ticket_lifecycle import (
    TICKET_QR_TYPE,
    TicketStateError,
    cancel_ticket,
    reissue_ticket,
    ticket_invalidated,
    transfer_ticket,
)

router = APIRouter(prefix="/api/events/{event_id}/participants", tags=["participants"])

TicketStatus = Literal["active", "cancelled"]
NameStr = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
OrganizationStr = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
TitleStr = Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)]

# Arabic code points Persian keyboards and pasted text use for ی and ک, and the zero-width non-joiner, which
# people type inconsistently ("محمدرضا" / "محمد‌رضا"). Search compares both sides with these folded away.
_FOLD_FROM = "يكى‌"
_FOLD_TO = "یکی"
_FOLD_TABLE = str.maketrans({"ي": "ی", "ى": "ی", "ك": "ک", "‌": None})
_BIDI_MARKS = re.compile("[‎‏‪-‮]")


def fold_search_text(value: str) -> str:
    """The form names are compared in: Persian ی/ک, no ZWNJ or bidi marks, ASCII digits, single spaces."""
    return " ".join(ascii_digits(_BIDI_MARKS.sub("", value)).translate(_FOLD_TABLE).split())


def _like_pattern(term: str) -> str:
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _folded(column: QueryableAttribute[str]) -> ColumnElement[str]:
    return func.translate(column, _FOLD_FROM, _FOLD_TO)


def search_condition(term: str) -> ColumnElement[bool] | None:
    """Match the registration name, organization or title (Persian-folded), or a partial mobile number."""
    folded = fold_search_text(term)
    if not folded:
        return None
    pattern = _like_pattern(folded)
    conditions: list[ColumnElement[bool]] = [
        _folded(column).ilike(pattern, escape="\\")
        for column in (Ticket.attendee_full_name, Ticket.attendee_organization, Ticket.attendee_title)
    ]
    digits = search_digits(term)
    if digits:
        conditions.append(User.mobile.contains(digits, autoescape=True))
    return or_(*conditions)


class ParticipantOut(BaseModel):
    ticket_id: uuid.UUID
    user_id: uuid.UUID
    attendee_full_name: str
    attendee_organization: str
    attendee_title: str
    # The account's sign-in number; None for a walk-in without one or a deleted account.
    mobile: str | None
    ticket_tier_id: uuid.UUID
    ticket_tier_name: str
    status: TicketStatus
    created_at: datetime
    updated_at: datetime
    cancelled_at: datetime | None
    cancelled_reason: str | None
    # organizer | attendee | account_deleted
    cancelled_by: str | None
    reissued_at: datetime | None
    # Front-desk operator who issued a walk-in ticket.
    issued_by: str | None
    checkin_count: int
    lead_count: int
    # Hard delete is only for a registration made by mistake: no scans and no exhibitor leads.
    can_delete: bool
    account_deleted: bool


class ScanOut(BaseModel):
    checkin_point_name: str
    status: str
    rejection_reason: str | None
    scanned_at: datetime


class ParticipantDetail(ParticipantOut):
    # Only while the ticket is active.
    qr_secret: str | None
    scan_history: list[ScanOut]


class ParticipantPage(BaseModel):
    items: list[ParticipantOut]
    total: int
    limit: int
    offset: int


class ParticipantUpdate(BaseModel):
    """Registration details for this congress only; the person's account is left unchanged."""

    attendee_full_name: NameStr | None = None
    attendee_organization: OrganizationStr | None = None
    attendee_title: TitleStr | None = None


class ParticipantCancel(BaseModel):
    reason: Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)] = ""
    # Send the attendee the cancellation SMS (default on).
    notify: bool = True


class ParticipantReissue(BaseModel):
    notify: bool = True


class ParticipantTransfer(BaseModel):
    """The new holder, by mobile number. Name details are required when the number has no account yet."""

    mobile: IranMobile
    full_name: NameStr | None = None
    organization: OrganizationStr | None = None
    title: TitleStr | None = None


def _checkin_count() -> Any:
    return (
        select(func.count(CheckIn.id))
        .where(CheckIn.ticket_id == Ticket.id, CheckIn.status == "ADMITTED", CheckIn.direction == "IN")
        .correlate(Ticket)
        .scalar_subquery()
    )


def _lead_count() -> Any:
    return select(func.count(Lead.id)).where(Lead.ticket_id == Ticket.id).correlate(Ticket).scalar_subquery()


def _any_scan() -> Any:
    return exists().where(CheckIn.ticket_id == Ticket.id).correlate(Ticket)


def _base_query(event_id: uuid.UUID) -> Select[Any]:
    return (
        select(
            Ticket,
            User.mobile,
            User.deleted_at,
            TicketTier.name,
            DeskOperator.operator_name,
            _checkin_count().label("checkin_count"),
            _lead_count().label("lead_count"),
            _any_scan().label("any_scan"),
        )
        .join(User, Ticket.user_id == User.id)
        .join(TicketTier, Ticket.ticket_tier_id == TicketTier.id)
        .outerjoin(DeskOperator, Ticket.issued_by_operator_id == DeskOperator.id)
        .where(Ticket.event_id == event_id)
    )


def _filtered(
    query: Select[Any], q: str, tier_id: uuid.UUID | None, ticket_status: TicketStatus | None
) -> Select[Any]:
    condition = search_condition(q)
    if condition is not None:
        query = query.where(condition)
    if tier_id is not None:
        query = query.where(Ticket.ticket_tier_id == tier_id)
    if ticket_status is not None:
        query = query.where(Ticket.status == ticket_status)
    return query


def _participant(row: Any) -> ParticipantOut:
    ticket, mobile, deleted_at, tier_name, operator_name, checkins, leads, any_scan = row
    return ParticipantOut(
        ticket_id=ticket.id,
        user_id=ticket.user_id,
        attendee_full_name=ticket.attendee_full_name,
        attendee_organization=ticket.attendee_organization,
        attendee_title=ticket.attendee_title,
        mobile=mobile,
        ticket_tier_id=ticket.ticket_tier_id,
        ticket_tier_name=tier_name,
        status=ticket.status,
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
        cancelled_at=ticket.cancelled_at,
        cancelled_reason=ticket.cancelled_reason,
        cancelled_by=ticket.cancelled_by,
        reissued_at=ticket.reissued_at,
        issued_by=operator_name,
        checkin_count=checkins or 0,
        lead_count=leads or 0,
        can_delete=not any_scan and not leads,
        account_deleted=deleted_at is not None,
    )


async def _owned_ticket(session: SessionDep, event: Event, ticket_id: uuid.UUID) -> Ticket:
    ticket = await session.scalar(
        select(Ticket).where(Ticket.id == ticket_id, Ticket.event_id == event.id).with_for_update()
    )
    if ticket is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "PARTICIPANT_NOT_FOUND", "Participant not found")
    return ticket


async def _detail(session: SessionDep, event: Event, ticket_id: uuid.UUID) -> ParticipantDetail:
    row = (await session.execute(_base_query(event.id).where(Ticket.id == ticket_id))).one_or_none()
    if row is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "PARTICIPANT_NOT_FOUND", "Participant not found")
    participant = _participant(row)
    secret = await session.scalar(
        select(EntityQR.secret).where(
            EntityQR.entity_type == TICKET_QR_TYPE, EntityQR.entity_id == ticket_id, EntityQR.is_active.is_(True)
        )
    )
    history = await session.execute(
        select(CheckIn, CheckInPoint.name)
        .join(CheckInPoint, CheckIn.checkin_point_id == CheckInPoint.id)
        .where(CheckIn.ticket_id == ticket_id)
        .order_by(CheckIn.scanned_at.desc())
    )
    return ParticipantDetail(
        **participant.model_dump(),
        qr_secret=secret if participant.status == "active" else None,
        scan_history=[
            ScanOut(
                checkin_point_name=point_name, status=scan.status,
                rejection_reason=scan.rejection_reason, scanned_at=scan.scanned_at,
            )
            for scan, point_name in history.all()
        ],
    )


def _origin(request: Request) -> str:
    """Where SMS links point."""
    return link_origin(request.app.state.settings, str(request.base_url))


def _conflict(exc: TicketStateError) -> ApiError:
    return ApiError(status.HTTP_409_CONFLICT, "TICKET_STATE_CONFLICT", str(exc))


NOT_FOUND = error_responses(status.HTTP_404_NOT_FOUND)
NOT_FOUND_OR_CONFLICT = error_responses(status.HTTP_404_NOT_FOUND, status.HTTP_409_CONFLICT)
# Changes that may text the attendee are also limited per organizer per hour (app/sms/budgets.py).
NOTICE_RESPONSES = error_responses(status.HTTP_404_NOT_FOUND, status.HTTP_409_CONFLICT, status.HTTP_429_TOO_MANY_REQUESTS)


@router.get("")
async def list_participants(
    event: OwnedEventDep,
    session: SessionDep,
    q: Annotated[str, Query(max_length=200)] = "",
    tier_id: Annotated[uuid.UUID | None, Query()] = None,
    ticket_status: Annotated[TicketStatus | None, Query(alias="status")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ParticipantPage:
    """Newest registrations first. `total` counts every match, for pagination."""
    filtered = _filtered(_base_query(event.id), q, tier_id, ticket_status)
    total = await session.scalar(
        _filtered(
            select(func.count(Ticket.id)).join(User, Ticket.user_id == User.id).where(Ticket.event_id == event.id),
            q, tier_id, ticket_status,
        )
    )
    rows = await session.execute(
        filtered.order_by(Ticket.created_at.desc(), Ticket.id.desc()).limit(limit).offset(offset)
    )
    return ParticipantPage(items=[_participant(r) for r in rows.all()], total=total or 0, limit=limit, offset=offset)


@router.get("/export-csv")
async def export_participants_csv(
    event: OwnedEventDep,
    session: SessionDep,
    q: Annotated[str, Query(max_length=200)] = "",
    tier_id: Annotated[uuid.UUID | None, Query()] = None,
    ticket_status: Annotated[TicketStatus | None, Query(alias="status")] = None,
) -> Response:
    """Every registration matching the list filters, as CSV (UTF-8 with BOM for Excel; formula-safe cells)."""
    rows = await session.execute(
        _filtered(_base_query(event.id), q, tier_id, ticket_status).order_by(Ticket.created_at, Ticket.id)
    )
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "Ticket ID", "Full Name", "Mobile", "Organization", "Title", "Ticket Tier", "Status",
            "Registered At (UTC)", "Cancelled At (UTC)", "Cancellation Reason", "Check-ins", "Issued By",
        ]
    )
    for row in rows.all():
        p = _participant(row)
        writer.writerow(
            [
                str(p.ticket_id),
                sanitize_csv_cell(p.attendee_full_name),
                sanitize_csv_cell(p.mobile),
                sanitize_csv_cell(p.attendee_organization),
                sanitize_csv_cell(p.attendee_title),
                sanitize_csv_cell(p.ticket_tier_name),
                p.status,
                p.created_at.isoformat(),
                p.cancelled_at.isoformat() if p.cancelled_at else "",
                sanitize_csv_cell(p.cancelled_reason),
                p.checkin_count,
                sanitize_csv_cell(p.issued_by),
            ]
        )
    return Response(
        content="﻿" + output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{event.slug}-participants.csv"'},
    )


@router.get("/{ticket_id}", responses=NOT_FOUND)
async def get_participant(event: OwnedEventDep, ticket_id: uuid.UUID, session: SessionDep) -> ParticipantDetail:
    return await _detail(session, event, ticket_id)


@router.patch("/{ticket_id}", responses=NOT_FOUND)
async def update_participant(
    event: OwnedEventDep, ticket_id: uuid.UUID, body: ParticipantUpdate, session: SessionDep
) -> ParticipantDetail:
    """Correct the registration's name, organization or title for this congress only."""
    ticket = await _owned_ticket(session, event, ticket_id)
    if body.attendee_full_name is not None:
        ticket.attendee_full_name = body.attendee_full_name
    if body.attendee_organization is not None:
        ticket.attendee_organization = body.attendee_organization
    if body.attendee_title is not None:
        ticket.attendee_title = body.attendee_title
    await session.commit()
    return await _detail(session, event, ticket_id)


@router.post("/{ticket_id}/cancel", responses=NOTICE_RESPONSES)
async def cancel_participant(
    event: OwnedEventDep, ticket_id: uuid.UUID, body: ParticipantCancel, request: Request, session: SessionDep
) -> ParticipantDetail:
    """Cancel the ticket: its place returns to the tier and its pass stops working."""
    ticket = await _owned_ticket(session, event, ticket_id)
    try:
        await cancel_ticket(
            session, ticket, actor="organizer", reason=body.reason,
            notify=(_origin(request), event) if body.notify else None,
        )
    except TicketStateError as exc:
        raise _conflict(exc) from None
    if body.notify:
        await charge_organizer_notice(request, event.organizer_id)  # refused: nothing is committed
    await session.commit()
    return await _detail(session, event, ticket_id)


@router.post("/{ticket_id}/reissue", responses=NOTICE_RESPONSES)
async def reissue_participant(
    event: OwnedEventDep, ticket_id: uuid.UUID, body: ParticipantReissue, request: Request, session: SessionDep
) -> ParticipantDetail:
    """Issue a new pass (new QR code); the old one stops working."""
    ticket = await _owned_ticket(session, event, ticket_id)
    try:
        await reissue_ticket(session, ticket, event, notify_origin=_origin(request) if body.notify else None)
    except TicketStateError as exc:
        raise _conflict(exc) from None
    if body.notify:
        await charge_organizer_notice(request, event.organizer_id)  # refused: nothing is committed
    await session.commit()
    return await _detail(session, event, ticket_id)


@router.post("/{ticket_id}/transfer", responses=NOTICE_RESPONSES)
async def transfer_participant(
    event: OwnedEventDep, ticket_id: uuid.UUID, body: ParticipantTransfer, request: Request, session: SessionDep
) -> ParticipantDetail:
    """Give the ticket's place to another person (by mobile). Returns the new holder's registration."""
    ticket = await _owned_ticket(session, event, ticket_id)
    target = await session.scalar(select(User).where(User.mobile == body.mobile))
    if target is None:
        if body.full_name is None:
            raise ApiError(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "FULL_NAME_REQUIRED",
                "This number has no account yet: enter the person's full name."
            )
        target = User(
            mobile=body.mobile, full_name=body.full_name,
            organization=body.organization or "", title=body.title or "",
        )
        session.add(target)
        try:
            async with session.begin_nested():
                await session.flush()
        except IntegrityError:
            target = await session.scalar(select(User).where(User.mobile == body.mobile))
            if target is None:
                raise ApiError(status.HTTP_409_CONFLICT, "ACCOUNT_CONFLICT", "The account could not be created") from None
    snapshot = {
        "attendee_full_name": body.full_name or target.full_name,
        "attendee_organization": body.organization if body.organization is not None else target.organization,
        "attendee_title": body.title if body.title is not None else target.title,
    }
    try:
        new_ticket = await transfer_ticket(
            session, ticket, target, snapshot=snapshot, origin=_origin(request), event=event
        )
    except TicketStateError as exc:
        raise _conflict(exc) from None
    await charge_organizer_notice(request, event.organizer_id)  # a transfer always texts both holders
    await session.commit()
    return await _detail(session, event, new_ticket.id)


@router.delete("/{ticket_id}", status_code=status.HTTP_204_NO_CONTENT, responses=NOT_FOUND_OR_CONFLICT)
async def delete_participant(event: OwnedEventDep, ticket_id: uuid.UUID, session: SessionDep) -> Response:
    """Remove a registration made by mistake. A ticket that was scanned or captured as a lead is part of the
    congress's history: cancel it instead (409)."""
    ticket = await _owned_ticket(session, event, ticket_id)
    scanned = await session.scalar(select(exists().where(CheckIn.ticket_id == ticket.id)))
    has_leads = await session.scalar(select(exists().where(Lead.ticket_id == ticket.id)))
    if scanned or has_leads:
        raise ApiError(
            status.HTTP_409_CONFLICT, "PARTICIPANT_HAS_HISTORY",
            "This participant has check-ins or exhibitor leads and cannot be deleted. Cancel the ticket instead.",
        )
    if ticket.status == "active":
        await cancel_ticket(session, ticket, actor="organizer", reason="deleted")
    else:
        await ticket_invalidated(session, ticket)
    await session.execute(
        delete(EntityQR).where(EntityQR.entity_type == TICKET_QR_TYPE, EntityQR.entity_id == ticket.id)
    )
    await session.execute(delete(Ticket).where(Ticket.id == ticket.id))
    try:
        await session.commit()
    except IntegrityError:
        # A scan or lead arrived meanwhile.
        await session.rollback()
        raise ApiError(
            status.HTTP_409_CONFLICT, "PARTICIPANT_HAS_HISTORY",
            "This participant was just checked in or captured as a lead. Cancel the ticket instead.",
        ) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
