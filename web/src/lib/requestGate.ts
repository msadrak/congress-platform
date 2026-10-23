/**
 * Lets only the newest of several overlapping requests write its answer: each request takes a ticket with
 * `begin()` and writes only while `isLatest(ticket)`. `invalidate()` (on unmount) drops every answer still in
 * flight, and requests begun afterwards work normally again: React's StrictMode unmounts and remounts the same
 * component in development, so the gate must not stay closed after a cleanup.
 */
export interface RequestGate {
  begin(): number;
  isLatest(ticket: number): boolean;
  invalidate(): void;
}

export function createRequestGate(): RequestGate {
  let latest = 0;
  return {
    begin: () => ++latest,
    isLatest: (ticket) => ticket === latest,
    invalidate: () => {
      latest += 1;
    },
  };
}
