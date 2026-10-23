"""SMS message templates, written and stored in the Congress app (not in the sms.ir panel).

Messages go out as plain text from the platform's sms.ir service line, so the wording lives here:
built-in Persian defaults, a platform-wide override per kind (platform admin), and for the ticket
confirmation a per-event override (the event's organizer). Placeholders are `{name}`-style tokens; an
unknown token is refused when the template is saved, so a typo never reaches an attendee's phone.
"""

import re
import uuid
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SmsTemplate

SmsKind = Literal["otp", "ticket_confirmation", "ticket_cancelled", "ticket_reissued"]
# Kinds an organizer may override for one event (sign-in codes are platform-wide: they belong to no event).
EVENT_KINDS: tuple[SmsKind, ...] = ("ticket_confirmation", "ticket_cancelled", "ticket_reissued")
MAX_BODY_LENGTH = 1000
# Long names and event titles are shortened so one message never balloons into many SMS parts.
MAX_VALUE_LENGTH = 60
# Values inserted exactly as given: a shortened pass link ("…/my-tic…") opens no page.
VERBATIM_PLACEHOLDERS = frozenset({"link"})

_TOKEN = re.compile(r"\{([A-Za-z_]+)\}")


@dataclass(frozen=True)
class KindSpec:
    placeholders: tuple[str, ...]
    required: tuple[str, ...]
    default: str


KINDS: dict[SmsKind, KindSpec] = {
    "otp": KindSpec(
        placeholders=("code", "minutes"),
        required=("code",),
        default="کد ورود شما به سامانه همایش: {code}\nاین کد تا {minutes} دقیقه معتبر است؛ آن را به کسی ندهید.",
    ),
    "ticket_confirmation": KindSpec(
        placeholders=("name", "event", "tier", "location", "link"),
        required=(),
        default="{name} عزیز، ثبت‌نام شما در «{event}» تأیید شد.\nکارت ورود: {link}",
    ),
    # Ticket lifecycle (app/ticket_lifecycle.py). Placeholders are a subset of the confirmation's, so the
    # organizer's preview and test send fill them with the same sample values.
    "ticket_cancelled": KindSpec(
        placeholders=("name", "event", "tier"),
        required=(),
        default="{name} عزیز، بلیت شما در «{event}» لغو شد و کارت ورود آن دیگر معتبر نیست.",
    ),
    "ticket_reissued": KindSpec(
        placeholders=("name", "event", "tier", "location", "link"),
        required=(),
        default="{name} عزیز، کارت ورود شما در «{event}» دوباره صادر شد و کارت قبلی دیگر معتبر نیست.\nکارت ورود جدید: {link}",
    ),
}


class TemplateError(ValueError):
    pass


def validate_body(kind: SmsKind, body: str) -> str:
    """The normalized body, or TemplateError naming the problem (shown to the organizer as is)."""
    text = body.replace("\r\n", "\n").strip()
    if not text:
        raise TemplateError("The message cannot be empty.")
    if len(text) > MAX_BODY_LENGTH:
        raise TemplateError(f"The message is longer than {MAX_BODY_LENGTH} characters.")
    spec = KINDS[kind]
    used = set(_TOKEN.findall(text))
    unknown = sorted(used - set(spec.placeholders))
    if unknown:
        allowed = ", ".join(f"{{{p}}}" for p in spec.placeholders)
        raise TemplateError(f"Unknown placeholder {', '.join(f'{{{u}}}' for u in unknown)}. Allowed: {allowed}.")
    missing = [p for p in spec.required if p not in used]
    if missing:
        raise TemplateError(f"The message must contain {', '.join(f'{{{m}}}' for m in missing)}.")
    return text


def _clean(value: str) -> str:
    value = " ".join(str(value).split())
    return value if len(value) <= MAX_VALUE_LENGTH else value[: MAX_VALUE_LENGTH - 1] + "…"


def _fill(name: str, values: dict[str, str]) -> str:
    return values[name] if name in VERBATIM_PLACEHOLDERS else _clean(values[name])


def render(body: str, values: dict[str, str]) -> str:
    """Fill the placeholders; values are flattened to one line (no injected line breaks) and shortened,
    except VERBATIM_PLACEHOLDERS (the pass link), which are inserted whole."""
    return _TOKEN.sub(lambda m: _fill(m.group(1), values) if m.group(1) in values else m.group(0), body)


async def stored_body(session: AsyncSession, kind: SmsKind, event_id: uuid.UUID | None) -> str | None:
    clause = SmsTemplate.event_id.is_(None) if event_id is None else SmsTemplate.event_id == event_id
    result: str | None = await session.scalar(
        select(SmsTemplate.body).where(SmsTemplate.kind == kind, clause)
    )
    return result


async def platform_body(session: AsyncSession, kind: SmsKind) -> str:
    """The platform-wide wording: the admin's override, else the built-in default."""
    return await stored_body(session, kind, None) or KINDS[kind].default


async def effective_body(session: AsyncSession, kind: SmsKind, event_id: uuid.UUID | None) -> str:
    """What is actually sent: the event's override, else the platform wording."""
    if event_id is not None:
        override = await stored_body(session, kind, event_id)
        if override:
            return override
    return await platform_body(session, kind)


async def save_body(session: AsyncSession, kind: SmsKind, event_id: uuid.UUID | None, body: str) -> None:
    """Insert or replace the stored template (caller commits)."""
    clause = SmsTemplate.event_id.is_(None) if event_id is None else SmsTemplate.event_id == event_id
    row = await session.scalar(select(SmsTemplate).where(SmsTemplate.kind == kind, clause).with_for_update())
    if row is None:
        session.add(SmsTemplate(kind=kind, event_id=event_id, body=body))
    else:
        row.body = body


async def delete_body(session: AsyncSession, kind: SmsKind, event_id: uuid.UUID | None) -> None:
    clause = SmsTemplate.event_id.is_(None) if event_id is None else SmsTemplate.event_id == event_id
    row = await session.scalar(select(SmsTemplate).where(SmsTemplate.kind == kind, clause))
    if row is not None:
        await session.delete(row)
