"""data integrity: CHECK constraints, same-event foreign keys, delete rules, indexes, walk-in idempotency keys

Revision ID: 0021
Revises: 0023
Create Date: 2026-10-23

What the application already enforced in code is now enforced by PostgreSQL as well:

* CHECK constraints: a tier's `0 <= reserved_count <= quota`; check-in point and check-in `policy_type`; check-in
  `status` (ADMITTED/REJECTED); `checkin_points.max_capacity > 0` (NULL = no cap); lead `rating` (HOT/WARM/COLD).
  `tickets.status` is constrained by the ticket lifecycle migration (`ck_tickets_status`), not here.
* Same-event integrity: `ticket_tiers`, `booths` and `tickets` get a unique `(id, event_id)` so that
  `tickets (ticket_tier_id, event_id)` and the new `leads.event_id` (backfilled from the booth) can reference
  them with composite foreign keys. A ticket can no longer point at another event's tier, and a lead's booth and
  ticket must belong to the same event. The composite keys replace the single-column ones.
* Delete rules for an event's rows, explicit instead of the default NO ACTION. Events can only be deleted while
  they have no tickets, so attendance and registration data is RESTRICT (tickets, the tier a ticket holds, a
  lead's booth and ticket, connections); pure configuration is CASCADE (tiers, check-in points and their scanner
  devices, booths with their staff assignments and bookmarks, desk operators). Polymorphic `entity_qrs` rows
  (booth QRs) have no foreign key and must still be removed by whoever deletes an event.
* Indexes: `checkins (checkin_point_id, status)` for capacity and manifest counts, `entity_qrs (entity_type,
  entity_id)` for QR lookups by owner, `tickets (event_id, status)` for per-event active-ticket queries.
* `desk_idempotency_keys`: a walk-in registration's `Idempotency-Key`, scoped to the event and the desk actor.

Existing rows are checked before any constraint is added. Nothing is "repaired" silently: if a row would
violate a new rule the upgrade stops with a message naming the table and up to five offending ids, and the
data has to be corrected by hand (the right fix depends on what the organizer meant).

Not backward-compatible (a contract step, so no `backward_compatible` flag): the previous release inserts leads
without `event_id`, which is now NOT NULL, so it cannot run on this schema.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0021"
down_revision: Union[str, Sequence[str], None] = "0023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

POLICIES = "('MULTI_ENTRY', 'SINGLE_USE', 'TIER_RESTRICTED', 'CAPACITY_CAPPED')"

CHECKS: list[tuple[str, str, str, str]] = [
    # (table, name, condition, what it means)
    (
        "ticket_tiers",
        "ck_ticket_tiers_reserved_count",
        "reserved_count >= 0 AND reserved_count <= quota",
        "reserved_count must be between 0 and quota",
    ),
    ("checkin_points", "ck_checkin_points_policy_type", f"policy_type IN {POLICIES}", "unknown policy_type"),
    (
        "checkin_points",
        "ck_checkin_points_max_capacity",
        "max_capacity IS NULL OR max_capacity > 0",
        "max_capacity must be positive or NULL",
    ),
    ("checkins", "ck_checkins_status", "status IN ('ADMITTED', 'REJECTED')", "status must be ADMITTED or REJECTED"),
    ("checkins", "ck_checkins_policy_type", f"policy_type IN {POLICIES}", "unknown policy_type"),
    ("leads", "ck_leads_rating", "rating IN ('HOT', 'WARM', 'COLD')", "rating must be HOT, WARM or COLD"),
]

# Delete rules for single-column foreign keys: (table, column, referred table, ondelete).
DELETE_RULES: list[tuple[str, str, str, str]] = [
    ("ticket_tiers", "event_id", "events", "CASCADE"),
    ("tickets", "event_id", "events", "RESTRICT"),
    ("checkin_points", "event_id", "events", "CASCADE"),
    ("scanner_devices", "event_id", "events", "CASCADE"),
    ("scanner_devices", "checkin_point_id", "checkin_points", "CASCADE"),
    ("booths", "event_id", "events", "CASCADE"),
    ("booth_staff", "booth_id", "booths", "CASCADE"),
    ("booth_bookmarks", "booth_id", "booths", "CASCADE"),
    ("desk_operators", "event_id", "events", "CASCADE"),
    ("connections", "event_id", "events", "RESTRICT"),
]

# Problems in existing data that block the upgrade: (description, query returning offending ids).
PRECHECKS: list[tuple[str, str]] = [
    *(
        (f"{table}: {meaning} ({name})", f"SELECT id FROM {table} WHERE NOT ({condition}) ORDER BY id LIMIT 5")
        for table, name, condition, meaning in CHECKS
    ),
    (
        "tickets: ticket tier belongs to another event (fk_tickets_tier_same_event)",
        "SELECT t.id FROM tickets t JOIN ticket_tiers tt ON tt.id = t.ticket_tier_id "
        "WHERE tt.event_id <> t.event_id ORDER BY t.id LIMIT 5",
    ),
    (
        "leads: the attendee's ticket is for another event than the booth (fk_leads_ticket_same_event)",
        "SELECT l.id FROM leads l JOIN booths b ON b.id = l.booth_id JOIN tickets t ON t.id = l.ticket_id "
        "WHERE b.event_id <> t.event_id ORDER BY l.id LIMIT 5",
    ),
]


def _refuse_violating_data() -> None:
    bind = op.get_bind()
    problems = []
    for description, query in PRECHECKS:
        ids = [str(row[0]) for row in bind.execute(sa.text(query))]
        if ids:
            problems.append(f"  - {description}: {', '.join(ids)}")
    if problems:
        raise RuntimeError(
            "Migration 0021 refused: existing rows would violate the new integrity rules. Correct them by hand "
            "(the right fix depends on what was meant) and run the upgrade again. First offending ids:\n"
            + "\n".join(problems)
        )


def _fk_name(table: str, columns: list[str], referred: str) -> str:
    for fk in sa.inspect(op.get_bind()).get_foreign_keys(table):
        if fk["constrained_columns"] == columns and fk["referred_table"] == referred:
            name: str = fk["name"]
            return name
    raise RuntimeError(f"Migration 0021: no foreign key {table}({', '.join(columns)}) -> {referred} to replace")


def _replace_fk(table: str, column: str, referred: str, ondelete: str | None) -> None:
    op.drop_constraint(_fk_name(table, [column], referred), table, type_="foreignkey")
    # Unnamed: PostgreSQL names it <table>_<column>_fkey, as the original.
    op.create_foreign_key(None, table, referred, [column], ["id"], ondelete=ondelete)


def upgrade() -> None:
    # Backfill the lead's event from its booth before checking: the precheck compares it with the ticket's.
    op.add_column("leads", sa.Column("event_id", sa.Uuid(), nullable=True))
    op.execute("UPDATE leads SET event_id = booths.event_id FROM booths WHERE booths.id = leads.booth_id")
    _refuse_violating_data()
    op.alter_column("leads", "event_id", nullable=False)
    op.create_index(op.f("ix_leads_event_id"), "leads", ["event_id"], unique=False)

    for table, name, condition, _meaning in CHECKS:
        op.create_check_constraint(name, table, condition)

    op.create_unique_constraint("uq_ticket_tiers_id_event", "ticket_tiers", ["id", "event_id"])
    op.create_unique_constraint("uq_booths_id_event", "booths", ["id", "event_id"])
    op.create_unique_constraint("uq_tickets_id_event", "tickets", ["id", "event_id"])

    op.drop_constraint(_fk_name("tickets", ["ticket_tier_id"], "ticket_tiers"), "tickets", type_="foreignkey")
    op.create_foreign_key(
        "fk_tickets_tier_same_event", "tickets", "ticket_tiers",
        ["ticket_tier_id", "event_id"], ["id", "event_id"], ondelete="RESTRICT",
    )
    op.drop_constraint(_fk_name("leads", ["booth_id"], "booths"), "leads", type_="foreignkey")
    op.create_foreign_key(
        "fk_leads_booth_same_event", "leads", "booths", ["booth_id", "event_id"], ["id", "event_id"], ondelete="RESTRICT"
    )
    op.drop_constraint(_fk_name("leads", ["ticket_id"], "tickets"), "leads", type_="foreignkey")
    op.create_foreign_key(
        "fk_leads_ticket_same_event", "leads", "tickets",
        ["ticket_id", "event_id"], ["id", "event_id"], ondelete="RESTRICT",
    )

    for table, column, referred, ondelete in DELETE_RULES:
        _replace_fk(table, column, referred, ondelete)

    op.create_index("ix_checkins_point_status", "checkins", ["checkin_point_id", "status"], unique=False)
    op.create_index("ix_entity_qrs_entity", "entity_qrs", ["entity_type", "entity_id"], unique=False)
    op.create_index("ix_tickets_event_status", "tickets", ["event_id", "status"], unique=False)

    op.create_table(
        "desk_idempotency_keys",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("actor", sa.String(length=64), nullable=False),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("ticket_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["ticket_id"], ["tickets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", "actor", "key", name="uq_desk_idempotency_keys_scope"),
    )
    op.create_index(
        op.f("ix_desk_idempotency_keys_expires_at"), "desk_idempotency_keys", ["expires_at"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_desk_idempotency_keys_expires_at"), table_name="desk_idempotency_keys")
    op.drop_table("desk_idempotency_keys")

    op.drop_index("ix_tickets_event_status", table_name="tickets")
    op.drop_index("ix_entity_qrs_entity", table_name="entity_qrs")
    op.drop_index("ix_checkins_point_status", table_name="checkins")

    for table, column, referred, _ondelete in DELETE_RULES:
        _replace_fk(table, column, referred, None)

    op.drop_constraint("fk_leads_ticket_same_event", "leads", type_="foreignkey")
    op.create_foreign_key(None, "leads", "tickets", ["ticket_id"], ["id"])
    op.drop_constraint("fk_leads_booth_same_event", "leads", type_="foreignkey")
    op.create_foreign_key(None, "leads", "booths", ["booth_id"], ["id"])
    op.drop_constraint("fk_tickets_tier_same_event", "tickets", type_="foreignkey")
    op.create_foreign_key(None, "tickets", "ticket_tiers", ["ticket_tier_id"], ["id"])

    op.drop_constraint("uq_tickets_id_event", "tickets", type_="unique")
    op.drop_constraint("uq_booths_id_event", "booths", type_="unique")
    op.drop_constraint("uq_ticket_tiers_id_event", "ticket_tiers", type_="unique")

    for table, name, _condition, _meaning in reversed(CHECKS):
        op.drop_constraint(name, table, type_="check")

    op.drop_index(op.f("ix_leads_event_id"), table_name="leads")
    op.drop_column("leads", "event_id")
