import createClient from "openapi-fetch";
import type { components, paths } from "./schema";

export type EventOut = components["schemas"]["EventOut"];
export type EventCreate = components["schemas"]["EventCreate"];
export type TicketTierOut = components["schemas"]["TicketTierOut"];
export type TicketTierCreate = components["schemas"]["TicketTierCreate"];
export type PublicEvent = components["schemas"]["PublicEvent"];
export type AttendeeTicketDetail = components["schemas"]["AttendeeTicketDetail"];
export type TicketOut = components["schemas"]["TicketOut"];
export type AuthResponse = components["schemas"]["AuthResponse"];
export type UserOut = components["schemas"]["UserOut"];
export type UserRegister = components["schemas"]["UserRegister"];
export type UserLogin = components["schemas"]["UserLogin"];
export type CheckInPointOut = components["schemas"]["CheckInPointOut"];
export type CheckInPointCreate = components["schemas"]["CheckInPointCreate"];
export type CheckInManifest = components["schemas"]["CheckInManifest"];
export type BatchScanResponse = components["schemas"]["BatchScanResponse"];
export type DeskRegistrationCreate = components["schemas"]["DeskRegistrationCreate"];
export type DeskRegistrationOut = components["schemas"]["DeskRegistrationOut"];
export type AttendeeSearchItem = components["schemas"]["AttendeeSearchItem"];
export type AttendeeDetailCard = components["schemas"]["AttendeeDetailCard"];
export type AttendanceAnalyticsResponse = components["schemas"]["AttendanceAnalyticsResponse"];
export type GateMetric = components["schemas"]["GateMetric"];
export type CateringMetric = components["schemas"]["CateringMetric"];
export type HourlyScanCount = components["schemas"]["HourlyScanCount"];
export type BoothOut = components["schemas"]["BoothOut"];
export type BoothCreate = components["schemas"]["BoothCreate"];
export type BoothStaffAssign = components["schemas"]["BoothStaffAssign"];
export type BoothStaffOut = components["schemas"]["BoothStaffOut"];
export type ConnectionOut = components["schemas"]["ConnectionOut"];
export type ConnectionScanRequest = components["schemas"]["ConnectionScanRequest"];
export type ConnectionUpdate = components["schemas"]["ConnectionUpdate"];
export type PublicBoothOut = components["schemas"]["PublicBoothOut"];
export type BookmarkToggleOut = components["schemas"]["BookmarkToggleOut"];
export type BookmarkedBoothOut = components["schemas"]["BookmarkedBoothOut"];
export type LeadOut = components["schemas"]["LeadOut"];
export type LeadScanRequest = components["schemas"]["LeadScanRequest"];
export type LeadUpdate = components["schemas"]["LeadUpdate"];

export const ORGANIZER_KEY_STORAGE = "congress_organizer_api_key";
export const ATTENDEE_TOKEN_STORAGE = "congress_attendee_token";

export function getApiClient(token?: string | null) {
  const authToken =
    token ??
    (typeof window !== "undefined"
      ? sessionStorage.getItem(ORGANIZER_KEY_STORAGE) ||
        localStorage.getItem(ATTENDEE_TOKEN_STORAGE)
      : null);
  return createClient<paths>({
    baseUrl: "",
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
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
