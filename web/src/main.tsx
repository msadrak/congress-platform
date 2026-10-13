import React, { Suspense, lazy, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "@fontsource-variable/vazirmatn/wght.css";
import "@fontsource-variable/schibsted-grotesk/wght.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./index.css";
// Register PWA service worker (side-effect import — must remain top-level)
import "./lib/pwaRegistration";
import { CongressRoute } from "./components/ui/PortalState";
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
const OrganizerAnalytics = lazy(() => import("./pages/OrganizerAnalytics"));
const OrganizerDesk = lazy(() => import("./pages/OrganizerDesk"));
const OrganizerEventDetail = lazy(() => import("./pages/OrganizerEventDetail"));
const OrganizerEvents = lazy(() => import("./pages/OrganizerEvents"));
const OrganizerLayout = lazy(() => import("./pages/OrganizerLayout"));
const ReceptionPortal = lazy(() => import("./pages/ReceptionPortal"));
const ReceptionEntry = lazy(() => import("./pages/ReceptionPortal").then((m) => ({ default: m.ReceptionEntry })));

/** Keeps the organizer frame on screen while a section's code loads. */
const section = (element: ReactNode) => <Suspense fallback={<div role="status" aria-busy="true" className="min-h-[60vh]" />}>{element}</Suspense>;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Suspense fallback={<div role="status" aria-busy="true" className="min-h-dvh" />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/organizer" element={<OrganizerLayout />}>
            <Route index element={section(<OrganizerEvents />)} />
            <Route path="events/:eventId" element={section(<OrganizerEventDetail />)} />
            <Route path="events/:eventId/tiers" element={section(<OrganizerEventDetail />)} />
            <Route path="events/:eventId/check-in" element={section(<OrganizerEventDetail />)} />
            <Route path="events/:eventId/booths" element={section(<OrganizerEventDetail />)} />
            <Route path="events/:eventId/operators" element={section(<OrganizerEventDetail />)} />
            <Route path="events/:eventId/desk" element={section(<OrganizerDesk />)} />
            <Route path="events/:eventId/analytics" element={section(<OrganizerAnalytics />)} />
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
        </Routes>
      </Suspense>
    </BrowserRouter>
  </React.StrictMode>
);
