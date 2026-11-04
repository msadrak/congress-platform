import { useId, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import type { AttendeeSearchItem } from "../../api/client";
import { commonCopy } from "../../copy/common";
import { deskCopy } from "../../copy/desk";
import { codeFontClass, formatMobile, formatNumber } from "../../lib/format";
import type { AttendeeLocale } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { SearchInput } from "../ui/Input";
import { Notice } from "../ui/Notice";
import { StatusChip } from "../ui/StatusChip";

interface SearchBarProps {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (query: string) => void;
  /** Enter opens the first match, or looks up a typed or pasted badge code. */
  onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
  searching: boolean;
  searchFailed: boolean;
  onRetry: () => void;
  /** Opens the camera to read a badge's QR code. */
  onScanCamera: () => void;
  /** Opens the desk registration dialog; null hides it (an archived congress). */
  onWalkIn: (() => void) | null;
  /** A scanned badge that could not be resolved, or null. */
  badgeNotice: string | null;
  locale: AttendeeLocale;
}

/** The command bar: one search box for names, mobiles and scanned badges, the camera, and desk registration. */
export function SearchBar({ inputRef, query, onQueryChange, onKeyDown, searching, searchFailed, onRetry, onScanCamera, onWalkIn, badgeNotice, locale }: SearchBarProps) {
  const c = deskCopy[locale];
  return (
    <div className="rx-search space-y-3">
      <div className="flex items-center gap-2">
        <SearchInput
          ref={inputRef}
          size="lg"
          autoComplete="off"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          onClear={() => {
            onQueryChange("");
            inputRef.current?.focus();
          }}
          clearLabel={commonCopy[locale].clearSearch}
          aria-label={c.searchLabel}
          placeholder={c.searchPlaceholder}
          wrapperClassName="min-w-0 flex-1"
        />
        <Button type="button" variant="secondary" size="lg" icon="camera" aria-label={c.scanCamera} title={c.scanCamera} onClick={onScanCamera} className="w-14 shrink-0 px-0!" />
        {onWalkIn && (
          <Button type="button" variant="secondary" size="lg" icon="user-plus" onClick={onWalkIn} className="shrink-0 max-sm:w-14 max-sm:px-0!">
            <span className="max-sm:sr-only">{c.walkIn}</span>
          </Button>
        )}
      </div>
      {searching && (
        <p role="status" className="sr-only">
          {c.searching}
        </p>
      )}
      {badgeNotice && (
        <div data-testid="badge-lookup-notice">
          <Notice tone="warning" icon="qr">
            {badgeNotice}
          </Notice>
        </div>
      )}
      {searchFailed && (
        <Notice
          tone="danger"
          icon="wifi-off"
          action={
            <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
              {commonCopy[locale].retry}
            </Button>
          }
        >
          {c.searchFailed}
        </Notice>
      )}
    </div>
  );
}

interface SearchResultsProps {
  results: AttendeeSearchItem[];
  trimmedQuery: string;
  searching: boolean;
  selectedTicketId: string | null;
  onOpen: (ticketId: string) => void;
  /** Offers the query as a desk registration when nothing matches; null hides it (an archived congress). */
  onRegisterWalkIn: (() => void) | null;
  locale: AttendeeLocale;
}

/** Matches (or the newest attendees) for the current query. */
export function SearchResults({ results, trimmedQuery, searching, selectedTicketId, onOpen, onRegisterWalkIn, locale }: SearchResultsProps) {
  const c = deskCopy[locale];
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <h2 id={headingId} className="sr-only">
        {trimmedQuery ? c.resultsHeading : c.attendeesHeading}
      </h2>
      <p className="sr-only" role="status">
        {trimmedQuery && !searching ? c.resultCount(formatNumber(results.length, locale)) : ""}
      </p>
      {results.length === 0 && trimmedQuery ? (
        <div className="space-y-4 px-4 py-8 text-center">
          <p className="text-body-sm text-text-secondary">{c.noMatch}</p>
          {onRegisterWalkIn && (
            <Button type="button" variant="secondary" size="md" icon="user-plus" onClick={onRegisterWalkIn} className="h-auto max-w-full whitespace-normal">
              <span className="break-words">{c.registerQuery(trimmedQuery)}</span>
            </Button>
          )}
        </div>
      ) : results.length === 0 ? (
        !searching && <p className="px-4 py-8 text-center text-body-sm text-text-muted">{c.noAttendees}</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {results.map((att) => {
            const affiliation = [att.title, att.organization].filter(Boolean).join(" · ");
            const mobile = att.attendee_mobile ? formatMobile(att.attendee_mobile, locale) : "";
            return (
              <li key={att.ticket_id}>
                <button
                  type="button"
                  onClick={() => onOpen(att.ticket_id)}
                  aria-label={c.review(att.attendee_name)}
                  aria-current={selectedTicketId === att.ticket_id ? "true" : undefined}
                  className="rx-row flex min-h-16 w-full cursor-pointer items-start justify-between gap-3 px-4 py-3 text-start hover:bg-surface-panel-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
                >
                  <span className="min-w-0 space-y-1">
                    <span className="block text-body font-semibold leading-snug break-words text-text-primary">{att.attendee_name}</span>
                    {mobile && (
                      <span className={`block truncate text-meta text-text-secondary ${codeFontClass(mobile)}`}>
                        <bdi dir="ltr">{mobile}</bdi>
                      </span>
                    )}
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-text-muted">
                      <span className="rounded-md bg-event-accent-soft px-1.5 py-0.5 font-semibold text-event-accent">{att.ticket_tier_name}</span>
                      {affiliation && <span className="min-w-0 break-words">{affiliation}</span>}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1.5">
                    <StatusChip status={att.status === "active" ? "active" : "cancelled"} size="sm" />
                    <span className="text-caption text-text-muted tabular">{c.checkins(formatNumber(att.checkin_count, locale))}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
