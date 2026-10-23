import createClient from "openapi-fetch";
import type { components, paths } from "./schema";
import type { AttendeeLocale } from "../lib/i18n";
import { errorMessages } from "../lib/errorMessages.ts";

export type ErrorResponse = components["schemas"]["ErrorResponse"];
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
export type OtpRequestOut = components["schemas"]["OtpRequestOut"];
export type OtpVerifyOut = components["schemas"]["OtpVerifyOut"];
export type SmsPanelOut = components["schemas"]["SmsPanelOut"];
export type SmsTemplateOut = components["schemas"]["SmsTemplateOut"];
export type SmsMessageOut = components["schemas"]["SmsMessageOut"];
export type SmsTestOut = components["schemas"]["SmsTestOut"];
export type PlatformStatusOut = components["schemas"]["PlatformStatusOut"];
export type SmsSettingsOut = components["schemas"]["SmsSettingsOut"];
export type SmsCheckOut = components["schemas"]["SmsCheckOut"];
export type SignInOut = components["schemas"]["SignInOut"];
export type OrganizerOut = components["schemas"]["OrganizerOut"];
export type OrganizerProvisioned = components["schemas"]["OrganizerProvisioned"];
export type CheckInPointOut = components["schemas"]["CheckInPointOut"];
export type CheckInPointCreate = components["schemas"]["CheckInPointCreate"];
export type CheckInPointUpdate = components["schemas"]["CheckInPointUpdate"];
export type CheckInManifest = components["schemas"]["CheckInManifest"];
export type ScannerDeviceOut = components["schemas"]["ScannerDeviceOut"];
export type ScannerTokenOut = components["schemas"]["ScannerTokenOut"];
export type BatchScanResponse = components["schemas"]["BatchScanResponse"];
export type DeskRegistrationCreate = components["schemas"]["DeskRegistrationCreate"];
export type DeskRegistrationOut = components["schemas"]["DeskRegistrationOut"];
export type DeskOperatorOut = components["schemas"]["DeskOperatorOut"];
export type DeskOperatorCreate = components["schemas"]["DeskOperatorCreate"];
export type DeskLoginRequest = components["schemas"]["DeskLoginRequest"];
export type DeskLoginResponse = components["schemas"]["DeskLoginResponse"];
export type DeskMeOut = components["schemas"]["DeskMeOut"];
export type AttendeeSearchItem = components["schemas"]["AttendeeSearchItem"];
export type AttendeeDetailCard = components["schemas"]["AttendeeDetailCard"];
export type PassSmsResendOut = components["schemas"]["PassSmsResendOut"];
export type AttendanceAnalyticsResponse = components["schemas"]["AttendanceAnalyticsResponse"];
export type GateMetric = components["schemas"]["GateMetric"];
export type CateringMetric = components["schemas"]["CateringMetric"];
export type HourlyScanCount = components["schemas"]["HourlyScanCount"];
export type BoothOut = components["schemas"]["BoothOut"];
export type BoothCreate = components["schemas"]["BoothCreate"];
export type BoothUpdate = components["schemas"]["BoothUpdate"];
export type BoothStaffAssign = components["schemas"]["BoothStaffAssign"];
export type BoothStaffOut = components["schemas"]["BoothStaffOut"];
export type ConnectionOut = components["schemas"]["ConnectionOut"];
export type ConnectionScanRequest = components["schemas"]["ConnectionScanRequest"];
export type ConnectionUpdate = components["schemas"]["ConnectionUpdate"];
export type PublicBoothOut = components["schemas"]["PublicBoothOut"];
export type PublicBoothSummary = components["schemas"]["PublicBoothSummary"];
export type BookmarkToggleOut = components["schemas"]["BookmarkToggleOut"];
export type BookmarkedBoothOut = components["schemas"]["BookmarkedBoothOut"];
export type LeadOut = components["schemas"]["LeadOut"];
export type LeadScanRequest = components["schemas"]["LeadScanRequest"];
/** The API only requires `qr_secret`; openapi-typescript marks defaulted fields as required. */
export type LeadScanInput = Pick<LeadScanRequest, "qr_secret"> & Partial<Omit<LeadScanRequest, "qr_secret">>;
export type LeadUpdate = components["schemas"]["LeadUpdate"];
export type PrivacyPreferenceOut = components["schemas"]["PrivacyPreferenceOut"];
export type PrivacyPreferenceUpdate = components["schemas"]["PrivacyPreferenceUpdate"];
export type AccessOut = components["schemas"]["AccessOut"];
export type AccessEvent = components["schemas"]["AccessEvent"];
export type PageStateOut = components["schemas"]["PageStateOut"];
export type PagePreview = components["schemas"]["PagePreview"];
export type MediaAssetOut = components["schemas"]["MediaAssetOut"];
export type VenuePlaceOut = components["schemas"]["VenuePlaceOut"];
export type VenuePlaceKind = VenuePlaceOut["kind"];
export type VenuePlaceCreate = components["schemas"]["VenuePlaceCreate"];
export type VenuePlaceUpdate = components["schemas"]["VenuePlaceUpdate"];
export type EventSessionOut = components["schemas"]["EventSessionOut"];
export type EventSessionCreate = components["schemas"]["EventSessionCreate"];
export type EventSessionUpdate = components["schemas"]["EventSessionUpdate"];
export type EventSessionImport = components["schemas"]["EventSessionImport"];
export type EventSessionImportRow = components["schemas"]["EventSessionImportRow"];
export type EventSessionImportOut = components["schemas"]["EventSessionImportOut"];
export type PublicVenuePlace = components["schemas"]["PublicVenuePlace"];
export type PublicSession = components["schemas"]["PublicSession"];
export const ORGANIZER_KEY_STORAGE = "congress_organizer_api_key";
export const ATTENDEE_TOKEN_STORAGE = "congress_attendee_token";
/** Tab-scoped (sessionStorage): the most powerful credential is never kept across browser sessions. */
export const PLATFORM_TOKEN_STORAGE = "congress_platform_admin_token";

/** Descriptive request context, never proof of server permission. */
export type ApiAuthority =
  | { readonly kind: "anonymous" }
  | { readonly kind: "user"; readonly token: string }
  | { readonly kind: "organizer"; readonly token: string }
  | { readonly kind: "desk"; readonly token: string; readonly eventId: string }
  | { readonly kind: "scanner"; readonly token: string; readonly pointId: string; readonly eventId?: string }
  /** Platform administration: the admin token travels as X-Admin-Token, never as a Bearer credential. */
  | { readonly kind: "platform"; readonly token: string };

export interface ApiClientOptions {
  readonly baseUrl?: string;
  readonly fetch?: (request: Request) => Promise<Response>;
}

export class ApiContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiContextError";
  }
}

function requireContext(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiContextError(`Missing ${label}`);
  }
}

/**
 * Pure credential selection. Null is explicitly anonymous; omission is invalid.
 * Session owners acquire credentials and handle exact-credential invalidation.
 */
export function createApiClient(authority: ApiAuthority | null, options: ApiClientOptions = {}) {
  if (authority === undefined) throw new ApiContextError("Missing authority");
  const context = authority === null ? { kind: "anonymous" as const } : { ...authority };
  switch (context.kind) {
    case "anonymous":
      break;
    case "user":
    case "organizer":
    case "platform":
      requireContext(context.token, "credential");
      break;
    case "desk":
      requireContext(context.token, "credential");
      requireContext(context.eventId, "event context");
      break;
    case "scanner":
      requireContext(context.token, "credential");
      if (context.eventId !== undefined) requireContext(context.eventId, "event context");
      requireContext(context.pointId, "check-in point context");
      break;
    default:
      throw new ApiContextError("Unknown authority");
  }
  const client = createClient<paths>({ baseUrl: options.baseUrl ?? "", fetch: options.fetch });
  client.use({
    onRequest({ request, params }) {
      if (context.kind === "desk" && params.path?.event_id !== context.eventId) {
        throw new ApiContextError("Desk event context mismatch");
      }
      if (context.kind === "scanner" && (
        params.path?.point_id !== context.pointId ||
        (params.path?.event_id !== undefined && params.path.event_id !== context.eventId)
      )) {
        throw new ApiContextError("Scanner resource context mismatch");
      }
      // Override caller headers too: authority is selected once, not per header.
      request.headers.delete("X-Admin-Token");
      if (context.kind === "anonymous") request.headers.delete("Authorization");
      else if (context.kind === "platform") {
        request.headers.delete("Authorization");
        request.headers.set("X-Admin-Token", context.token);
      } else request.headers.set("Authorization", `Bearer ${context.token}`);
    },
  });
  return client;
}

/** Operator mode or deliberately selected Organizer operational mode; no fallback. */
export function createDeskApiClient(
  authority: Extract<ApiAuthority, { kind: "desk" | "organizer" }>,
  eventId: string,
  options: ApiClientOptions = {},
) {
  requireContext(eventId, "event context");
  if (!authority || (authority.kind !== "desk" && authority.kind !== "organizer")) {
    throw new ApiContextError("Missing desk or Organizer authority");
  }
  if (authority.kind === "desk" && authority.eventId !== eventId) {
    throw new ApiContextError("Desk event context mismatch");
  }
  const client = createApiClient(authority, options);
  client.use({
    onRequest({ params }) {
      if (params.path?.event_id !== eventId) throw new ApiContextError("Desk event context mismatch");
    },
  });
  return client;
}

/**
 * Scanner endpoint URLs carry only a point. The event is optional descriptive context (a device
 * token is opaque to the browser); when supplied it must be non-blank and consistent.
 */
export function createScannerApiClient(
  authority: Extract<ApiAuthority, { kind: "scanner" | "organizer" }>,
  scope: { readonly eventId?: string; readonly pointId: string },
  options: ApiClientOptions = {},
) {
  if (!scope) throw new ApiContextError("Missing scanner resource context");
  const { eventId, pointId } = scope;
  if (eventId !== undefined) requireContext(eventId, "event context");
  requireContext(pointId, "check-in point context");
  if (!authority || (authority.kind !== "scanner" && authority.kind !== "organizer")) {
    throw new ApiContextError("Missing scanner or Organizer authority");
  }
  if (authority.kind === "scanner" && (authority.eventId !== eventId || authority.pointId !== pointId)) {
    throw new ApiContextError("Scanner resource context mismatch");
  }
  const client = createApiClient(authority, options);
  client.use({
    onRequest({ params }) {
      if (params.path?.point_id !== pointId ||
        (params.path?.event_id !== undefined && params.path.event_id !== eventId)) {
        throw new ApiContextError("Scanner resource context mismatch");
      }
    },
  });
  return client;
}

/** HTTP failures retain the server status/body; network failures remain native errors. */
export class ApiResponseError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(formatApiError(body));
    this.name = "ApiResponseError";
    this.status = status;
    this.body = body;
  }
}

export function unwrapApiResponse<T>(result: { data?: T; error?: unknown; response: Response }): T | undefined {
  if (!result.response.ok) throw new ApiResponseError(result.response.status, result.error);
  return result.data;
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

/** The stable error code of an error body or ApiResponseError (backend/app/errors.py), if it has one. */
export function apiErrorCode(error: unknown): string | undefined {
  const body = error instanceof ApiResponseError ? error.body : error;
  if (typeof body !== "object" || body === null || !("code" in body)) return undefined;
  return typeof body.code === "string" && body.code.length > 0 ? body.code : undefined;
}

/** The error in the reader's language when its code is known; otherwise the existing `formatApiError` text. */
export function localizedApiError(error: unknown, locale: AttendeeLocale): string {
  const code = apiErrorCode(error);
  const messages = errorMessages[locale];
  if (code !== undefined && Object.hasOwn(messages, code)) return messages[code];
  return formatApiError(error instanceof ApiResponseError ? error.body : error);
}
