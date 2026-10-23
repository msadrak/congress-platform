/**
 * Organizer participants API (backend/app/routes/participants.py) for one event, on the generated client.
 *
 * HTTP failures throw `ApiResponseError` (status + body, so `localizedApiError` reads the code); a 401 also
 * reaches the organizer session's handler (`registerUnauthorizedHandler`). A failure to reach the server throws
 * the native error.
 */
import {
  ApiResponseError,
  createApiClient,
  unwrapApiResponse,
  type ApiClientOptions,
  type ParticipantCancel,
  type ParticipantTransfer,
  type ParticipantUpdate,
} from "../api/client.ts";
import { participantListQuery, type ParticipantListState } from "./participants.ts";

/** The response body, or `ApiResponseError` for a failed request (or a success without the expected body). */
function required<T>(result: { data?: T; error?: unknown; response: Response }): T {
  const data = unwrapApiResponse(result);
  if (data === undefined) throw new ApiResponseError(result.response.status, result.error);
  return data;
}

/** Calls for one event with the organizer key. */
export function createParticipantsApi(token: string, eventId: string, options: Pick<ApiClientOptions, "baseUrl" | "fetch"> = {}) {
  const client = createApiClient({ kind: "organizer", token }, options);
  const item = (ticketId: string) => ({ params: { path: { event_id: eventId, ticket_id: ticketId } } });

  return {
    list: async (state: ParticipantListState) =>
      required(
        await client.GET("/api/events/{event_id}/participants", {
          params: { path: { event_id: eventId }, query: participantListQuery(state) },
        }),
      ),
    get: async (ticketId: string) => required(await client.GET("/api/events/{event_id}/participants/{ticket_id}", item(ticketId))),
    update: async (ticketId: string, body: ParticipantUpdate) =>
      required(await client.PATCH("/api/events/{event_id}/participants/{ticket_id}", { ...item(ticketId), body })),
    cancel: async (ticketId: string, body: ParticipantCancel) =>
      required(await client.POST("/api/events/{event_id}/participants/{ticket_id}/cancel", { ...item(ticketId), body })),
    reissue: async (ticketId: string, notify: boolean) =>
      required(await client.POST("/api/events/{event_id}/participants/{ticket_id}/reissue", { ...item(ticketId), body: { notify } })),
    transfer: async (ticketId: string, body: ParticipantTransfer) =>
      required(await client.POST("/api/events/{event_id}/participants/{ticket_id}/transfer", { ...item(ticketId), body })),
    remove: async (ticketId: string): Promise<void> => {
      unwrapApiResponse(await client.DELETE("/api/events/{event_id}/participants/{ticket_id}", item(ticketId)));
    },
    /** Every registration matching the list filters (not just the current page), as CSV. */
    exportCsv: async (state: ParticipantListState): Promise<Blob> => {
      const { q, tier_id, status } = participantListQuery(state);
      return required(
        await client.GET("/api/events/{event_id}/participants/export-csv", {
          params: { path: { event_id: eventId }, query: { q, tier_id, status } },
          parseAs: "blob",
        }),
      );
    },
  };
}

export type ParticipantsApi = ReturnType<typeof createParticipantsApi>;
