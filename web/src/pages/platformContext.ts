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

export function usePlatform(): PlatformOutletContext {
  return useOutletContext<PlatformOutletContext>();
}
