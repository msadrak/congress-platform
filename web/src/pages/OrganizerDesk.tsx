import { useMemo } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { ReceptionStation } from "../components/reception/ReceptionStation";
import { sessionAllows } from "../components/organizer/roleAccess";
import type { OrganizerOutletContext } from "./OrganizerLayout";

/**
 * The desk inside organizer administration. It mounts the same reception station as the independent portal,
 * plus the deliberate organizer-mode choice when an organizer key exists, and (managers) a way to its operators.
 */
export default function OrganizerDesk() {
  const { eventId } = useParams<{ eventId: string }>();
  const { apiKey, onKeyRejected, locale, session } = useOutletContext<OrganizerOutletContext>();
  // From the session, not the event workspace: the desk loads nothing with the organizer key on its own.
  const canManageOperators = sessionAllows(session, "manager");
  const organizer = useMemo(() => ({ apiKey, onKeyRejected, canManageOperators }), [apiKey, onKeyRejected, canManageOperators]);
  if (!eventId) return null;
  // Remount per event so an event A session or response can never act in event B.
  return <ReceptionStation key={eventId} eventId={eventId} organizer={organizer} locale={locale} />;
}
