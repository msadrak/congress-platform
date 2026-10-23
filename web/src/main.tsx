import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import "@fontsource-variable/vazirmatn/wght.css";
import "@fontsource-variable/schibsted-grotesk/wght.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./index.css";
// Register PWA service worker (side-effect import — must remain top-level)
import "./lib/pwaRegistration";
import App from "./App";

// A data router (one splat route rendering App's <Routes>) so a page can hold back in-app navigation with
// `useBlocker`, e.g. Page Studio with unsaved changes. The routes themselves stay declared in App.tsx.
const router = createBrowserRouter([{ path: "*", element: <App /> }]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
