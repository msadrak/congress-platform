import { useSyncExternalStore } from "react";
import { serverReachability, type ReachabilitySnapshot } from "../lib/serverReachability";

/**
 * The server's reachability as verified by a real API round trip (see `lib/serverReachability.ts`).
 * Probing runs only while at least one component uses this hook.
 */
export function useServerReachability(): ReachabilitySnapshot {
  return useSyncExternalStore(serverReachability.subscribe, serverReachability.getSnapshot);
}
