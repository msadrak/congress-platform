import { useOutletContext } from "react-router-dom";
import type { PlatformStatusOut, createApiClient } from "../api/client";
import { platformCopy, type PlatformCopy } from "../copy/platform";

export type PlatformClient = ReturnType<typeof createApiClient>;

/**
 * What the platform admin layout hands to its sections. The client returns network failures as results
 * (`networkErrors: "result"`) and signs the admin out on any 401 by itself.
 */
export interface PlatformOutletContext {
  client: PlatformClient;
  status: PlatformStatusOut;
  refreshStatus: () => Promise<void>;
  locale: "fa" | "en";
}

export type PlatformSection = "status" | "sms" | "signIn" | "organizers";

/** The SMS settings (`/platform?tab=sms` still leads there). */
export const SMS_TAB = "/platform/sms";

export function platformSection(pathname: string, search: string): PlatformSection {
  const path = pathname.replace(/\/$/, "");
  if (path === "/platform/sign-in") return "signIn";
  if (path === "/platform/organizers") return "organizers";
  if (path === "/platform/sms") return "sms";
  return new URLSearchParams(search).get("tab") === "sms" ? "sms" : "status";
}

/** An inline text action ("Use server config", "Remove the saved key"): a 44 px tap target. */
export const TEXT_ACTION =
  "inline-flex min-h-11 items-center rounded-control px-1 font-semibold text-action-primary hover:underline cursor-pointer disabled:cursor-wait disabled:opacity-60";

export function usePlatform(): PlatformOutletContext & { copy: PlatformCopy } {
  const context = useOutletContext<PlatformOutletContext>();
  return { ...context, copy: platformCopy[context.locale] };
}
