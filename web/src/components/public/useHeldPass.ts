import { useEffect, useState } from "react";
import { createApiClient } from "../../api/client";
import { isStoredAttendeeToken } from "../../lib/attendeeSession";
import { loadOwnerScopedTickets } from "../../lib/ticketCache";

/**
 * Whether the signed-in attendee already holds a pass for this congress, read from their own tickets
 * (`GET /api/attendees/me/tickets`, filtered by slug). Offline, the owner-scoped pass cache answers.
 * Signed out, or until the answer arrives, it is false: the page then offers the reservation, and a
 * duplicate is still refused by the API (`ALREADY_REGISTERED`).
 */
export function useHeldPass(slug: string | undefined, token: string | null): boolean {
  const [answer, setAnswer] = useState<{ key: string; held: boolean } | null>(null);
  const key = slug && token ? `${token}\u0000${slug}` : null;

  useEffect(() => {
    if (!slug || !token || !key) return;
    let active = true;
    const fromCache = () => {
      const cache = loadOwnerScopedTickets(token);
      return cache.status === "valid" && cache.tickets.some((ticket) => ticket.event_slug === slug);
    };
    createApiClient({ kind: "user", token })
      .GET("/api/attendees/me/tickets")
      .then(({ data }) => {
        // A 401 has already removed the token (the API client applies the session policy), so the page
        // re-renders signed out and this answer is dropped with the rest of a changed session's.
        if (!active || !isStoredAttendeeToken(token)) return;
        setAnswer({ key, held: data ? data.some((ticket) => ticket.event_slug === slug) : fromCache() });
      })
      .catch(() => {
        if (active && isStoredAttendeeToken(token)) setAnswer({ key, held: fromCache() });
      });
    return () => {
      active = false;
    };
  }, [slug, token, key]);

  return answer !== null && answer.key === key && answer.held;
}
