import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    false,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Organizer(Base):
    """The tenant. Every Event belongs to exactly one Organizer."""

    __tablename__ = "organizers"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200))
    api_key_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # Set when the platform admin revokes the key; a revoked organizer is rejected like an unknown key.
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    key_rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Event(Base):
    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organizer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizers.id"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(100), unique=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    location: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # ── Lifecycle (migration 0024) ──
    # IANA zone the congress happens in: program days and timetable imports are read in it.
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Tehran", server_default="Asia/Tehran")
    registration_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    # Optional reservation window; NULL ends are open.
    registration_opens_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    registration_closes_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Shown in the platform's public event list (still only once its page is published).
    listed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Archived events are hidden from every public endpoint and refuse organizer edits until unarchived.
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class EventPage(Base):
    """Public-page presentation of one event: the organizer's draft and the published snapshot.

    Visitors only ever read `published`; it is replaced as a whole by Publish. `draft_revision` is the
    optimistic-concurrency token: every save and publish names the revision it was based on.
    """

    __tablename__ = "event_pages"
    __table_args__ = (
        CheckConstraint("draft_revision >= 1", name="ck_event_pages_draft_revision"),
        CheckConstraint(
            "(published IS NULL) = (published_at IS NULL)", name="ck_event_pages_published_pair"
        ),
    )

    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
    )
    draft: Mapped[dict[str, Any]] = mapped_column(JSONB)
    draft_revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    draft_updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    published: Mapped[dict[str, Any] | None] = mapped_column(JSONB(none_as_null=True), nullable=True)
    # Draft revision that was published; differs from draft_revision while there are unpublished edits.
    published_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Images anonymous visitors may load: exactly those the published snapshot references.
    published_asset_ids: Mapped[list[str]] = mapped_column(
        JSONB, default=list, server_default="[]"
    )


class MediaAsset(Base):
    """An uploaded, re-encoded image owned by one event. Bytes live under the media root, never in the DB."""

    __tablename__ = "media_assets"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True
    )
    content_type: Mapped[str] = mapped_column(String(32))
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    byte_size: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    # Path relative to the media root, generated server-side ("<event_id>/<asset_id>.<ext>").
    storage_key: Mapped[str] = mapped_column(String(200), unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class TicketTier(Base):
    """A free admission category with a capacity quota."""

    __tablename__ = "ticket_tiers"
    __table_args__ = (
        CheckConstraint(
            "reserved_count >= 0 AND reserved_count <= quota", name="ck_ticket_tiers_reserved_count"
        ),
        # Target of the same-event foreign key from tickets.
        UniqueConstraint("id", "event_id", name="uq_ticket_tiers_id_event"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Delete rules (migration 0021): configuration CASCADEs with its event, attendance and registration data is
    # RESTRICT. An event can only be deleted while it has no tickets.
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text, default="")
    quota: Mapped[int] = mapped_column(Integer)
    reserved_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_open: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # Optional sales window enforced at reservation (migration 0024); NULL ends are open.
    sales_starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sales_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class User(Base):
    """An attendee, booth staff or desk operator account. Identity is the mobile number, proven by SMS code."""

    __tablename__ = "users"
    __table_args__ = (CheckConstraint("session_version >= 0", name="ck_users_session_version"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Canonical 09xxxxxxxxx (app/sms/phone.py). NULL only for a walk-in who gave no number; such an account
    # cannot sign in, but its ticket and pass work at the gate.
    mobile: Mapped[str | None] = mapped_column(String(11), unique=True, index=True, nullable=True)
    full_name: Mapped[str] = mapped_column(String(200))
    organization: Mapped[str] = mapped_column(String(200), default="")
    title: Mapped[str] = mapped_column(String(100), default="")
    share_contact_with_peers: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # Privacy and account lifecycle (migration 0023). Exhibitors see the mobile on a lead only with consent.
    share_contact_with_exhibitors: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    # Set when the person deleted their account: the row stays (anonymised) so check-in statistics add up.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Carried by every access token as `sv` (migration 0030). Signing out and deleting the account increment it,
    # so every session of the account ends at once (app/routes/auth.py).
    session_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")


class DeskOperator(Base):
    """An event-scoped operator authorized for reception, attendee lookup, and walk-in ticket minting."""

    __tablename__ = "desk_operators"
    __table_args__ = (
        UniqueConstraint("event_id", "user_id", name="uq_desk_operators_event_user"),
        CheckConstraint("session_version >= 0", name="ck_desk_operators_session_version"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    operator_name: Mapped[str] = mapped_column(String(200))
    is_revoked: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", index=True)
    session_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Ticket(Base):
    """A free digital ticket entitlement held by an attendee.

    The attendee_* columns are this registration's own copy of the attendee's details: the organizer edits them
    without touching the person's platform-wide account, which other congresses share (app/ticket_lifecycle.py).
    """

    __tablename__ = "tickets"
    __table_args__ = (
        UniqueConstraint("event_id", "user_id", name="uq_tickets_event_user"),
        CheckConstraint("status IN ('active', 'cancelled')", name="ck_tickets_status"),
        # The tier must be one of the ticket's own event's tiers.
        ForeignKeyConstraint(
            ["ticket_tier_id", "event_id"],
            ["ticket_tiers.id", "ticket_tiers.event_id"],
            name="fk_tickets_tier_same_event",
            ondelete="RESTRICT",
        ),
        # Target of the same-event foreign key from leads.
        UniqueConstraint("id", "event_id", name="uq_tickets_id_event"),
        Index("ix_tickets_event_status", "event_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="RESTRICT"), index=True)
    ticket_tier_id: Mapped[uuid.UUID] = mapped_column(index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(String(32), default="active")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    issued_by_operator_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("desk_operators.id"), nullable=True, index=True
    )
    # Registration details and lifecycle (migration 0023).
    attendee_full_name: Mapped[str] = mapped_column(String(200))
    attendee_organization: Mapped[str] = mapped_column(String(200), default="", server_default="")
    attendee_title: Mapped[str] = mapped_column(String(100), default="", server_default="")
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Who cancelled: organizer | attendee | account_deleted.
    cancelled_by: Mapped[str | None] = mapped_column(String(32), nullable=True)
    reissued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )



class DeskIdempotencyKey(Base):
    """The `Idempotency-Key` of a walk-in registration: a retried submission returns the ticket it already created.

    Scoped to the event and the desk actor ("operator:<id>" or "organizer"); kept until `expires_at`.
    """

    __tablename__ = "desk_idempotency_keys"
    __table_args__ = (UniqueConstraint("event_id", "actor", "key", name="uq_desk_idempotency_keys_scope"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"))
    actor: Mapped[str] = mapped_column(String(64))
    key: Mapped[str] = mapped_column(String(128))
    # SHA-256 of the request body: the same key with a different registration is refused, not replayed.
    request_hash: Mapped[str] = mapped_column(String(64))
    # Set in the same transaction that creates the ticket; NULL only while that transaction is in flight.
    ticket_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tickets.id", ondelete="CASCADE"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class ShortLink(Base):
    """The short code in a ticket confirmation SMS: `/t/{code}` opens that ticket's pass read-only (ADR 0015).

    A bearer credential like the pass QR itself: whoever holds the SMS sees the pass. Minted with the ticket
    (app/links.py), valid until 30 days after the event, revocable; the code never appears in an API URL.
    """

    __tablename__ = "short_links"

    code: Mapped[str] = mapped_column(String(16), primary_key=True)
    ticket_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    first_opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    open_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class EntityQR(Base):
    """Universal polymorphic QR registry (attendee_ticket, booth, hall, session)."""

    __tablename__ = "entity_qrs"
    __table_args__ = (Index("ix_entity_qrs_entity", "entity_type", "entity_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    secret: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    entity_type: Mapped[str] = mapped_column(String(50), index=True)
    entity_id: Mapped[uuid.UUID] = mapped_column(index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


RESET_WINDOWS = ("EVENT", "DAY")
RESET_WINDOWS_SQL = "('EVENT', 'DAY')"


class CheckInPoint(Base):
    """A physical or logical admission station (e.g. Entrance, Dining Hall, Hall A)."""

    __tablename__ = "checkin_points"
    __table_args__ = (
        CheckConstraint(
            "policy_type IN ('MULTI_ENTRY', 'SINGLE_USE', 'TIER_RESTRICTED', 'CAPACITY_CAPPED')",
            name="ck_checkin_points_policy_type",
        ),
        CheckConstraint("max_capacity IS NULL OR max_capacity > 0", name="ck_checkin_points_max_capacity"),
        CheckConstraint(f"reset_window IN {RESET_WINDOWS_SQL}", name="ck_checkin_points_reset_window"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    location: Mapped[str] = mapped_column(String(200), default="")
    policy_type: Mapped[str] = mapped_column(String(32), default="MULTI_ENTRY")
    allowed_tier_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    max_capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # ── Gate rules (migration 0025) ──
    # EVENT: a SINGLE_USE point admits a ticket once per event; DAY: once per calendar day in the event's zone.
    reset_window: Mapped[str] = mapped_column(String(8), default="EVENT", server_default="EVENT")
    # Scans carry a direction (IN/OUT) and the point knows who is inside; a capped point caps the people inside.
    tracks_occupancy: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    # A ticket must have been admitted at this point (same event) first, e.g. the venue entrance before a hall.
    requires_point_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("checkin_points.id", ondelete="SET NULL", name="fk_checkin_points_requires_point_id"),
        nullable=True,
    )
    # The door of a programme session: its admissions are the session's attendance.
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("event_sessions.id", ondelete="SET NULL", name="fk_checkin_points_session_id"),
        nullable=True,
        index=True,
    )
    # Hidden from scanners and pairing; kept, with its scans, for analytics.
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CheckIn(Base):
    """An admission scan event processed at a Check-In Point."""

    __tablename__ = "checkins"
    __table_args__ = (
        # At most one admission per ticket and admission window at a SINGLE_USE point, enforced under
        # concurrency (migration 0009, per window since 0025).
        Index(
            "uq_checkin_single_use_window",
            "checkin_point_id",
            "ticket_id",
            "admission_window",
            unique=True,
            postgresql_where=text("status = 'ADMITTED' AND policy_type = 'SINGLE_USE' AND ticket_id IS NOT NULL"),
        ),
        # Manifest deltas: tickets whose admission state at a point changed since a cursor (migration 0020).
        Index("ix_checkins_point_synced_at", "checkin_point_id", "synced_at"),
        # Capacity checks and manifests count a point's admissions (migration 0021).
        Index("ix_checkins_point_status", "checkin_point_id", "status"),
        CheckConstraint("status IN ('ADMITTED', 'REJECTED')", name="ck_checkins_status"),
        CheckConstraint(
            "policy_type IN ('MULTI_ENTRY', 'SINGLE_USE', 'TIER_RESTRICTED', 'CAPACITY_CAPPED')",
            name="ck_checkins_policy_type",
        ),
        CheckConstraint("direction IN ('IN', 'OUT')", name="ck_checkins_direction"),
        CheckConstraint(
            "admission_window = 'event' OR admission_window ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'",
            name="ck_checkins_admission_window",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)  # client-generated scan_id
    checkin_point_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("checkin_points.id"), index=True
    )
    ticket_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tickets.id"), nullable=True, index=True
    )
    qr_secret: Mapped[str] = mapped_column(String(64), index=True)
    policy_type: Mapped[str] = mapped_column(String(32), default="MULTI_ENTRY", server_default="MULTI_ENTRY")
    status: Mapped[str] = mapped_column(String(32))  # ADMITTED or REJECTED
    rejection_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    scanned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # What the scanner decided on its own (ADMITTED, PROVISIONAL, REJECTED); None for server-decided scans.
    client_verdict: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # The device clock claimed a time later than the server allows: scanned_at is the receive time instead.
    clock_skew: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    client_scanned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Entry or exit (exits only at points that track occupancy); an accepted exit is status ADMITTED, direction OUT.
    direction: Mapped[str] = mapped_column(String(3), default="IN", server_default="IN")
    # 'event', or the scan's local date (YYYY-MM-DD, event time zone) at a point whose reset_window is DAY.
    admission_window: Mapped[str] = mapped_column(String(10), default="event", server_default="event")

class ScannerDevice(Base):
    """A registered scanner client device authorized for a CheckInPoint."""

    __tablename__ = "scanner_devices"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    checkin_point_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("checkin_points.id", ondelete="CASCADE"), index=True
    )
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    device_name: Mapped[str] = mapped_column(String(100), default="Scanner Client", server_default="Scanner Client")
    is_revoked: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # What the scanner last reported in its heartbeat (migration 0025).
    unsynced_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    app_version: Mapped[str | None] = mapped_column(String(40), nullable=True)
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class Booth(Base):
    """An exhibition stall or space assigned to a commercial sponsor."""

    __tablename__ = "booths"
    __table_args__ = (
        UniqueConstraint("event_id", "slug", name="uq_booths_event_slug"),
        # Target of the same-event foreign key from leads.
        UniqueConstraint("id", "event_id", name="uq_booths_id_event"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(100), index=True)
    location: Mapped[str] = mapped_column(String(100), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    website_url: Mapped[str] = mapped_column(String(500), default="")
    brochure_url: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class BoothStaff(Base):
    """A user account authorized to manage leads and operations for a Booth."""

    __tablename__ = "booth_staff"
    __table_args__ = (
        UniqueConstraint("booth_id", "user_id", name="uq_booth_staff"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    booth_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("booths.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Connection(Base):
    """A mutual networking contact between two attendees at an event."""

    __tablename__ = "connections"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "connected_user_id", "event_id", name="uq_user_connections"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    connected_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id"), index=True
    )
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="RESTRICT"), index=True)
    private_notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class BoothBookmark(Base):
    """An attendee bookmark saving a visited commercial sponsor booth."""

    __tablename__ = "booth_bookmarks"
    __table_args__ = (
        UniqueConstraint("user_id", "booth_id", name="uq_user_booth_bookmark"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    booth_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("booths.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Lead(Base):
    """A commercial sales lead captured by an exhibitor scanning an attendee badge."""

    __tablename__ = "leads"
    __table_args__ = (
        UniqueConstraint("booth_id", "ticket_id", name="uq_booth_ticket_lead"),
        # The booth and the attendee's ticket belong to the lead's event (migration 0021).
        ForeignKeyConstraint(
            ["booth_id", "event_id"], ["booths.id", "booths.event_id"],
            name="fk_leads_booth_same_event", ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["ticket_id", "event_id"], ["tickets.id", "tickets.event_id"],
            name="fk_leads_ticket_same_event", ondelete="RESTRICT",
        ),
        CheckConstraint("rating IN ('HOT', 'WARM', 'COLD')", name="ck_leads_rating"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(index=True)
    booth_id: Mapped[uuid.UUID] = mapped_column(index=True)
    ticket_id: Mapped[uuid.UUID] = mapped_column(index=True)
    captured_by_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id"), index=True
    )
    rating: Mapped[str] = mapped_column(String(16), default="WARM")  # HOT, WARM, COLD
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    # Soft delete (migration 0027): hidden from the booth's lists and exports until restored.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class VenuePlace(Base):
    """A place attendees must find at the venue: an entrance or a hall, with directions.

    Informational only; distinct from a Check-In Point, which is a scanning station that admits tickets.
    Shown to attendees as soon as it is saved (operational data, not part of the Page Studio publish).
    """

    __tablename__ = "venue_places"
    __table_args__ = (
        CheckConstraint("kind IN ('entrance', 'hall')", name="ck_venue_places_kind"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(120))
    location: Mapped[str] = mapped_column(String(300), default="", server_default="")
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class EventSession(Base):
    """A scheduled programme item (talk, keynote, workshop, panel, class) of an event, optionally in a Hall.

    Operational data: attendees see it as soon as it is saved. The Page Studio agenda section is separate,
    editorial copy.
    """

    __tablename__ = "event_sessions"
    __table_args__ = (
        CheckConstraint("ends_at >= starts_at", name="ck_event_sessions_time_order"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    track: Mapped[str] = mapped_column(String(80), default="", server_default="")
    speakers: Mapped[str] = mapped_column(String(300), default="", server_default="")
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    # Deleting the hall keeps the session, without a hall.
    hall_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("venue_places.id", ondelete="SET NULL"), nullable=True, index=True
    )
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ProgramFile(Base):
    """The congress schedule as a file (a PDF or an image), shown to attendees beside the structured program.

    Operational data like the program: live as soon as it is visible, once the event's page is published.
    Bytes live under the media root at a server-generated key; PDFs are stored as uploaded after a magic-byte
    check, images are re-encoded by app/media.py like Page Studio images.
    """

    __tablename__ = "program_files"
    __table_args__ = (
        CheckConstraint("kind IN ('pdf', 'image')", name="ck_program_files_kind"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True
    )
    label: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(8))
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_visible: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    content_type: Mapped[str] = mapped_column(String(32))
    # Path relative to the media root, generated server-side ("<event_id>/program/<file_id>.<ext>").
    storage_key: Mapped[str] = mapped_column(String(200), unique=True)
    byte_size: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    # Images only.
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # PDFs only, when it could be read cheaply from the file; otherwise NULL.
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class OtpChallenge(Base):
    """A one-time sign-in code sent by SMS. Only an HMAC of the code is stored; a newer code supersedes older ones."""

    __tablename__ = "otp_challenges"
    __table_args__ = (Index("ix_otp_challenges_lookup", "mobile", "purpose", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    mobile: Mapped[str] = mapped_column(String(11))
    # signin (attendees, booth staff) or desk (front-desk operators).
    purpose: Mapped[str] = mapped_column(String(16))
    code_hash: Mapped[str] = mapped_column(String(64))
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class SmsMessage(Base):
    """Every SMS the platform sends: the delivery log, and the outbox for messages sent in the background.

    Messages are plain text sent from the sms.ir service line; `body` is the final text. A ticket confirmation
    is written in the same transaction as its ticket (status pending) and delivered by app/sms/outbox.py, so a
    reservation never fails or waits because of SMS. OTP rows are written after an inline send and never store
    their text (it contains the code).
    """

    __tablename__ = "sms_messages"
    __table_args__ = (UniqueConstraint("kind", "ticket_id", name="uq_sms_messages_kind_ticket"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # otp | ticket_confirmation | test
    kind: Mapped[str] = mapped_column(String(32))
    mobile: Mapped[str] = mapped_column(String(11))
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    event_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), nullable=True, index=True
    )
    ticket_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tickets.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # pending | sending (claimed by an outbox pass until lease_until) | sent | failed | unknown (may or may not have
    # been delivered; never resent automatically) | resolved (an unknown message the organizer settled by hand)
    status: Mapped[str] = mapped_column(String(16), index=True)
    provider_message_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    send_after: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    last_error: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # While `sending`: when the claiming outbox pass is presumed dead and the message becomes `unknown`.
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SmsTemplate(Base):
    """The wording of one kind of SMS: platform-wide (event_id NULL) or one event's override (app/sms/templates.py)."""

    __tablename__ = "sms_templates"
    __table_args__ = (
        Index("uq_sms_templates_platform", "kind", unique=True, postgresql_where=text("event_id IS NULL")),
        Index("uq_sms_templates_event", "event_id", "kind", unique=True, postgresql_where=text("event_id IS NOT NULL")),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), nullable=True
    )
    kind: Mapped[str] = mapped_column(String(32))
    body: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class PlatformSetting(Base):
    """A platform-wide setting edited in the platform console; absent keys fall back to the environment."""

    __tablename__ = "platform_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class RateLimitCounter(Base):
    """Attempts per throttling key in one time bucket, shared by every API process (app/rate_limit.py).

    Abuse damping, not an audit log: rows are deleted once `expires_at` has passed. A `count` of 1 under a
    one-off key also records a single-use token that was spent (e.g. a signup token).
    """

    __tablename__ = "rate_limit_counters"

    key: Mapped[str] = mapped_column(String(200), primary_key=True)
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


# --- The audit log and organizer members (ADR 0016) ---------------------------------------------------------

AUDIT_ACTOR_TYPES = (
    "platform_admin", "organizer_key", "organizer_member", "desk_operator", "booth_staff", "system"
)
ORGANIZER_ROLES = ("owner", "manager", "staff", "viewer")


def _one_of(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN (" + ", ".join(f"'{value}'" for value in values) + ")"


class AuditEvent(Base):
    """One recorded action: who (actor), for which organizer and event, what (action, entity), from where.

    Append-only: nothing in the application updates or deletes a row, and a trigger refuses UPDATE and DELETE
    (migration 0028). No foreign keys, on purpose: the trail outlives the rows it describes. `summary` never
    holds secrets or full mobile numbers (app/audit.py).
    """

    __tablename__ = "audit_events"
    __table_args__ = (
        CheckConstraint(_one_of("actor_type", AUDIT_ACTOR_TYPES), name="ck_audit_events_actor_type"),
        Index("ix_audit_events_organizer_at", "organizer_id", "at"),
        Index("ix_audit_events_event_at", "event_id", "at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    actor_type: Mapped[str] = mapped_column(String(32))
    actor_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    actor_label: Mapped[str] = mapped_column(String(200), default="", server_default="")
    organizer_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    event_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    # Dotted: member.invited, organizer.key_rotated, ...; rows written by the middleware: http.post, export.csv, ...
    action: Mapped[str] = mapped_column(String(100))
    entity_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    summary: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(128), nullable=True)


class OrganizerMember(Base):
    """A person (by mobile) who signs in to an organizer's console with a role, instead of using its API key.

    Signs in with an SMS code (purpose "organizer"). The session token carries `session_version`; signing out,
    a role change and revocation increment it, so earlier sessions stop working at once.
    """

    __tablename__ = "organizer_members"
    __table_args__ = (
        UniqueConstraint("organizer_id", "user_id", name="uq_organizer_members_organizer_user"),
        CheckConstraint(_one_of("role", ORGANIZER_ROLES), name="ck_organizer_members_role"),
        CheckConstraint("session_version >= 0", name="ck_organizer_members_session_version"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organizer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizers.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    role: Mapped[str] = mapped_column(String(16))
    display_name: Mapped[str] = mapped_column(String(200))
    # Who added them, as the console shows it: "Platform admin", "Integration key" or a member's name.
    invited_by: Mapped[str] = mapped_column(String(200), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    session_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
