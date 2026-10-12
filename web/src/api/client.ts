import createClient from "openapi-fetch";
import type { components, paths } from "./schema";

export type EventOut = components["schemas"]["EventOut"];
export type EventCreate = components["schemas"]["EventCreate"];
export type EventUpdate = components["schemas"]["EventUpdate"];
export type TicketTierOut = components["schemas"]["TicketTierOut"];
export type TicketTierCreate = components["schemas"]["TicketTierCreate"];
export type TicketTierUpdate = components["schemas"]["TicketTierUpdate"];
export type PublicEvent = components["schemas"]["PublicEvent"];
export type AttendeeTicketDetail = components["schemas"]["AttendeeTicketDetail"];
export type TicketOut = components["schemas"]["TicketOut"];
export type AuthResponse = components["schemas"]["AuthResponse"];
export type UserOut = components["schemas"]["UserOut"];
export type UserRegister = components["schemas"]["UserRegister"];
export type UserLogin = components["schemas"]["UserLogin"];
export type CheckInPointOut = components["schemas"]["CheckInPointOut"];
export type CheckInPointCreate = components["schemas"]["CheckInPointCreate"];
export type CheckInPointUpdate = components["schemas"]["CheckInPointUpdate"];
export type CheckInManifest = components["schemas"]["CheckInManifest"];
export type BatchScanResponse = components["schemas"]["BatchScanResponse"];
export type DeskRegistrationCreate = components["schemas"]["DeskRegistrationCreate"];
export type DeskRegistrationOut = components["schemas"]["DeskRegistrationOut"];
export type DeskOperatorOut = components["schemas"]["DeskOperatorOut"];
export type DeskOperatorCreate = components["schemas"]["DeskOperatorCreate"];
export type DeskOperatorCreated = components["schemas"]["DeskOperatorCreated"];
export type DeskLoginRequest = components["schemas"]["DeskLoginRequest"];
export type DeskLoginResponse = components["schemas"]["DeskLoginResponse"];
export type DeskMeOut = components["schemas"]["DeskMeOut"];
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
export type PrivacyPreferenceOut = components["schemas"]["PrivacyPreferenceOut"];
export type PrivacyPreferenceUpdate = components["schemas"]["PrivacyPreferenceUpdate"];
export const ORGANIZER_KEY_STORAGE = "congress_organizer_api_key";
export const ATTENDEE_TOKEN_STORAGE = "congress_attendee_token";

export type AuthScope = "organizer" | "attendee" | "any";

export function getApiClient(token?: string | null, scope: AuthScope = "any") {
  let authToken = token;
  if (!authToken && typeof window !== "undefined") {
    if (scope === "organizer") {
      authToken = sessionStorage.getItem(ORGANIZER_KEY_STORAGE);
    } else if (scope === "attendee") {
      authToken = localStorage.getItem(ATTENDEE_TOKEN_STORAGE);
    } else {
      // Contextual fallback: prioritize organizer key only when on organizer routes;
      // on attendee and public routes, prioritize attendee token so organizer keys
      // never accidentally override attendee JWTs.
      const isOrganizerRoute = window.location.pathname.startsWith("/organizer");
      if (isOrganizerRoute) {
        authToken =
          sessionStorage.getItem(ORGANIZER_KEY_STORAGE) ||
          localStorage.getItem(ATTENDEE_TOKEN_STORAGE);
      } else {
        authToken =
          localStorage.getItem(ATTENDEE_TOKEN_STORAGE) ||
          sessionStorage.getItem(ORGANIZER_KEY_STORAGE);
      }
    }
  }
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
