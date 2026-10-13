"""Descriptive access discovery (P03-T10).

Lists the events in which the current User holds an eligible role, derived from current rows.
It grants nothing: every destination still authorizes independently, no desk or organizer
session is issued, and no ORGANIZER role is ever inferred.
"""

import uuid
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select

from app.db import SessionDep
from app.models import Booth, BoothStaff, DeskOperator, Event, Ticket
from app.routes.auth import CurrentUserDep

router = APIRouter(prefix="/api/me", tags=["access"])

Role = Literal["ATTENDEE", "RECEPTION", "PARTNER"]
ROLE_ORDER: tuple[Role, ...] = ("ATTENDEE", "RECEPTION", "PARTNER")


class AccessEvent(BaseModel):
    event_id: uuid.UUID
    event_slug: str
    event_name: str
    roles: list[Role]
    ticket_ids: list[uuid.UUID]
    desk_operator_ids: list[uuid.UUID]
    booth_ids: list[uuid.UUID]
    partner_ids: list[uuid.UUID]


class AccessOut(BaseModel):
    user_id: uuid.UUID
    events: list[AccessEvent]


@router.get("/access")
async def get_my_access(user: CurrentUserDep, session: SessionDep) -> AccessOut:
    tickets = await session.execute(
        select(Ticket.event_id, Ticket.id).where(
            Ticket.user_id == user.id, Ticket.status == "active"
        )
    )
    operators = await session.execute(
        select(DeskOperator.event_id, DeskOperator.id).where(
            DeskOperator.user_id == user.id, DeskOperator.is_revoked.is_(False)
        )
    )
    booths = await session.execute(
        select(Booth.event_id, Booth.id)
        .join(BoothStaff, BoothStaff.booth_id == Booth.id)
        .where(BoothStaff.user_id == user.id)
    )
    grouped: dict[uuid.UUID, dict[str, set[uuid.UUID]]] = {}
    for key, result in (("ticket", tickets), ("desk", operators), ("booth", booths)):
        for event_id, row_id in result.all():
            ids = grouped.setdefault(event_id, {"ticket": set(), "desk": set(), "booth": set()})
            ids[key].add(row_id)

    if not grouped:
        return AccessOut(user_id=user.id, events=[])

    events = (await session.scalars(select(Event).where(Event.id.in_(grouped)))).all()
    contexts: list[AccessEvent] = []
    for event in sorted(events, key=lambda e: (e.slug, str(e.id))):
        ids = grouped[event.id]
        eligible = {"ATTENDEE": ids["ticket"], "RECEPTION": ids["desk"], "PARTNER": ids["booth"]}
        contexts.append(
            AccessEvent(
                event_id=event.id,
                event_slug=event.slug,
                event_name=event.name,
                roles=[role for role in ROLE_ORDER if eligible[role]],
                ticket_ids=sorted(ids["ticket"], key=str),
                desk_operator_ids=sorted(ids["desk"], key=str),
                booth_ids=sorted(ids["booth"], key=str),
                partner_ids=[],
            )
        )
    return AccessOut(user_id=user.id, events=contexts)
