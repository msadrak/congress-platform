import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
// Register PWA service worker (side-effect import — must remain top-level)
import "./lib/pwaRegistration";
import { CongressRoute } from "./components/ui/PortalState";
import CongressDetails from "./pages/CongressDetails";
import AttendeeSignIn from "./pages/AttendeeSignIn";
import ExhibitorPortal from "./pages/ExhibitorPortal";
import GateScanner from "./pages/GateScanner";
import Home from "./pages/Home";
import MyCongress from "./pages/MyCongress";
import MyNetwork from "./pages/MyNetwork";
import MyProfile from "./pages/MyProfile";
import MyTickets from "./pages/MyTickets";
import OrganizerAnalytics from "./pages/OrganizerAnalytics";
import OrganizerDesk from "./pages/OrganizerDesk";
import OrganizerEventDetail from "./pages/OrganizerEventDetail";
import OrganizerEvents from "./pages/OrganizerEvents";
import OrganizerLayout from "./pages/OrganizerLayout";
import PublicBooth from "./pages/PublicBooth";
import PublicEvent from "./pages/PublicEvent";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/organizer" element={<OrganizerLayout />}>
          <Route index element={<OrganizerEvents />} />
          <Route path="events/:eventId" element={<OrganizerEventDetail />} />
          <Route path="events/:eventId/desk" element={<OrganizerDesk />} />
          <Route path="events/:eventId/analytics" element={<OrganizerAnalytics />} />
        </Route>
        <Route path="/e/:slug" element={<PublicEvent />} />
        <Route path="/e/:slug/booths/:boothId" element={<PublicBooth />} />
        <Route path="/booth/:boothId" element={<ExhibitorPortal />} />
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
    </BrowserRouter>
  </React.StrictMode>
);
