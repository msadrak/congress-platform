"""The organizer console session and its members (ADR 0016).

Members sign in with their mobile number and an SMS code (purpose "organizer"); a person who belongs to several
organizers picks one. Owners manage the members; every change is written to the audit log, which managers
read here as the organizer's activity.
"""

import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError

from app.audit import masked, record
from app.auth import OrganizerPrincipal, OrganizerPrincipalDep
from app.db import SessionDep
from app.errors import ApiError, error_responses
from app.models import AuditEvent, Organizer, OrganizerMember, SmsMessage, User
from app.roles import Role
from app.routes.auth import OtpCode, verify_code
from app.security import create_organizer_member_token, create_organizer_select_token, decode_access_token
from app.sms.phone import IranMobile

router = APIRouter(prefix="/api/organizer", tags=["organizer-console"])

RoleName = Literal["owner", "manager", "staff", "viewer"]
NameStr = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
ROLE_FA = {"owner": "مالک", "manager": "مدیر", "staff": "کارمند", "viewer": "ناظر"}


class OrganizerSummary(BaseModel):
    id: uuid.UUID
    name: str


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str
    mobile: str | None
    role: RoleName
    invited_by: str
    created_at: datetime
    revoked_at: datetime | None


class OrganizerSessionOut(BaseModel):
    """Who is signed in to the console: the API key (as owner) or a member, and with which role."""

    kind: Literal["key", "member"]
    role: RoleName
    organizer: OrganizerSummary
    member: MemberOut | None = None


class MemberLogin(BaseModel):
    mobile: IranMobile
    code: OtpCode


class MemberChoice(BaseModel):
    organizer: OrganizerSummary
    role: RoleName


class MemberLoginOut(BaseModel):
    """`signed_in` carries the session; `choose_organizer` (a member of several) a token for /session."""

    status: Literal["signed_in", "choose_organizer"]
    access_token: str | None = None
    token_type: str = "bearer"
    session: OrganizerSessionOut | None = None
    selection_token: str | None = None
    organizers: list[MemberChoice] = []


class MemberSessionCreate(BaseModel):
    selection_token: str
    organizer_id: uuid.UUID


class MemberCreate(BaseModel):
    mobile: IranMobile
    display_name: NameStr
    role: RoleName


class MemberUpdate(BaseModel):
    display_name: NameStr | None = None
    role: RoleName | None = None


class AuditEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    at: datetime
    actor_type: str
    actor_label: str
    action: str
    event_id: uuid.UUID | None
    entity_type: str | None
    entity_id: str | None
    summary: dict[str, object]
    ip: str | None
    request_id: str | None


class ActivityPage(BaseModel):
    items: list[AuditEventOut]
    # Pass as `before` for the next (older) page; null on the last page.
    next_before: str | None


def _member_out(member: OrganizerMember, mobile: str | None) -> MemberOut:
    return MemberOut(
        id=member.id,
        display_name=member.display_name,
        mobile=mobile,
        role=member.role,
        invited_by=member.invited_by,
        created_at=member.created_at,
        revoked_at=member.revoked_at,
    )


def _session_out(principal: OrganizerPrincipal, mobile: str | None = None) -> OrganizerSessionOut:
    organizer = OrganizerSummary(id=principal.organizer.id, name=principal.organizer.name)
    if principal.member is None:
        return OrganizerSessionOut(kind="key", role="owner", organizer=organizer)
    return OrganizerSessionOut(
        kind="member", role=principal.member.role,
        organizer=organizer, member=_member_out(principal.member, mobile),
    )


async def _active_memberships(session: SessionDep, user_id: uuid.UUID) -> list[tuple[OrganizerMember, Organizer]]:
    rows = await session.execute(
        select(OrganizerMember, Organizer)
        .join(Organizer, OrganizerMember.organizer_id == Organizer.id)
        .where(
            OrganizerMember.user_id == user_id,
            OrganizerMember.revoked_at.is_(None),
            Organizer.revoked_at.is_(None),
        )
        .order_by(Organizer.name, Organizer.id)
    )
    return [(member, organizer) for member, organizer in rows.all()]


async def _signed_in(
    session: SessionDep, request: Request, member: OrganizerMember, organizer: Organizer, mobile: str
) -> MemberLoginOut:
    principal = OrganizerPrincipal(organizer, Role[member.role], member)
    record(session, request, "member.signed_in", actor=principal.actor, entity_type="member", entity_id=member.id)
    await session.commit()
    token = create_organizer_member_token(
        member.id, organizer.id, member.session_version, request.app.state.settings.jwt_secret
    )
    return MemberLoginOut(status="signed_in", access_token=token, session=_session_out(principal, mobile))


def not_a_member() -> ApiError:
    return ApiError(status.HTTP_403_FORBIDDEN, "NOT_A_MEMBER", "This number is not a member of an organizer")


@router.post("/login", responses=error_responses(status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))
async def member_login(body: MemberLogin, request: Request, session: SessionDep) -> MemberLoginOut:
    """Exchange an SMS code (requested with purpose "organizer") for a console session."""
    await verify_code(request, session, body.mobile, body.code, "organizer")
    user = await session.scalar(select(User).where(User.mobile == body.mobile))
    memberships = await _active_memberships(session, user.id) if user else []
    if user is None or not memberships:
        raise not_a_member()
    if len(memberships) == 1:
        member, organizer = memberships[0]
        return await _signed_in(session, request, member, organizer, body.mobile)
    return MemberLoginOut(
        status="choose_organizer",
        selection_token=create_organizer_select_token(user.id, request.app.state.settings.jwt_secret),
        organizers=[
            MemberChoice(organizer=OrganizerSummary(id=o.id, name=o.name), role=m.role)
            for m, o in memberships
        ],
    )


@router.post("/session", responses=error_responses(status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))
async def choose_organizer(body: MemberSessionCreate, request: Request, session: SessionDep) -> MemberLoginOut:
    """The second step for a member of several organizers: a session with the one they picked."""
    payload = decode_access_token(body.selection_token, request.app.state.settings.jwt_secret)
    if payload is None or payload.get("type") != "organizer_select":
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "SIGN_IN_EXPIRED", "The sign-in expired. Request a new code.")
    try:
        user_id = uuid.UUID(str(payload.get("user_id")))
    except ValueError:
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "SIGN_IN_EXPIRED", "The sign-in expired. Request a new code.")
    user = await session.get(User, user_id)
    chosen = [
        (m, o) for m, o in (await _active_memberships(session, user_id) if user else []) if o.id == body.organizer_id
    ]
    if user is None or user.mobile is None or not chosen:
        raise not_a_member()
    member, organizer = chosen[0]
    return await _signed_in(session, request, member, organizer, user.mobile)


@router.get("/me")
async def console_session(principal: OrganizerPrincipalDep, session: SessionDep) -> OrganizerSessionOut:
    mobile = await session.scalar(select(User.mobile).where(User.id == principal.member.user_id)) if principal.member else None
    return _session_out(principal, mobile)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def console_logout(principal: OrganizerPrincipalDep, request: Request, session: SessionDep) -> Response:
    """Ends every session of this member (an API key has no session to end)."""
    if principal.member is not None:
        member = await session.get(OrganizerMember, principal.member.id, with_for_update=True)
        if member is not None:
            member.session_version += 1
            record(session, request, "member.signed_out", entity_type="member", entity_id=member.id)
            await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Members -------------------------------------------------------------------------------------------------

async def list_members(session: SessionDep, organizer_id: uuid.UUID) -> list[MemberOut]:
    rows = await session.execute(
        select(OrganizerMember, User.mobile)
        .join(User, OrganizerMember.user_id == User.id)
        .where(OrganizerMember.organizer_id == organizer_id)
        .order_by(OrganizerMember.revoked_at.is_not(None), OrganizerMember.created_at, OrganizerMember.id)
    )
    return [_member_out(member, mobile) for member, mobile in rows.all()]


def invitation_text(organizer: Organizer, member: OrganizerMember, origin: str) -> str:
    return (
        f"{member.display_name} عزیز، شما با نقش «{ROLE_FA[member.role]}» به کنسول «{organizer.name}» اضافه شدید. "
        f"ورود با همین شماره: {origin.rstrip('/')}/organizer"
    )


async def add_member(
    session: SessionDep, request: Request, organizer: Organizer, body: MemberCreate, invited_by: str
) -> MemberOut:
    """Add (or re-add a revoked) member, queue the invitation SMS and record it; the caller's actor is audited."""
    user = await session.scalar(select(User).where(User.mobile == body.mobile))
    if user is None:
        user = User(mobile=body.mobile, full_name=body.display_name)
        session.add(user)
        await session.flush()
    member = await session.scalar(
        select(OrganizerMember)
        .where(OrganizerMember.organizer_id == organizer.id, OrganizerMember.user_id == user.id)
        .with_for_update()
    )
    if member is not None and member.revoked_at is None:
        raise ApiError(status.HTTP_409_CONFLICT, "MEMBER_EXISTS", "This number is already a member")
    if member is None:
        member = OrganizerMember(
            organizer_id=organizer.id, user_id=user.id, role=body.role, display_name=body.display_name,
            invited_by=invited_by, session_version=0,
        )
        session.add(member)
    else:
        member.role = body.role
        member.display_name = body.display_name
        member.invited_by = invited_by
        member.revoked_at = None
        member.session_version += 1
    try:
        await session.flush()
    except IntegrityError:
        # The same number invited twice at once: the other request won.
        await session.rollback()
        raise ApiError(status.HTTP_409_CONFLICT, "MEMBER_EXISTS", "This number is already a member") from None
    settings = request.app.state.settings
    session.add(
        SmsMessage(
            kind="member_invite",
            mobile=body.mobile,
            body=invitation_text(organizer, member, settings.public_origin or str(request.base_url)),
            status="pending",
            send_after=datetime.now(timezone.utc),
        )
    )
    record(
        session, request, "member.invited", organizer_id=organizer.id, entity_type="member", entity_id=member.id,
        summary={"role": body.role, "display_name": body.display_name, "mobile": masked(body.mobile)},
    )
    await session.commit()
    await session.refresh(member)
    return _member_out(member, body.mobile)


async def _organizer_member(session: SessionDep, organizer_id: uuid.UUID, member_id: uuid.UUID) -> OrganizerMember:
    member = await session.scalar(
        select(OrganizerMember)
        .where(OrganizerMember.id == member_id, OrganizerMember.organizer_id == organizer_id)
        .with_for_update()
    )
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    return member


async def _refuse_last_owner(session: SessionDep, member: OrganizerMember) -> None:
    """An organizer whose members include an owner keeps at least one active owner member."""
    if member.role != "owner" or member.revoked_at is not None:
        return
    owners = await session.scalar(
        select(func.count(OrganizerMember.id)).where(
            OrganizerMember.organizer_id == member.organizer_id,
            OrganizerMember.role == "owner",
            OrganizerMember.revoked_at.is_(None),
        )
    )
    if (owners or 0) <= 1:
        raise ApiError(
            status.HTTP_409_CONFLICT, "LAST_OWNER", "Add another owner before removing or demoting the last one"
        )


async def _mobile(session: SessionDep, member: OrganizerMember) -> str | None:
    return await session.scalar(select(User.mobile).where(User.id == member.user_id))


@router.get("/members")
async def organizer_members(principal: OrganizerPrincipalDep, session: SessionDep) -> list[MemberOut]:
    return await list_members(session, principal.organizer.id)


@router.post(
    "/members", status_code=status.HTTP_201_CREATED, responses=error_responses(status.HTTP_409_CONFLICT)
)
async def invite_member(
    body: MemberCreate, principal: OrganizerPrincipalDep, request: Request, session: SessionDep
) -> MemberOut:
    return await add_member(session, request, principal.organizer, body, principal.label)


@router.patch("/members/{member_id}", responses=error_responses(status.HTTP_409_CONFLICT))
async def update_member(
    member_id: uuid.UUID, body: MemberUpdate, principal: OrganizerPrincipalDep, request: Request, session: SessionDep
) -> MemberOut:
    member = await _organizer_member(session, principal.organizer.id, member_id)
    if member.revoked_at is not None:
        raise ApiError(status.HTTP_409_CONFLICT, "MEMBER_REVOKED", "This member was removed; invite them again")
    if body.role is not None and body.role != member.role:
        if body.role != "owner":
            await _refuse_last_owner(session, member)
        record(
            session, request, "member.role_changed", entity_type="member", entity_id=member.id,
            summary={"display_name": member.display_name, "from": member.role, "to": body.role},
        )
        member.role = body.role
        member.session_version += 1  # the session carries the role: sign in again
    if body.display_name is not None and body.display_name != member.display_name:
        record(
            session, request, "member.renamed", entity_type="member", entity_id=member.id,
            summary={"from": member.display_name, "to": body.display_name},
        )
        member.display_name = body.display_name
    await session.commit()
    await session.refresh(member)
    return _member_out(member, await _mobile(session, member))


@router.post("/members/{member_id}/revoke", responses=error_responses(status.HTTP_409_CONFLICT))
async def revoke_member(
    member_id: uuid.UUID, principal: OrganizerPrincipalDep, request: Request, session: SessionDep
) -> MemberOut:
    member = await _organizer_member(session, principal.organizer.id, member_id)
    if member.revoked_at is None:
        await _refuse_last_owner(session, member)
        member.revoked_at = datetime.now(timezone.utc)
        member.session_version += 1
        record(
            session, request, "member.revoked", entity_type="member", entity_id=member.id,
            summary={"display_name": member.display_name, "role": member.role},
        )
        await session.commit()
        await session.refresh(member)
    return _member_out(member, await _mobile(session, member))


# --- Activity ------------------------------------------------------------------------------------------------

def _cursor(row: AuditEvent) -> str:
    return f"{row.at.isoformat()}|{row.id}"


@router.get("/activity", responses=error_responses(status.HTTP_422_UNPROCESSABLE_CONTENT))
async def organizer_activity(
    principal: OrganizerPrincipalDep,
    session: SessionDep,
    event_id: uuid.UUID | None = None,
    before: Annotated[str | None, Query(max_length=100)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> ActivityPage:
    """The organizer's audit log, newest first: console actions, desk operators, and what the platform admin did
    to this organizer (key rotation, revocation, members added)."""
    query = select(AuditEvent).where(AuditEvent.organizer_id == principal.organizer.id)
    if event_id is not None:
        query = query.where(AuditEvent.event_id == event_id)
    if before is not None:
        at_text, _, id_text = before.partition("|")
        try:
            at, row_id = datetime.fromisoformat(at_text), uuid.UUID(id_text)
        except ValueError:
            raise ApiError(status.HTTP_422_UNPROCESSABLE_CONTENT, "BAD_CURSOR", "Invalid activity cursor") from None
        # Rows of one transaction share a timestamp: the id breaks the tie, so a page boundary loses nothing.
        query = query.where(or_(AuditEvent.at < at, and_(AuditEvent.at == at, AuditEvent.id < row_id)))
    rows = list(await session.scalars(query.order_by(AuditEvent.at.desc(), AuditEvent.id.desc()).limit(limit + 1)))
    page = rows[:limit]
    return ActivityPage(
        items=[AuditEventOut.model_validate(row) for row in page],
        next_before=_cursor(page[-1]) if len(rows) > limit else None,
    )
