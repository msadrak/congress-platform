import { useCallback, useEffect, useState } from "react";
import { createApiClient } from "../api/client";
import { attendeeResponseState } from "../lib/attendeeSession";
import { hasBoothRole, NO_STAFF_DESTINATIONS, staffDestinations, type StaffDestinations } from "../lib/staffAccess";

export type StaffAccessResult =
  | { status: "ready"; destinations: StaffDestinations }
  /** `error`: the failed response body (worded at render time), or null when there was no response. */
  | { status: "error"; error: unknown }
  /** The session changed or expired while loading: nothing to show for it. */
  | { status: "stale" };

/** One load per session token and page lifetime, shared by `/me` and the panel's congress switcher. */
const loaded: Record<string, Promise<StaffAccessResult>> = {};

async function fetchStaffAccess(token: string): Promise<StaffAccessResult> {
  const client = createApiClient({ kind: "user", token });
  const access = await client.GET("/api/me/access");
  if (attendeeResponseState(token, access.response.status) !== "current") return { status: "stale" };
  // An API without the access route (or a person it does not know) simply has no staff roles.
  if (access.response.status === 404) return { status: "ready", destinations: NO_STAFF_DESTINATIONS };
  if (!access.data) return { status: "error", error: access.error ?? null };
  if (!hasBoothRole(access.data)) return { status: "ready", destinations: staffDestinations(access.data) };
  // Booth names only; without them the booths are still listed (named generically).
  const booths = await client.GET("/api/booths/me").catch(() => null);
  if (booths && attendeeResponseState(token, booths.response.status) !== "current") return { status: "stale" };
  return { status: "ready", destinations: staffDestinations(access.data, booths?.data ?? []) };
}

/** The booths and desks of this session's person; a failed load is forgotten so the next call retries. */
export function loadStaffAccess(token: string): Promise<StaffAccessResult> {
  if (!Object.hasOwn(loaded, token)) {
    loaded[token] = fetchStaffAccess(token)
      .catch((): StaffAccessResult => ({ status: "error", error: null }))
      .then((result) => {
        if (result.status !== "ready") delete loaded[token];
        return result;
      });
  }
  return loaded[token];
}

export type StaffAccessState = { status: "idle" | "loading" } | StaffAccessResult;

/** Staff destinations for the signed-in person (`idle` while signed out); `retry` reloads after a failure. */
export function useStaffAccess(token: string | null): { state: StaffAccessState; retry: () => void } {
  const [state, setState] = useState<StaffAccessState>({ status: token ? "loading" : "idle" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    if (!token) {
      // oxlint-disable-next-line react/set-state-in-effect -- owner isolation: a signed-out page never keeps the previous person's roles.
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading" });
    void loadStaffAccess(token).then((result) => {
      if (active) setState(result);
    });
    return () => {
      active = false;
    };
  }, [token, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}
