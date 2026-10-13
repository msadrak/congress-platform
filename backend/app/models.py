import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
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

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text, default="")
    quota: Mapped[int] = mapped_column(Integer)
    reserved_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_open: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class User(Base):
    """An attendee, buyer, or booth staff user account."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(200))
    organization: Mapped[str] = mapped_column(String(200), default="")
    title: Mapped[str] = mapped_column(String(100), default="")
    share_contact_with_peers: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
class DeskOperator(Base):
    """An event-scoped operator authorized for reception, attendee lookup, and walk-in ticket minting."""

    __tablename__ = "desk_operators"
    __table_args__ = (
        UniqueConstraint("event_id", "user_id", name="uq_desk_operators_event_user"),
        CheckConstraint("session_version >= 0", name="ck_desk_operators_session_version"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    operator_name: Mapped[str] = mapped_column(String(200))
    is_revoked: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
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
    """A free digital ticket entitlement held by an attendee."""

    __tablename__ = "tickets"
    __table_args__ = (
        UniqueConstraint("event_id", "user_id", name="uq_tickets_event_user"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id"), index=True)
    ticket_tier_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("ticket_tiers.id"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(String(32), default="active")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    issued_by_operator_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("desk_operators.id"), nullable=True, index=True
    )

class EntityQR(Base):
    """Universal polymorphic QR registry (attendee_ticket, booth, hall, session)."""

    __tablename__ = "entity_qrs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    secret: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    entity_type: Mapped[str] = mapped_column(String(50), index=True)
    entity_id: Mapped[uuid.UUID] = mapped_column(index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class CheckInPoint(Base):
    """A physical or logical admission station (e.g. Entrance, Dining Hall, Hall A)."""

    __tablename__ = "checkin_points"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    location: Mapped[str] = mapped_column(String(200), default="")
    policy_type: Mapped[str] = mapped_column(String(32), default="MULTI_ENTRY")
    allowed_tier_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    max_capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class CheckIn(Base):
    """An admission scan event processed at a Check-In Point."""

    __tablename__ = "checkins"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)  # client-generated scan_id
    checkin_point_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("checkin_points.id"), index=True
    )
    ticket_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tickets.id"), nullable=True, index=True
    )
    qr_secret: Mapped[str] = mapped_column(String(64), index=True)
    policy_type: Mapped[str] = mapped_column(String(32), default="MULTI_ENTRY", index=True)
    status: Mapped[str] = mapped_column(String(32))  # ADMITTED or REJECTED
    rejection_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    scanned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

class ScannerDevice(Base):
    """A registered scanner client device authorized for a CheckInPoint."""

    __tablename__ = "scanner_devices"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    checkin_point_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("checkin_points.id"), index=True
    )
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id"), index=True)
    device_name: Mapped[str] = mapped_column(String(100), default="Scanner Client")
    is_revoked: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

class Booth(Base):
    """An exhibition stall or space assigned to a commercial sponsor."""

    __tablename__ = "booths"
    __table_args__ = (
        UniqueConstraint("event_id", "slug", name="uq_booths_event_slug"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id"), index=True)
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
    booth_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("booths.id"), index=True)
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
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id"), index=True)
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
    booth_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("booths.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Lead(Base):
    """A commercial sales lead captured by an exhibitor scanning an attendee badge."""

    __tablename__ = "leads"
    __table_args__ = (
        UniqueConstraint("booth_id", "ticket_id", name="uq_booth_ticket_lead"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    booth_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("booths.id"), index=True)
    ticket_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tickets.id"), index=True)
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
