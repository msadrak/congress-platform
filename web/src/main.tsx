import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import GateScanner from "./pages/GateScanner";
import Home from "./pages/Home";
import MyTickets from "./pages/MyTickets";
import OrganizerDesk from "./pages/OrganizerDesk";
import OrganizerEventDetail from "./pages/OrganizerEventDetail";
import OrganizerEvents from "./pages/OrganizerEvents";
import OrganizerLayout from "./pages/OrganizerLayout";
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
        </Route>
        <Route path="/e/:slug" element={<PublicEvent />} />
        <Route path="/my-tickets" element={<MyTickets />} />
        <Route path="/scan/:pointId" element={<GateScanner />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
