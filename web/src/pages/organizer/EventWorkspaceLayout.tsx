import { Outlet, useOutletContext, useParams } from "react-router-dom";
import { EventWorkspaceProvider } from "../../components/organizer/EventWorkspaceProvider";
import type { OrganizerOutletContext } from "../OrganizerLayout";

/**
 * Layout route for `/organizer/events/:eventId/*`: one event workspace per event id. Its pages keep
 * receiving the organizer outlet context unchanged; `useEventWorkspace()` adds the shared event.
 */
export default function EventWorkspaceLayout() {
  const { eventId = "" } = useParams<{ eventId: string }>();
  const organizer = useOutletContext<OrganizerOutletContext>();
  return (
    <EventWorkspaceProvider key={eventId} eventId={eventId} organizer={organizer}>
      <Outlet context={organizer} />
    </EventWorkspaceProvider>
  );
}
