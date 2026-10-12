import React, { useState, useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { SkipLink } from "../components/ui/SkipLink";
import { LinkButton } from "../components/ui/Button";
import { signInPath } from "../lib/safeRedirect";

interface PublicLayoutProps {
  children?: React.ReactNode;
}

export function PublicLayout({ children }: PublicLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  // Event pages (/e/:slug…) sign in straight back to that congress's portal.
  const eventSlug = /^\/e\/([A-Za-z0-9_-]+)/.exec(location.pathname)?.[1];
  const signInTarget = eventSlug ? signInPath(eventSlug, `/c/${eventSlug}/my-congress`) : "/sign-in";
  const [prevPath, setPrevPath] = useState(location.pathname);
  if (prevPath !== location.pathname) {
    setPrevPath(location.pathname);
    setMobileMenuOpen(false);
  }
  // Handle escape key to close mobile menu
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && mobileMenuOpen) {
        setMobileMenuOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileMenuOpen]);

  return (
    <div className="min-h-screen bg-surface-page text-text-primary flex flex-col font-sans selection:bg-action-subtle selection:text-action-primary">
      <SkipLink targetId="main-content" />

      {/* Header */}
      <header className="sticky top-0 z-40 bg-surface-panel/95 backdrop-blur-xs border-b border-border-default">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Brand */}
          <Link
            to="/"
            className="flex items-center gap-2.5 group rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            aria-label="Congress Platform Home"
          >
            <span className="w-8 h-8 rounded-lg bg-action-primary text-text-inverse flex items-center justify-center font-bold text-base shadow-xs group-hover:bg-action-hover transition-colors">
              <svg
                className="w-4 h-4 text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
                <path d="M6 6h10" />
                <path d="M6 10h10" />
              </svg>
            </span>
            <div className="flex flex-col">
              <span className="font-bold text-base tracking-tight text-text-primary leading-tight">
                Congress Platform
              </span>
              <span className="text-[11px] text-text-muted font-normal leading-none hidden sm:inline">
                Independent Event Operations
              </span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav aria-label="Main Navigation" className="hidden md:flex items-center gap-1 lg:gap-2">
            <a
              href="#capabilities"
              className="text-xs lg:text-sm font-medium text-text-secondary hover:text-text-primary px-3 py-2 rounded-md hover:bg-surface-panel-subtle transition-colors focus-visible:outline-2 focus-visible:outline-focus-ring"
            >
              Capabilities
            </a>
            <a
              href="#roles"
              className="text-xs lg:text-sm font-medium text-text-secondary hover:text-text-primary px-3 py-2 rounded-md hover:bg-surface-panel-subtle transition-colors focus-visible:outline-2 focus-visible:outline-focus-ring"
            >
              Role Entry
            </a>
            <a
              href="#architecture"
              className="text-xs lg:text-sm font-medium text-text-secondary hover:text-text-primary px-3 py-2 rounded-md hover:bg-surface-panel-subtle transition-colors focus-visible:outline-2 focus-visible:outline-focus-ring"
            >
              Architecture
            </a>
            <div className="h-4 w-px bg-border-default mx-1" aria-hidden="true" />
            <Link
              to="/my-tickets"
              className="text-xs lg:text-sm font-medium text-text-secondary hover:text-text-primary px-3 py-2 rounded-md hover:bg-surface-panel-subtle transition-colors focus-visible:outline-2 focus-visible:outline-focus-ring"
            >
              My Tickets
            </Link>
            <Link
              to="/my-network"
              className="text-xs lg:text-sm font-medium text-text-secondary hover:text-text-primary px-3 py-2 rounded-md hover:bg-surface-panel-subtle transition-colors focus-visible:outline-2 focus-visible:outline-focus-ring"
            >
              My Network
            </Link>
          </nav>

          {/* Header Action */}
          <div className="flex items-center gap-2">
            <LinkButton to={signInTarget} variant="outline" size="sm">
              Attendee Sign In
            </LinkButton>
            <LinkButton
              to="/organizer"
              variant="primary"
              size="sm"
              className="hidden sm:inline-flex"
            >
              Organizer Console
              <span aria-hidden="true">→</span>
            </LinkButton>

            {/* Mobile menu trigger */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden inline-flex items-center justify-center p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-panel-subtle focus-visible:outline-2 focus-visible:outline-focus-ring cursor-pointer"
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-nav"
              aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="2"
                stroke="currentColor"
                aria-hidden="true"
              >
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile menu panel */}
        {mobileMenuOpen && (
          <nav
            id="mobile-nav"
            aria-label="Mobile Navigation"
            className="md:hidden border-t border-border-default bg-surface-panel px-4 pt-3 pb-6 space-y-2 shadow-sm animate-in fade-in duration-150"
          >
            <a
              href="#capabilities"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-sm font-medium text-text-secondary hover:text-text-primary px-3 py-2 rounded-md hover:bg-surface-panel-subtle"
            >
              Platform Capabilities
            </a>
            <a
              href="#roles"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-sm font-medium text-text-secondary hover:text-text-primary px-3 py-2 rounded-md hover:bg-surface-panel-subtle"
            >
              Role Entry Points
            </a>
            <a
              href="#architecture"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-sm font-medium text-text-secondary hover:text-text-primary px-3 py-2 rounded-md hover:bg-surface-panel-subtle"
            >
              Architecture & Invariants
            </a>
            <div className="h-px bg-border-subtle my-2" aria-hidden="true" />
            <Link
              to="/my-tickets"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-sm font-medium text-text-secondary hover:text-text-primary px-3 py-2 rounded-md hover:bg-surface-panel-subtle"
            >
              My Tickets & Passes
            </Link>
            <Link
              to="/my-network"
              onClick={() => setMobileMenuOpen(false)}
              className="block text-sm font-medium text-text-secondary hover:text-text-primary px-3 py-2 rounded-md hover:bg-surface-panel-subtle"
            >
              My Network
            </Link>
            <div className="pt-2">
              <LinkButton
                to="/organizer"
                variant="primary"
                size="md"
                isFullWidth
                onClick={() => setMobileMenuOpen(false)}
              >
                Organizer Console →
              </LinkButton>
            </div>
          </nav>
        )}
      </header>

      {/* Main Content Area */}
      <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
        {children ?? <Outlet />}
      </main>

      {/* Footer */}
      <footer className="border-t border-border-default bg-surface-panel text-text-secondary">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-10">
            {/* Col 1: Platform Overview */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-md bg-action-primary text-text-inverse flex items-center justify-center font-bold text-xs">
                  C
                </span>
                <span className="font-bold text-sm tracking-tight text-text-primary">
                  Congress Platform
                </span>
              </div>
              <p className="text-xs text-text-muted leading-relaxed">
                Independent, multi-tenant congress management system for academic congresses, corporate symposiums, and industrial trade exhibitions.
              </p>
              <div className="text-[11px] text-text-muted pt-2 border-t border-border-subtle">
                <span className="font-medium text-text-secondary">Stack:</span> FastAPI 3.11+, PostgreSQL 16, React 19, TypeScript, Tailwind 4.
              </div>
            </div>

            {/* Col 2: Role Portals */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wider">
                User Portals
              </h4>
              <ul className="space-y-2 text-xs">
                <li>
                  <Link
                    to="/organizer"
                    className="hover:text-action-primary transition-colors focus-visible:outline-focus-ring"
                  >
                    Organizer Console
                  </Link>
                </li>
                <li>
                  <Link
                    to="/my-tickets"
                    className="hover:text-action-primary transition-colors focus-visible:outline-focus-ring"
                  >
                    Attendee Pass Portal
                  </Link>
                </li>
                <li>
                  <Link
                    to="/my-network"
                    className="hover:text-action-primary transition-colors focus-visible:outline-focus-ring"
                  >
                    Attendee Networking Hub
                  </Link>
                </li>
              </ul>
              <p className="text-[11px] text-text-muted leading-normal pt-1">
                Exhibitors access leads via dedicated booth links (<code className="text-[10px] bg-surface-panel-subtle px-1 py-0.5 rounded border border-border-subtle">/booth/:id</code>).
              </p>
            </div>

            {/* Col 3: On-Site Stations */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wider">
                On-Site Stations
              </h4>
              <ul className="space-y-2 text-xs text-text-secondary">
                <li>
                  <span className="font-medium text-text-primary">Gate Scanner PWA:</span> Camera & USB HID barcode gun reader with local offline buffer.
                </li>
                <li>
                  <span className="font-medium text-text-primary">Front-Desk Station:</span> Rapid walk-in registration, badge minting, and live search.
                </li>
                <li>
                  <span className="font-medium text-text-primary">Real-Time Analytics:</span> Live attendance throughput, catering counts, and CSV exports.
                </li>
              </ul>
            </div>

            {/* Col 4: Event Links & Trust Policy */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wider">
                Event Registration
              </h4>
              <p className="text-xs text-text-muted leading-relaxed">
                Registration is private to each congress. Attendees access free ticket registration via the direct link provided by organizers:
              </p>
              <div className="p-2.5 rounded-lg bg-surface-panel-subtle border border-border-subtle text-[11px] font-mono text-text-secondary break-all">
                /e/:event-slug
              </div>
              <p className="text-[11px] text-text-muted">
                No public event discovery directory is exposed; privacy and isolation are enforced by design.
              </p>
            </div>
          </div>

          <div className="mt-12 pt-6 border-t border-border-subtle flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-text-muted">
            <p>
              © Congress Management Platform. Built for high-reliability event operations.
            </p>
            <div className="flex items-center gap-4">
              <span>ACID Storage</span>
              <span className="w-1 h-1 rounded-full bg-border-strong" aria-hidden="true" />
              <span>Offline Sync Buffer</span>
              <span className="w-1 h-1 rounded-full bg-border-strong" aria-hidden="true" />
              <span>Competitor Isolation</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
