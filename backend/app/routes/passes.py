"""One-tap pass from the SMS short link (ADR 0015): `POST /api/public/passes/resolve` with the link's code.

Anonymous and read-only: it shows the pass (QR included) and nothing that needs a sign-in. The code travels in
the request body, never in an API URL, so it stays out of request logs. Unknown codes are throttled strictly
per IP; real opens get a generous per-IP budget, since a venue puts many attendees behind one address.

Refusals carry a stable machine-readable `code` next to the English `detail`:
404 LINK_NOT_FOUND, 410 LINK_REVOKED, 410 LINK_EXPIRED, 410 TICKET_INACTIVE (and 429 when throttled).
"""

import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update

from app.db import SessionDep
from app.links import normalize_code
from app.models import EntityQR, Event, ShortLink, Ticket, TicketTier, User
from app.rate_limit import Budget, client_ip, limiter

router = APIRouter(prefix="/api/public/passes", tags=["public"])

# Per client IP, per 15 minutes: wrong, revoked or expired codes, and all opens.
LINK_FAILURES_PER_IP = Budget(20)
LINK_OPENS_PER_IP = Budget(600)
NO_STORE = {"Cache-Control": "no-store"}

LinkErrorCode = Literal["LINK_NOT_FOUND", "LINK_REVOKED", "LINK_EXPIRED", "TICKET_INACTIVE"]


class PassResolveRequest(BaseModel):
    code: Annotated[str, Field(max_length=64)]


class LinkPassEvent(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    starts_at: datetime
    ends_at: datetime
    location: str


class LinkPassAttendee(BaseModel):
    full_name: str
    organization: str
    title: str


class LinkPassOut(BaseModel):
    """What the SMS link shows: the pass, never the attendee's mobile number or anything editable."""

    ticket_id: uuid.UUID
    status: str
    issued_at: datetime
    qr_secret: str
    tier_name: str
    # The browser may keep this pass offline until then.
    expires_at: datetime
    event: LinkPassEvent
    attendee: LinkPassAttendee


class LinkErrorOut(BaseModel):
    detail: str
    code: LinkErrorCode
    # 410 only (a real link that no longer works): the congress, so the page can offer its sign-in. Event slugs
    # are public; nothing else about the ticket is revealed.
    event_slug: str | None = None


_REFUSALS: dict[LinkErrorCode, tuple[int, str]] = {
    "LINK_NOT_FOUND": (status.HTTP_404_NOT_FOUND, "This link is not valid."),
    "LINK_REVOKED": (status.HTTP_410_GONE, "This link is no longer valid."),
    "LINK_EXPIRED": (status.HTTP_410_GONE, "This link has expired."),
    "TICKET_INACTIVE": (status.HTTP_410_GONE, "This pass is no longer active."),
}


def _refusal(link: ShortLink, ticket: Ticket) -> LinkErrorCode | None:
    if link.revoked_at is not None:
        return "LINK_REVOKED"
    if link.expires_at <= datetime.now(timezone.utc):
        return "LINK_EXPIRED"
    if ticket.status != "active":
        return "TICKET_INACTIVE"
    return None


def _refuse(code: LinkErrorCode, event_slug: str | None = None) -> JSONResponse:
    status_code, detail = _REFUSALS[code]
    body = LinkErrorOut(detail=detail, code=code, event_slug=event_slug)
    return JSONResponse(body.model_dump(), status_code=status_code, headers=NO_STORE)


@router.post(
    "/resolve",
    response_model=LinkPassOut,
    responses={404: {"model": LinkErrorOut}, 410: {"model": LinkErrorOut}},
)
async def resolve_pass_link(
    body: PassResolveRequest, request: Request, response: Response, session: SessionDep
) -> LinkPassOut | JSONResponse:
    throttle = limiter(request)
    ip = client_ip(request)
    failures, opens = f"link:fail:ip:{ip}", f"link:open:ip:{ip}"
    await throttle.check(
        (failures, LINK_FAILURES_PER_IP), (opens, LINK_OPENS_PER_IP), detail="Too many attempts. Try again later."
    )
    await throttle.hit(opens)

    code = normalize_code(body.code)
    row = (
        await session.execute(
            select(ShortLink, Ticket, Event, TicketTier, User, EntityQR.secret)
            .join(Ticket, Ticket.id == ShortLink.ticket_id)
            .join(Event, Event.id == ShortLink.event_id)
            .join(TicketTier, TicketTier.id == Ticket.ticket_tier_id)
            .join(User, User.id == Ticket.user_id)
            .join(EntityQR, (EntityQR.entity_id == Ticket.id) & (EntityQR.entity_type == "attendee_ticket"))
            .where(ShortLink.code == code)
        )
    ).first() if code else None
    if row is None:
        await throttle.fail(failures)
        return _refuse("LINK_NOT_FOUND")
    link, ticket, event, tier, user, qr_secret = row
    refusal = _refusal(link, ticket)
    if refusal is not None:
        await throttle.fail(failures)
        return _refuse(refusal, event.slug)

    await session.execute(
        update(ShortLink)
        .where(ShortLink.code == link.code)
        .values(
            open_count=ShortLink.open_count + 1,
            last_opened_at=func.now(),
            first_opened_at=func.coalesce(ShortLink.first_opened_at, func.now()),
        )
    )
    await session.commit()
    response.headers.update(NO_STORE)
    return LinkPassOut(
        ticket_id=ticket.id,
        status=ticket.status,
        issued_at=ticket.created_at,
        qr_secret=qr_secret,
        tier_name=tier.name,
        expires_at=link.expires_at,
        event=LinkPassEvent(
            id=event.id, slug=event.slug, name=event.name, starts_at=event.starts_at, ends_at=event.ends_at,
            location=event.location,
        ),
        attendee=LinkPassAttendee(full_name=user.full_name, organization=user.organization, title=user.title),
    )
