import { useSyncExternalStore } from "react";
import { applyAppUpdate, isAppUpdateWaiting, subscribeToAppUpdate } from "../lib/pwaRegistration";

/**
 * Whether a newly deployed version is installed and waiting, and the way to switch to it (which reloads the
 * page). The attendee and public screens offer it through `AppUpdatePrompt`; the operator screens show it in
 * their own status pill and menu, where the operator picks the moment.
 */
export function useAppUpdate(): { waiting: boolean; apply: () => void } {
  const waiting = useSyncExternalStore(subscribeToAppUpdate, isAppUpdateWaiting);
  return { waiting, apply: applyAppUpdate };
}
