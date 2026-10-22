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
const MyCongress = lazy(() => import("./pages/MyCongress"));
const MyNetwork = lazy(() => import("./pages/MyNetwork"));
const MyProfile = lazy(() => import("./pages/MyProfile"));
const MyTickets = lazy(() => import("./pages/MyTickets"));
const NotFound = lazy(() => import("./pages/NotFound"));
const OrganizerAnalytics = lazy(() => import("./pages/OrganizerAnalytics"));
const OrganizerSms = lazy(() => import("./pages/OrganizerSms"));
const PlatformConsole = lazy(() => import("./pages/PlatformConsole"));
const PlatformSms = lazy(() => import("./pages/PlatformSms"));
const PlatformSignIn = lazy(() => import("./pages/PlatformSignIn"));
const PlatformOrganizers = lazy(() => import("./pages/PlatformOrganizers"));
const OrganizerDesk = lazy(() => import("./pages/OrganizerDesk"));
const OrganizerEventDetail = lazy(() => import("./pages/OrganizerEventDetail"));
const OrganizerEvents = lazy(() => import("./pages/OrganizerEvents"));
const OrganizerLayout = lazy(() => import("./pages/OrganizerLayout"));
const OrganizerPagePreview = lazy(() => import("./pages/OrganizerPagePreview"));
const OrganizerPageStudio = lazy(() => import("./pages/OrganizerPageStudio"));
const OrganizerPanel = lazy(() => import("./pages/OrganizerPanel"));
const OrganizerPanelFrame = lazy(() => import("./pages/OrganizerPanel").then((m) => ({ default: m.OrganizerPanelFrame })));
const OrganizerProgram = lazy(() => import("./pages/OrganizerProgram"));
const OrganizerVenue = lazy(() => import("./pages/OrganizerVenue"));
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
          <Route path="events/:eventId" element={section(<OrganizerEventDetail />)} />
          <Route path="events/:eventId/program" element={section(<OrganizerProgram />)} />
          <Route path="events/:eventId/venue" element={section(<OrganizerVenue />)} />
          <Route path="events/:eventId/tiers" element={section(<OrganizerEventDetail />)} />
          <Route path="events/:eventId/check-in" element={section(<OrganizerEventDetail />)} />
          <Route path="events/:eventId/booths" element={section(<OrganizerEventDetail />)} />
          <Route path="events/:eventId/operators" element={section(<OrganizerEventDetail />)} />
          <Route path="events/:eventId/page" element={section(<OrganizerPageStudio />)} />
          <Route path="events/:eventId/panel" element={section(<OrganizerPanel />)} />
          <Route path="events/:eventId/desk" element={section(<OrganizerDesk />)} />
          <Route path="events/:eventId/sms" element={section(<OrganizerSms />)} />
          <Route path="events/:eventId/analytics" element={section(<OrganizerAnalytics />)} />
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
        <Route path="/my-tickets" element={<MyTickets />} />
        <Route path="/my-network" element={<MyNetwork />} />
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
