import type { ApiAuthority, AttendeeDetailCard, AttendeeSearchItem } from "../../api/client";

/** The credential the desk sends: an operator session, or (Organizer administration only) the organizer's. */
export type DeskAuthority = Extract<ApiAuthority, { kind: "desk" | "organizer" }>;

export type CardState =
  | { status: "idle" }
  | { status: "loading"; ticketId: string }
  | { status: "ready"; card: AttendeeDetailCard }
  | { status: "error"; ticketId: string; message: string };

export type DuplicateState =
  | { status: "none" }
  | { status: "looking"; mobile: string }
  | { status: "found"; mobile: string; candidates: AttendeeSearchItem[] }
  | { status: "missing"; mobile: string }
  | { status: "failed"; mobile: string };
