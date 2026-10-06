import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import Home from "./pages/Home";
import MyTickets from "./pages/MyTickets";
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
        </Route>
        <Route path="/e/:slug" element={<PublicEvent />} />
        <Route path="/my-tickets" element={<MyTickets />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
