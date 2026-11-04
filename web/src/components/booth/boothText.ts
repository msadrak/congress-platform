import { NETWORK_FAILURE_CODE, apiErrorCode } from "../../api/client";
import { boothCopy } from "../../copy/booth";
import { errorMessages, networkErrorMessage } from "../../lib/errorMessages";
import type { AttendeeLocale } from "../../lib/i18n";
import type { QueueFailure } from "../../lib/leadQueue";

/**
 * The reader's-language message of an API error with a known stable code (`errorMessages`), or null. Booth screens
 * show their own localized sentence instead of null, so the server's English `detail` never reaches a reader.
 */
export function codedMessage(error: unknown, locale: AttendeeLocale): string | null {
  const code = apiErrorCode(error);
  if (code === NETWORK_FAILURE_CODE) return networkErrorMessage[locale];
  // The shared wording of these two is written for organizers; exhibitors read their own.
  if (code === "EVENT_ARCHIVED") return boothCopy[locale].archivedError;
  if (code === "BOOTH_ACCESS_SUSPENDED") return boothCopy[locale].suspendedError;
  return code !== undefined && Object.hasOwn(errorMessages[locale], code) ? errorMessages[locale][code] : null;
}

/** A queued scan's refusal in the reader's language: coded API errors through the shared map, the scan's own 404/400 here. */
export function queueFailureText(failure: QueueFailure, locale: AttendeeLocale): string {
  const text = boothCopy[locale];
  if (failure.kind === "invalid_badge") return text.failInvalidBadge;
  if (failure.kind === "other_event") return text.failOtherEvent;
  if (failure.kind === "event_archived") return text.failEventArchived;
  // Only a code with a localized message is shown as such; the English `detail` never reaches the reader.
  if (failure.code && Object.hasOwn(errorMessages[locale], failure.code)) return errorMessages[locale][failure.code];
  return text.failRefused;
}
