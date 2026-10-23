/**
 * Which console controls a signed-in organizer session is offered (ADR 0016). The server decides what a role may
 * do (backend/app/roles.py): viewer reads the setup, staff runs the day (reception, scanners, participant lookup),
 * manager changes the setup, owner does everything; the API key session is the owner. The console only hides
 * what a role could never use, so a refusal is still answered with ROLE_FORBIDDEN.
 */
import type { OrganizerRole } from "../../api/client";

const RANK: Record<OrganizerRole, number> = { viewer: 1, staff: 2, manager: 3, owner: 4 };

/**
 * Whether an action that needs `needed` is offered to this session. While the session is unknown
 * (/api/organizer/me has not answered or failed, or answered without a known role) the action is offered: an
 * owner never sees their controls vanish, and the server still refuses a lower role.
 */
export function sessionAllows(session: { role: OrganizerRole } | null | undefined, needed: OrganizerRole): boolean {
  if (session == null || typeof session.role !== "string" || !Object.hasOwn(RANK, session.role)) return true;
  return RANK[session.role] >= RANK[needed];
}
