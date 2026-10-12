import { useEffect, useState } from "react";
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

// Public congress metadata is read anonymously and shared by the shell and its pages.
const eventRequests = new Map<string, Promise<CongressEventState>>();

function loadCongressEvent(slug: string): Promise<CongressEventState> {
  let request = eventRequests.get(slug);
  if (!request) {
    request = createApiClient({ kind: "anonymous" })
      .GET("/api/public/events/{slug}", { params: { path: { slug } } })
      .then(({ data, response }): CongressEventState =>
        data ? { status: "ready", event: data } : response.status === 404 ? { status: "missing" } : { status: "error" }
      )
      .catch((): CongressEventState => ({ status: "error" }));
    // Failures are not cached, so a later visit retries.
    request.then((state) => {
      if (state.status === "error") eventRequests.delete(slug);
    });
    eventRequests.set(slug, request);
  }
  return request;
}

/** Active congress from the route. A result for an earlier slug never replaces the current one. */
export function useCongressEvent(slug: string | undefined): CongressEventState {
  const [state, setState] = useState<{ slug?: string; value: CongressEventState }>({ value: { status: "loading" } });
  useEffect(() => {
    if (!slug) return;
    let active = true;
    loadCongressEvent(slug).then((value) => {
      if (active) setState({ slug, value });
    });
    return () => {
      active = false;
    };
  }, [slug]);
  return state.slug === slug ? state.value : { status: "loading" };
}
