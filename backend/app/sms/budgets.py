"""Per-sender budgets for SMS notices, so no one person or organizer can spend the platform's SMS allowance.

Notices (a ticket confirmation after registering again, a cancellation, a reissued or transferred pass) go out
through the outbox and count against the platform caps, which keep a share for sign-in codes (app/sms/gateway.py).
These budgets bound who can trigger them, counted in the shared rate-limit counters (app/rate_limit.py):

* an attendee's own changes, per person per hour and per ticket per day, so a loop of cancelling and registering
  again cannot text a phone (and spend the caps) without end;
* an organizer's changes that text an attendee, per organizer per hour. Routes that queue or send such a notice
  call `charge_organizer_notice` before committing the change, so a refused change does not happen at all.

The first confirmation of a registration is not counted: each person registers once per congress.
"""

import uuid

from fastapi import HTTPException, Request, status

from app.rate_limit import DAY_SECONDS, LONGEST_WINDOW_SECONDS, Budget, limiter

ATTENDEE_LIMITED = "TICKET_CHANGES_RATE_LIMITED"
ORGANIZER_LIMITED = "SMS_NOTICE_LIMIT_REACHED"


def _attendee_limits(request: Request, user_id: uuid.UUID, ticket_id: uuid.UUID) -> tuple[tuple[str, Budget], ...]:
    settings = request.app.state.settings
    return (
        (f"sms:notice:user:{user_id}", Budget(settings.sms_notices_per_attendee_per_hour, LONGEST_WINDOW_SECONDS)),
        (f"sms:notice:ticket:{ticket_id}", Budget(settings.sms_notices_per_ticket_per_day, DAY_SECONDS)),
    )


async def charge_attendee_notice(request: Request, user_id: uuid.UUID, ticket_id: uuid.UUID) -> None:
    """Count one notice triggered by an attendee's own change, or answer 429 TICKET_CHANGES_RATE_LIMITED."""
    await limiter(request).consume(
        *_attendee_limits(request, user_id, ticket_id),
        detail="Too many changes to this registration. Try again later.",
        code=ATTENDEE_LIMITED,
    )


async def attendee_notice_allowed(request: Request, user_id: uuid.UUID, ticket_id: uuid.UUID) -> bool:
    """Count one notice triggered by an attendee's own change; False (nothing counted) when a budget is used up,
    for a change that must go ahead anyway without its text (cancelling frees a place)."""
    try:
        await charge_attendee_notice(request, user_id, ticket_id)
    except HTTPException as exc:
        if exc.status_code != status.HTTP_429_TOO_MANY_REQUESTS:
            raise
        return False
    return True


async def charge_organizer_notice(request: Request, organizer_id: uuid.UUID) -> None:
    """Count one organizer change that texts an attendee, or answer 429 SMS_NOTICE_LIMIT_REACHED."""
    hourly = Budget(request.app.state.settings.sms_notices_per_organizer_per_hour, LONGEST_WINDOW_SECONDS)
    await limiter(request).consume(
        (f"sms:notice:organizer:{organizer_id}", hourly),
        detail="Your hourly allowance of SMS notices is used up. Try again later, or make the change without a notice.",
        code=ORGANIZER_LIMITED,
    )
