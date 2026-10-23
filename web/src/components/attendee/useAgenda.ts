import { useCallback, useState } from "react";
import { browserStorage, loadAgenda, saveAgenda, toggleAgendaId } from "../../lib/agenda";

export interface PersonalAgenda {
  ids: readonly string[];
  has: (sessionId: string) => boolean;
  toggle: (sessionId: string) => void;
  /** False once the device refused to store a change (the agenda then lasts for this visit only). */
  persisted: boolean;
}

const initial = (owner: string | null, eventId: string) => ({
  scope: owner ? `${owner}:${eventId}` : null,
  ids: owner ? loadAgenda(browserStorage(), owner, eventId) : [],
  persisted: true,
});

/**
 * The starred sessions of one attendee (`owner`) in one congress, kept in localStorage. `owner: null`
 * (the organizer's preview) keeps the agenda in memory only.
 */
export function useAgenda(owner: string | null, eventId: string): PersonalAgenda {
  const scope = owner ? `${owner}:${eventId}` : null;
  const [state, setState] = useState(() => initial(owner, eventId));
  // Another attendee or congress: start from that scope's stored agenda.
  if (state.scope !== scope) setState(initial(owner, eventId));

  const toggle = useCallback(
    (sessionId: string) => {
      setState((current) => {
        const ids = toggleAgendaId(current.ids, sessionId);
        const stored = owner ? saveAgenda(browserStorage(), owner, eventId, ids) : true;
        return { ...current, ids, persisted: current.persisted && stored };
      });
    },
    [owner, eventId],
  );

  return { ids: state.ids, has: (id) => state.ids.includes(id), toggle, persisted: state.persisted };
}
