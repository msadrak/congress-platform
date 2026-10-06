import createClient from "openapi-fetch";
import type { components, paths } from "./schema";

export type EventOut = components["schemas"]["EventOut"];
export type EventCreate = components["schemas"]["EventCreate"];
export type TicketTierOut = components["schemas"]["TicketTierOut"];
export type TicketTierCreate = components["schemas"]["TicketTierCreate"];
export type PublicEvent = components["schemas"]["PublicEvent"];

export const ORGANIZER_KEY_STORAGE = "congress_organizer_api_key";

export function getApiClient(apiKey?: string | null) {
  const key = apiKey ?? (typeof window !== "undefined" ? sessionStorage.getItem(ORGANIZER_KEY_STORAGE) : null);
  return createClient<paths>({
    baseUrl: "",
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });
}

export function formatApiError(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const e = err as { detail?: unknown; message?: string };
    if (typeof e.detail === "string") return e.detail;
    if (Array.isArray(e.detail)) {
      return e.detail
        .map((d: { loc?: (string | number)[]; msg?: string }) => {
          const field = d.loc?.slice(-1)[0] ?? "field";
          return `${field}: ${d.msg ?? "invalid"}`;
        })
        .join("; ");
    }
    if (e.message) return e.message;
  }
  return "An unexpected error occurred.";
}
