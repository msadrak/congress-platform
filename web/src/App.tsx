import { Suspense, lazy, type ReactNode } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { CongressRoute } from "./components/ui/PortalState";
import { AppUpdatePrompt } from "./components/AppUpdatePrompt";
import { congressFallbackPath } from "./lib/congressFallback";
import { useScrollToTop } from "./hooks/useScrollToTop";
// Public pages are the first impression: shipped in the entry bundle so their first paint never
// waits for a second request.
import Home from "./pages/Home";
import PublicBooth from "./pages/PublicBooth";
import PublicEvent from "./pages/PublicEvent";

// Portals are split per environment: each downloads only its own screens. The service worker
// precaches every chunk, so the scanner keeps working offline.
const CongressDetails = lazy(() => import("./pages/CongressDetails"));
const AttendeeSignIn = lazy(() => import("./pages/AttendeeSignIn"));
const ExhibitorPortal = lazy(() => import("./pages/ExhibitorPortal"));
const GateScanner = lazy(() => import("./pages/GateScanner"));
const Me = lazy(() => import("./pages/Me"));
const MyCongress = lazy(() => import("./pages/MyCongress"));
const MyNetwork = lazy(() => import("./pages/MyNetwork"));
const MyProfile = lazy(() => import("./pages/MyProfile"));
const MyTickets = lazy(() => import("./pages/MyTickets"));
const NotFound = lazy(() => import("./pages/NotFound"));
const LinkPassEntry = lazy(() => import("./pages/LinkPassEntry"));
const OrganizerAnalytics = lazy(() => import("./pages/OrganizerAnalytics"));
const OrganizerSms = lazy(() => import("./pages/OrganizerSms"));
const PlatformConsole = lazy(() => import("./pages/PlatformConsole"));
const PlatformSms = lazy(() => import("./pages/PlatformSms"));
const PlatformSignIn = lazy(() => import("./pages/PlatformSignIn"));
const PlatformOrganizers = lazy(() => import("./pages/PlatformOrganizers"));
const OrganizerDesk = lazy(() => import("./pages/OrganizerDesk"));
// The event workspace: a layout route loading the event once, and its sections in one shared chunk.
const EventWorkspaceLayout = lazy(() => import("./pages/organizer/EventWorkspaceLayout"));
const EventOverview = lazy(() => import("./pages/organizer").then((m) => ({ default: m.EventOverview })));
const EventTiers = lazy(() => import("./pages/organizer").then((m) => ({ default: m.EventTiers })));
const EventCheckIn = lazy(() => import("./pages/organizer").then((m) => ({ default: m.EventCheckIn })));
const EventBooths = lazy(() => import("./pages/organizer").then((m) => ({ default: m.EventBooths })));
const EventOperators = lazy(() => import("./pages/organizer").then((m) => ({ default: m.EventOperators })));
const OrganizerEvents = lazy(() => import("./pages/OrganizerEvents"));
const OrganizerMembers = lazy(() => import("./pages/OrganizerMembers"));
const OrganizerActivity = lazy(() => import("./pages/OrganizerActivity"));
const OrganizerLayout = lazy(() => import("./pages/OrganizerLayout"));
const OrganizerPagePreview = lazy(() => import("./pages/OrganizerPagePreview"));
const OrganizerPageStudio = lazy(() => import("./pages/OrganizerPageStudio"));
const OrganizerParticipants = lazy(() => import("./pages/OrganizerParticipants"));
const OrganizerPanelFrame = lazy(() => import("./pages/OrganizerPanel").then((m) => ({ default: m.OrganizerPanelFrame })));
const OrganizerProgram = lazy(() => import("./pages/OrganizerProgram"));
const ReceptionPortal = lazy(() => import("./pages/ReceptionPortal"));
const ReceptionEntry = lazy(() => import("./pages/ReceptionPortal").then((m) => ({ default: m.ReceptionEntry })));

/** Keeps the organizer frame on screen while a section's code loads. */
const section = (element: ReactNode) => <Suspense fallback={<div role="status" aria-busy="true" className="min-h-[60vh]" />}>{element}</Suspense>;

/** Unknown congress address: a pass link cut short by an SMS opens the pass, anything else the congress home. */
function CongressFallback() {
  const { slug = "", "*": rest = "" } = useParams();
  return <Navigate to={congressFallbackPath(slug, rest)} replace />;
}

export default function App() {
  useScrollToTop();
  return (
    <Suspense fallback={<div role="status" aria-busy="true" className="min-h-dvh" />}>
      <AppUpdatePrompt />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/organizer" element={<OrganizerLayout />}>
          <Route index element={section(<OrganizerEvents />)} />
          {/* Organization-wide pages (ADR 0016): who signs in with which role, and the audit log. */}
          <Route path="members" element={section(<OrganizerMembers />)} />
          <Route path="activity" element={section(<OrganizerActivity />)} />
          {/* One workspace per event: `useEventWorkspace()` shares the event loaded once by the layout route. */}
          <Route path="events/:eventId" element={section(<EventWorkspaceLayout />)}>
            <Route index element={section(<EventOverview />)} />
            <Route path="program" element={section(<OrganizerProgram />)} />
            {/* Halls and entrances are a tab of the program; the attendee panel a preview of the public page. */}
            <Route path="venue" element={<Navigate to="../program?tab=venue" replace />} />
            <Route path="tiers" element={section(<EventTiers />)} />
            <Route path="check-in" element={section(<EventCheckIn />)} />
            <Route path="booths" element={section(<EventBooths />)} />
            <Route path="operators" element={section(<EventOperators />)} />
            <Route path="page" element={section(<OrganizerPageStudio />)} />
            <Route path="panel" element={<Navigate to="../page?preview=panel" replace />} />
            <Route path="desk" element={section(<OrganizerDesk />)} />
            <Route path="sms" element={section(<OrganizerSms />)} />
            <Route path="participants" element={section(<OrganizerParticipants />)} />
            <Route path="analytics" element={section(<OrganizerAnalytics />)} />
          </Route>
        </Route>
        {/* Page Studio preview frame: the public page without the organizer shell (key from this tab's session). */}
        <Route path="/organizer/events/:eventId/page/preview" element={<OrganizerPagePreview />} />
        {/* Attendee-panel preview frame, embedded by the panel control page (key from this tab's session). */}
        <Route path="/organizer/events/:eventId/panel/preview" element={<OrganizerPanelFrame />} />
        <Route path="/platform" element={<PlatformConsole />}>
          <Route index element={<PlatformSms />} />
          <Route path="sign-in" element={<PlatformSignIn />} />
          <Route path="organizers" element={<PlatformOrganizers />} />
        </Route>
        <Route path="/reception" element={<ReceptionEntry />} />
        <Route path="/reception/e/:slug" element={<ReceptionEntry />} />
        <Route path="/reception/:eventId" element={<ReceptionPortal />} />
        <Route path="/e/:slug" element={<PublicEvent />} />
        <Route path="/e/:slug/booths/:boothId" element={<PublicBooth />} />
        <Route path="/booth/:boothId" element={<ExhibitorPortal />} />
        <Route path="/booth/:boothId/sign-in" element={<AttendeeSignIn />} />
        {/* The attendee's congresses; the former cross-congress pass and network pages land there. */}
        <Route path="/me" element={<Me />} />
        <Route path="/my-tickets" element={<Navigate to="/me" replace />} />
        {/* SMS short link (ADR 0015): opens the pass, then replaces the address so the code leaves the history. */}
        <Route path="/t/:code" element={<LinkPassEntry />} />
        <Route path="/my-network" element={<Navigate to="/me" replace />} />
        <Route path="/scan/:pointId" element={<GateScanner />} />
        <Route path="/c/:slug" element={<Navigate to="my-congress" replace />} />
        <Route path="/c/:slug/my-congress" element={<CongressRoute page={MyCongress} />} />
        <Route path="/c/:slug/my-network" element={<CongressRoute page={MyNetwork} />} />
        <Route path="/c/:slug/my-ticket" element={<CongressRoute page={MyTickets} />} />
        <Route path="/c/:slug/my-profile" element={<CongressRoute page={MyProfile} />} />
        <Route path="/sign-in" element={<AttendeeSignIn />} />
        <Route path="/c/:slug/sign-in" element={<CongressRoute page={AttendeeSignIn} />} />
        <Route path="/c/:slug/details" element={<CongressRoute page={CongressDetails} />} />
        <Route path="/c/:slug/*" element={<CongressFallback />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
