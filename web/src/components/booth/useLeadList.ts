import { useCallback, useEffect, useRef, useState } from "react";
import { createApiClient, type LeadOut } from "../../api/client";
import { codedMessage } from "./boothText";
import { attendeeResponseState, isStoredAttendeeToken } from "../../lib/attendeeSession";
import type { AttendeeLocale } from "../../lib/i18n";
import {
  LEAD_SEARCH_DEBOUNCE_MS,
  appendLeadPage,
  accessBlockOf,
  isCursorInvalid,
  leadSearchParams,
  replaceLead,
  withoutLead,
  type AccessBlock,
  type LeadQuery,
  type RatingCounts,
} from "../../lib/leadList";

interface LeadSource {
  boothId: string | undefined;
  token: string | null;
  locale: AttendeeLocale;
  /** False once access was revoked: nothing is fetched any more (no retry loop against a 403). */
  enabled: boolean;
  /** 403 `BOOTH_STAFF_REQUIRED`: this account was removed from the booth's staff. */
  onAccessBlocked: (block: AccessBlock) => void;
}

export interface LeadListState {
  query: LeadQuery;
  setSearch: (q: string) => void;
  setRating: (rating: LeadQuery["rating"]) => void;
  setView: (view: LeadQuery["view"]) => void;
  /** The query the shown items answer (the search is debounced). */
  appliedQuery: LeadQuery;
  items: LeadOut[];
  /** Leads matching the applied query across every page. */
  total: number;
  hasMore: boolean;
  /** "loading" only until the first page of a query arrives; later pages use `loadingMore`. */
  status: "loading" | "ready" | "error";
  /** A newer query is on its way while the previous results stay on screen. */
  refreshing: boolean;
  loadingMore: boolean;
  error: string | null;
  loadMoreError: string | null;
  reload: () => void;
  loadMore: () => void;
  /** A confirmed server copy of a lead (qualification saved). */
  applyLead: (lead: LeadOut) => void;
  /** A lead left this view (deleted from the worklist, restored out of the trash). */
  dropLead: (leadId: string) => void;
}

type Client = ReturnType<typeof createApiClient>;

function client(token: string): Client {
  return createApiClient({ kind: "user", token });
}

/**
 * One page at a time of the booth's leads from `/leads/search`, newest first: debounced server-side search,
 * rating filter, the trash view and "load more" by cursor. Responses for an older query, booth or session are
 * dropped (a generation counter), so a slow answer never overwrites a newer one.
 */
export function useLeadList({ boothId, token, locale, enabled, onAccessBlocked }: LeadSource): LeadListState {
  const [query, setQuery] = useState<LeadQuery>({ q: "", rating: "", view: "active" });
  const [appliedQuery, setAppliedQuery] = useState<LeadQuery>(query);
  const [items, setItems] = useState<LeadOut[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<LeadListState["status"]>("loading");
  // The request a first page answers; `refreshing` is derived from it.
  const [loadedKey, setLoadedKey] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  // Another account (or booth) never sees the previous one's leads, not even while its own first page loads.
  const [listedFor, setListedFor] = useState(`${boothId}|${token}`);
  if (listedFor !== `${boothId}|${token}`) {
    setListedFor(`${boothId}|${token}`);
    setItems([]);
    setTotal(0);
    setCursor(null);
    setStatus("loading");
    setError(null);
  }
  const generation = useRef(0);
  const revokedRef = useRef(onAccessBlocked);
  // `locale` only words error messages: switching language does not refetch.
  const localeRef = useRef(locale);
  useEffect(() => {
    revokedRef.current = onAccessBlocked;
    localeRef.current = locale;
  });
  const requestKey = `${boothId}|${token}|${appliedQuery.view}|${appliedQuery.rating}|${appliedQuery.q}|${reloadNonce}`;
  const refreshing = enabled && loadedKey !== requestKey;

  // The search waits for a typing pause; the rating and view apply at once.
  useEffect(() => {
    if (query.q === appliedQuery.q && query.rating === appliedQuery.rating && query.view === appliedQuery.view) return;
    const delay = query.q !== appliedQuery.q ? LEAD_SEARCH_DEBOUNCE_MS : 0;
    const timer = window.setTimeout(() => setAppliedQuery(query), delay);
    return () => window.clearTimeout(timer);
  }, [query, appliedQuery]);

  // First page of the applied query (and every reload).
  useEffect(() => {
    if (!enabled || !boothId || !token) return;
    const mine = ++generation.current;
    const key = `${boothId}|${token}|${appliedQuery.view}|${appliedQuery.rating}|${appliedQuery.q}|${reloadNonce}`;
    void (async () => {
      try {
        const res = await client(token).GET("/api/booths/{booth_id}/leads/search", {
          params: { path: { booth_id: boothId }, query: leadSearchParams(appliedQuery) },
        });
        if (mine !== generation.current) return;
        // A changed or expired session: the page re-renders from the session store; nothing here applies.
        if (attendeeResponseState(token, res.response.status) !== "current") return;
        setLoadedKey(key);
        setLoadMoreError(null);
        if (res.data) {
          setItems(res.data.items);
          setTotal(res.data.total);
          setCursor(res.data.next_cursor);
          setStatus("ready");
          setError(null);
        } else if (accessBlockOf(res.response.status, res.error)) {
          revokedRef.current(accessBlockOf(res.response.status, res.error)!);
        } else {
          // Nothing stale is shown: a failed first page empties the list behind the error.
          setItems([]);
          setTotal(0);
          setCursor(null);
          setStatus("error");
          setError(codedMessage(res.error, localeRef.current));
        }
      } catch {
        if (mine !== generation.current) return;
        setLoadedKey(key);
        setItems([]);
        setTotal(0);
        setCursor(null);
        setStatus("error");
        setError(null);
      }
    })();
  }, [enabled, boothId, token, appliedQuery, reloadNonce]);

  const loadMore = useCallback(() => {
    if (!enabled || !boothId || !token || !cursor || loadingMore || !isStoredAttendeeToken(token)) return;
    const mine = generation.current;
    setLoadingMore(true);
    setLoadMoreError(null);
    void (async () => {
      try {
        const res = await client(token).GET("/api/booths/{booth_id}/leads/search", {
          params: { path: { booth_id: boothId }, query: leadSearchParams(appliedQuery, cursor) },
        });
        if (mine !== generation.current) return;
        if (attendeeResponseState(token, res.response.status) !== "current") return;
        if (res.data) {
          setItems((current) => appendLeadPage(current, res.data.items));
          setTotal(res.data.total);
          setCursor(res.data.next_cursor);
        } else if (accessBlockOf(res.response.status, res.error)) {
          revokedRef.current(accessBlockOf(res.response.status, res.error)!);
        } else if (isCursorInvalid(res.response.status, res.error)) {
          // The position no longer exists: start the list again rather than show a gap.
          setReloadNonce((n) => n + 1);
        } else {
          setLoadMoreError(codedMessage(res.error, localeRef.current) ?? "");
        }
      } catch {
        if (mine === generation.current) setLoadMoreError("");
      } finally {
        if (mine === generation.current) setLoadingMore(false);
      }
    })();
  }, [enabled, boothId, token, cursor, loadingMore, appliedQuery]);

  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  const applyLead = (lead: LeadOut) => {
    if (!items.some((l) => l.id === lead.id)) return;
    // A rating filter the saved lead no longer matches drops it from this view.
    if (appliedQuery.rating && lead.rating !== appliedQuery.rating) {
      setItems(withoutLead(items, lead.id));
      setTotal((n) => Math.max(0, n - 1));
    } else {
      setItems(replaceLead(items, lead));
    }
  };

  const dropLead = (leadId: string) => {
    if (!items.some((l) => l.id === leadId)) return;
    setItems(withoutLead(items, leadId));
    setTotal((n) => Math.max(0, n - 1));
  };

  return {
    query,
    setSearch: (q) => setQuery((p) => ({ ...p, q })),
    setRating: (rating) => setQuery((p) => ({ ...p, rating })),
    setView: (view) => setQuery((p) => ({ ...p, view })),
    appliedQuery,
    items,
    total,
    hasMore: cursor !== null,
    status,
    refreshing,
    loadingMore,
    error,
    loadMoreError,
    reload,
    loadMore,
    applyLead,
    dropLead,
  };
}

const ZERO: RatingCounts = { HOT: 0, WARM: 0, COLD: 0 };

export interface LeadCounts {
  counts: RatingCounts;
  /** Leads in the booth's trash. */
  deleted: number;
  /** All four totals have arrived at least once. */
  known: boolean;
  refresh: () => void;
}

/**
 * The booth-wide totals behind the header ledger and the filter chips: one `limit=1` search per rating, plus the
 * trash. They always describe the whole booth, never the filtered view.
 */
export function useLeadCounts({ boothId, token, enabled, onAccessBlocked }: Omit<LeadSource, "locale">): LeadCounts {
  const [counts, setCounts] = useState<RatingCounts>(ZERO);
  const [deleted, setDeleted] = useState(0);
  const [known, setKnown] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [countedFor, setCountedFor] = useState(`${boothId}|${token}`);
  if (countedFor !== `${boothId}|${token}`) {
    setCountedFor(`${boothId}|${token}`);
    setCounts(ZERO);
    setDeleted(0);
    setKnown(false);
  }
  const revokedRef = useRef(onAccessBlocked);
  useEffect(() => {
    revokedRef.current = onAccessBlocked;
  });

  useEffect(() => {
    if (!enabled || !boothId || !token) return;
    let current = true;
    const api = client(token);
    const count = (query: { rating?: "HOT" | "WARM" | "COLD"; state: "active" | "deleted" }) =>
      api.GET("/api/booths/{booth_id}/leads/search", {
        params: { path: { booth_id: boothId }, query: { ...query, limit: 1 } },
      });
    void (async () => {
      try {
        const [hot, warm, cold, trash] = await Promise.all([
          count({ rating: "HOT", state: "active" }),
          count({ rating: "WARM", state: "active" }),
          count({ rating: "COLD", state: "active" }),
          count({ state: "deleted" }),
        ]);
        if (!current) return;
        const all = [hot, warm, cold, trash];
        if (all.some((res) => attendeeResponseState(token, res.response.status) !== "current")) return;
        const block = all.map((res) => accessBlockOf(res.response.status, res.error)).find(Boolean);
        if (block) {
          revokedRef.current(block);
          return;
        }
        // A failed count keeps the last known figures; the list itself reports load errors.
        if (hot.data && warm.data && cold.data) {
          setCounts({ HOT: hot.data.total, WARM: warm.data.total, COLD: cold.data.total });
          setKnown(true);
        }
        if (trash.data) setDeleted(trash.data.total);
      } catch {
        // Offline: the last known figures stay.
      }
    })();
    return () => {
      current = false;
    };
  }, [enabled, boothId, token, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { counts, deleted, known, refresh };
}
