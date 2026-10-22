import { useCallback, useEffect, useSyncExternalStore } from "react";
import { createApiClient, type PublicEvent } from "../api/client";

/** The five approved Attendee Portal destinations, in navigation order. No other route is accepted. */
export const ATTENDEE_DESTINATIONS = ["my-congress", "my-network", "my-ticket", "my-profile", "details"] as const;
export type AttendeeDestination = (typeof ATTENDEE_DESTINATIONS)[number];

export function congressPath(slug: string, destination: AttendeeDestination): string {
  return `/c/${encodeURIComponent(slug)}/${destination}`;
}

export type CongressEventState =
  | { status: "loading" }
  | { status: "ready"; event: PublicEvent }
  | { status: "missing" }
  | { status: "error" };

/** How often an open panel re-reads its congress while the tab is visible. */
const REVALIDATE_MS = 60_000;
/** Focus and `visibilitychange` usually fire together; one revisit triggers one refresh. */
const REVISIT_COALESCE_MS = 1_000;

const LOADING: CongressEventState = { status: "loading" };
const MISSING: CongressEventState = { status: "missing" };
const FAILED: CongressEventState = { status: "error" };

/**
 * Calls `listener` whenever the tab becomes visible again or the window regains focus: the moments an
 * attendee returns to a panel that may have been edited by the organizer meanwhile.
 */
function watchRevisits(listener: () => void): () => void {
  let last = 0;
  const run = () => {
    if (document.visibilityState !== "visible") return;
    const now = Date.now();
    if (now - last < REVISIT_COALESCE_MS) return;
    last = now;
    listener();
  };
  window.addEventListener("focus", run);
  document.addEventListener("visibilitychange", run);
  return () => {
    window.removeEventListener("focus", run);
    document.removeEventListener("visibilitychange", run);
  };
}

/** Re-runs `refresh` (keep it stable, e.g. `useCallback`) when the attendee returns to the tab. */
export function useRevalidateOnFocus(refresh: () => void): void {
  useEffect(() => watchRevisits(refresh), [refresh]);
}

// ── Public congress metadata: stale-while-revalidate, shared by the shell and its pages ──────────────
// Each slug has one entry. Every subscriber of a slug renders the same snapshot, so the header, the page
// and any other reader update together. Snapshots are keyed by slug: a response for an earlier congress
// can only ever update that congress's entry, never the one now on screen.

interface Entry {
  state: CongressEventState;
  /** The last ready payload, serialized: an unchanged refetch keeps the same object (no re-render). */
  body: string | null;
  inflight: boolean;
  listeners: Set<() => void>;
}

const entries = new Map<string, Entry>();

function entryFor(slug: string): Entry {
  let entry = entries.get(slug);
  if (!entry) {
    entry = { state: LOADING, body: null, inflight: false, listeners: new Set() };
    entries.set(slug, entry);
  }
  return entry;
}

function publish(entry: Entry, state: CongressEventState) {
  if (entry.state === state) return;
  entry.state = state;
  for (const listener of entry.listeners) listener();
}

/** Refetches one congress; concurrent calls share the request in flight. */
function revalidate(slug: string): void {
  const entry = entryFor(slug);
  if (entry.inflight) return;
  entry.inflight = true;
  // A failure keeps the last known answer on screen; only a first load turns into an error.
  const fail = () => {
    if (entry.state.status === "loading") publish(entry, FAILED);
  };
  createApiClient({ kind: "anonymous" })
    .GET("/api/public/events/{slug}", { params: { path: { slug } } })
    .then(({ data, response }) => {
      if (data) {
        const body = JSON.stringify(data);
        if (body === entry.body && entry.state.status === "ready") return;
        entry.body = body;
        publish(entry, { status: "ready", event: data });
      } else if (response.status === 404) {
        // Unpublished or removed: an authoritative answer, not a failure.
        entry.body = null;
        publish(entry, MISSING);
      } else {
        fail();
      }
    })
    .catch(fail)
    .finally(() => {
      entry.inflight = false;
    });
}

let watchers = 0;
let stopWatching: (() => void) | null = null;

function revalidateWatched() {
  if (document.visibilityState !== "visible") return;
  for (const [slug, entry] of entries) if (entry.listeners.size > 0) revalidate(slug);
}

function subscribeTo(slug: string, listener: () => void): () => void {
  const entry = entryFor(slug);
  entry.listeners.add(listener);
  if (++watchers === 1) {
    const stopRevisits = watchRevisits(revalidateWatched);
    const timer = window.setInterval(revalidateWatched, REVALIDATE_MS);
    stopWatching = () => {
      stopRevisits();
      window.clearInterval(timer);
    };
  }
  return () => {
    entry.listeners.delete(listener);
    if (--watchers === 0) {
      stopWatching?.();
      stopWatching = null;
    }
  };
}

const noSubscription = () => () => undefined;

/**
 * Active congress from the route. The cached copy renders at once and is refreshed on every mount, when
 * the attendee returns to the tab, and every minute while the tab is visible, so organizer edits reach an
 * open panel. A result for an earlier slug never replaces the current one.
 */
export function useCongressEvent(slug: string | undefined): CongressEventState {
  const subscribe = useCallback((listener: () => void) => (slug ? subscribeTo(slug, listener) : () => undefined), [slug]);
  const state = useSyncExternalStore(slug ? subscribe : noSubscription, () => (slug ? (entries.get(slug)?.state ?? LOADING) : LOADING));

  useEffect(() => {
    if (!slug) return;
    const entry = entryFor(slug);
    // A visit after a failed load shows progress again rather than the stale error.
    if (entry.state.status === "error") publish(entry, LOADING);
    revalidate(slug);
  }, [slug]);

  return state;
}
