import { useSyncExternalStore } from "react";
import {
  readAttendeeToken,
  rejectAttendeeToken,
  signOutAttendee,
  storeAttendeeToken,
  subscribeAttendeeSession,
} from "../lib/attendeeSession";

export interface AttendeeSession {
  /** The stored token, re-read on this tab's changes and on another tab's `storage` event. */
  readonly token: string | null;
  readonly signedIn: boolean;
  /** Removes the token and every cached pass on this device. */
  readonly signOut: () => void;
  /** After a 401 for `token`: removes it and its owner's cached passes, only if it is still stored. */
  readonly rejectToken: (token: string) => boolean;
  /** Stores a freshly issued token. */
  readonly signIn: (token: string) => void;
}

/** The attendee session as React state. The policy itself lives in lib/attendeeSession.ts. */
export function useAttendeeSession(): AttendeeSession {
  const token = useSyncExternalStore(subscribeAttendeeSession, readAttendeeToken, () => null);
  return {
    token,
    signedIn: token !== null,
    signOut: signOutAttendee,
    rejectToken: rejectAttendeeToken,
    signIn: storeAttendeeToken,
  };
}
