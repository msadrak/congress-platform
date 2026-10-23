import { useOutletContext } from "react-router-dom";
import type { PlatformStatusOut, createApiClient } from "../api/client";

export type PlatformClient = ReturnType<typeof createApiClient>;

/** What the platform console layout hands to its sections. */
export interface PlatformOutletContext {
  client: PlatformClient;
  status: PlatformStatusOut;
  refreshStatus: () => Promise<void>;
  /** Call with the HTTP status of every console request: 401 signs the console out. */
  checkResponse: (status: number) => void;
  locale: "fa" | "en";
  isRtl: boolean;
}

/** An inline text action in the console ("Use the .env value", "Remove the key saved here"): a 44 px tap target. */
export const ENV_BUTTON =
  "inline-flex min-h-11 items-center rounded-lg px-1 font-semibold text-action-primary hover:underline cursor-pointer disabled:cursor-wait disabled:opacity-60";

export function usePlatform(): PlatformOutletContext {
  return useOutletContext<PlatformOutletContext>();
}
