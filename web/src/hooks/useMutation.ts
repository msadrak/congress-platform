import { useCallback, useReducer, useRef } from "react";
import { ApiResponseError, localizedApiError } from "../api/client.ts";
import { networkErrorMessage } from "../lib/errorMessages.ts";
import type { AttendeeLocale } from "../lib/i18n";

export interface MutationState {
  readonly busy: boolean;
  readonly error: string | null;
}

export type MutationAction =
  | { readonly type: "start" }
  | { readonly type: "fail"; readonly message: string }
  | { readonly type: "settle" }
  | { readonly type: "setError"; readonly message: string | null };

export const idleMutation: MutationState = { busy: false, error: null };

/** Pure state machine: start clears the last error, fail records one, settle always ends `busy`. */
export function mutationReducer(state: MutationState, action: MutationAction): MutationState {
  switch (action.type) {
    case "start":
      return { busy: true, error: null };
    case "fail":
      return { ...state, error: action.message };
    case "settle":
      return state.busy ? { ...state, busy: false } : state;
    case "setError":
      return { ...state, error: action.message };
  }
}

/**
 * The reader's message for a thrown error: an HTTP failure (`ApiResponseError`, e.g. from
 * `unwrapApiResponse`) by its stable code; anything else means no response arrived.
 */
export function mutationErrorMessage(error: unknown, locale: AttendeeLocale): string {
  return error instanceof ApiResponseError ? localizedApiError(error, locale) : networkErrorMessage[locale];
}

/** `message: null`: refused because another run is still in flight (nothing to show). */
export type MutationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string | null };

/**
 * One request at a time with a guaranteed busy reset: `run(task)` sets `busy`, and whatever the task
 * does (resolve, throw, network failure) `busy` ends. A throw becomes a localized `error` and an
 * `{ ok: false, message }` result.
 */
export function useMutation(locale: AttendeeLocale) {
  const [state, dispatch] = useReducer(mutationReducer, idleMutation);
  const inFlight = useRef(false);

  const run = useCallback(async <T,>(task: () => Promise<T>): Promise<MutationResult<T>> => {
    if (inFlight.current) return { ok: false, message: null };
    inFlight.current = true;
    dispatch({ type: "start" });
    try {
      return { ok: true, value: await task() };
    } catch (error) {
      const message = mutationErrorMessage(error, locale);
      dispatch({ type: "fail", message });
      return { ok: false, message };
    } finally {
      inFlight.current = false;
      dispatch({ type: "settle" });
    }
  }, [locale]);

  const setError = useCallback((message: string | null) => dispatch({ type: "setError", message }), []);

  return { busy: state.busy, error: state.error, run, setError };
}
