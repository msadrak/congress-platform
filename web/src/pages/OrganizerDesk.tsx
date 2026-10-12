import { useMemo } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { ReceptionStation } from "../components/reception/ReceptionStation";
import type { OrganizerOutletContext } from "./OrganizerLayout";

/**
 * Compatible entry point inside Organizer administration. It mounts the same reception station as
 * the independent portal, plus the deliberate Organizer-mode switch when an organizer key exists.
 */
export default function OrganizerDesk() {
  const { eventId } = useParams<{ eventId: string }>();
  const { apiKey, onKeyRejected, locale, t, isRtl } = useOutletContext<OrganizerOutletContext>();
  const organizer = useMemo(() => ({ apiKey, onKeyRejected }), [apiKey, onKeyRejected]);
  if (!eventId) return null;
  // Remount per event so an event A session or response can never act in event B.
  return <ReceptionStation key={eventId} eventId={eventId} organizer={organizer} locale={locale} t={t} isRtl={isRtl} />;
}
