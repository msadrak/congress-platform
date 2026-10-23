import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import type { AttendeeSearchItem } from "../../api/client";
import { formatMobile } from "../../lib/mobile";
import { codeFontClass, formatLocalizedNumber, type AttendeeLocale, type TranslationDictionary } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Kbd, TicketStatusChip } from "./ReceptionPass";
import { deskFocusRing } from "./deskTypes";

interface SearchBarProps {
  inputId: string;
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (query: string) => void;
  /** Keys pressed in the search box (Enter opens the first match, Esc clears). */
  onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
  searching: boolean;
  searchFailed: boolean;
  onRetry: () => void;
  /** Opens the camera to read a badge's QR code. */
  onScanCamera: () => void;
  /** A scanned badge that could not be resolved, or null. */
  badgeNotice: string | null;
  t: TranslationDictionary;
  isRtl: boolean;
}

/** 01 — the command bar: one search box for names, mobile numbers and scanned badges (gun or camera). */
export function SearchBar({ inputId, inputRef, query, onQueryChange, onKeyDown, searching, searchFailed, onRetry, onScanCamera, badgeNotice, t, isRtl }: SearchBarProps) {
  return (
    <section aria-labelledby="search-heading" className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <h2 id="search-heading" className="flex items-center gap-2.5 text-sm font-semibold text-text-secondary">
          <span aria-hidden="true" className="font-mono text-[11px] text-aiteb-indigo">01</span>
          <span>{t.searchAttendeeHeading}</span>
        </h2>
        <p className="hidden items-center gap-3 text-xs text-text-muted sm:flex">
          <span className="inline-flex items-center gap-1.5"><Kbd>/</Kbd>{isRtl ? "جستجو" : "Search"}</span>
          <span className="inline-flex items-center gap-1.5"><Kbd>Enter</Kbd>{isRtl ? "باز کردن" : "Open"}</span>
          <span className="inline-flex items-center gap-1.5"><Kbd>Esc</Kbd>{isRtl ? "پاک کردن" : "Clear"}</span>
        </p>
      </div>

      <div className="relative">
        <label htmlFor={inputId} className="sr-only">{t.searchAttendeeHeading}</label>
        <Icon name="search" size={24} className="pointer-events-none absolute start-5 top-1/2 -translate-y-1/2 text-aiteb-indigo" />
        <input
          id={inputId}
          ref={inputRef}
          type="search"
          autoComplete="off"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t.searchAttendeePlaceholder}
          className="rx-command-input"
        />
        <div className="absolute end-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
          {searching && (
            <span role="status" className="grid size-8 place-items-center text-text-muted">
              <Icon name="sync" size={18} className="motion-safe:animate-spin" />
              <span className="sr-only">{isRtl ? "در حال جستجو..." : "Searching..."}</span>
            </span>
          )}
          {query ? (
            <button
              type="button"
              onClick={() => { onQueryChange(""); inputRef.current?.focus(); }}
              aria-label={isRtl ? "پاک کردن جستجو" : "Clear search"}
              className={`grid size-11 place-items-center rounded-xl text-text-muted hover:bg-surface-panel-subtle hover:text-text-primary cursor-pointer ${deskFocusRing}`}
            >
              <Icon name="x" size={20} />
            </button>
          ) : (
            <span aria-hidden="true" className="me-2 hidden sm:inline-flex"><Kbd>/</Kbd></span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-text-muted">
          {isRtl ? "کارت ورود را با بارکدخوان در همین کادر اسکن کنید یا از دوربین استفاده کنید." : "Scan a badge into this box with the barcode gun, or use the camera."}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onScanCamera}>
          <Icon name="camera" size={16} />
          <span>{isRtl ? "اسکن کد QR با دوربین" : "Scan QR code with camera"}</span>
        </Button>
      </div>

      {badgeNotice && (
        <div role="alert" data-testid="badge-lookup-notice" className="flex items-center gap-2.5 rounded-xl border border-status-warning-border bg-status-warning-bg px-3.5 py-2 text-sm text-status-warning-text">
          <Icon name="qr" size={18} />
          <span>{badgeNotice}</span>
        </div>
      )}

      {searchFailed && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-status-danger-border bg-status-danger-bg py-2 ps-3.5 pe-2 text-sm text-status-danger-text">
          <span className="flex items-center gap-2.5"><Icon name="wifi-off" size={18} />{isRtl ? "جستجو انجام نشد؛ نتایج زیر ممکن است قدیمی باشند." : "Search failed; the list below may be out of date."}</span>
          <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
            {isRtl ? "تلاش مجدد" : "Retry"}
          </Button>
        </div>
      )}
    </section>
  );
}

interface SearchResultsProps {
  results: AttendeeSearchItem[];
  trimmedQuery: string;
  searching: boolean;
  selectedTicketId: string | null;
  onOpen: (ticketId: string) => void;
  onRegisterWalkIn: () => void;
  statusLabels: Record<string, string>;
  locale: AttendeeLocale;
  t: TranslationDictionary;
  isRtl: boolean;
}

/** 02 — matches (or the newest attendees) for the current query. */
export function SearchResults({ results, trimmedQuery, searching, selectedTicketId, onOpen, onRegisterWalkIn, statusLabels, locale, t, isRtl }: SearchResultsProps) {
  return (
    <section aria-labelledby="results-heading" className="rx-area-results min-w-0 overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft">
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3 sm:px-5">
        <h2 id="results-heading" className="flex items-center gap-2.5 text-sm font-semibold text-text-primary">
          <span aria-hidden="true" className="font-mono text-[11px] text-aiteb-indigo">02</span>
          <span>{trimmedQuery ? (isRtl ? "نتایج جستجو" : "Matches") : isRtl ? "شرکت‌کنندگان" : "Attendees"}</span>
        </h2>
        {results.length > 0 && (
          <span className={`rounded-full bg-surface-panel-subtle px-2 py-0.5 ${codeFontClass(formatLocalizedNumber(results.length, locale))} text-[11px] text-text-secondary tabular`}>{formatLocalizedNumber(results.length, locale)}</span>
        )}
      </div>
      <p className="sr-only" role="status">
        {trimmedQuery && !searching
          ? isRtl
            ? `${formatLocalizedNumber(results.length, locale)} نتیجه`
            : `${results.length} ${results.length === 1 ? "match" : "matches"}`
          : ""}
      </p>
      <div className="rx-results-scroll">
        {results.length === 0 && trimmedQuery ? (
          <div className="space-y-4 px-5 py-9 text-center">
            <span aria-hidden="true" className="mx-auto grid size-11 place-items-center rounded-full bg-surface-panel-subtle text-text-muted">
              <Icon name="search" size={20} />
            </span>
            <p className="text-sm text-text-secondary">{t.noAttendeeFound}</p>
            <Button type="button" variant="outline" size="md" onClick={onRegisterWalkIn} className="h-auto max-w-full whitespace-normal">
              <Icon name="user-plus" size={18} />
              <span className="break-words">{isRtl ? `ثبت «${trimmedQuery}» به‌عنوان ثبت‌نام حضوری` : `Register “${trimmedQuery}” as walk-in`}</span>
            </Button>
          </div>
        ) : results.length === 0 ? (
          <p className="px-5 py-9 text-center text-sm text-text-muted">
            {isRtl ? "نام یا شماره موبایل شرکت‌کننده را جستجو کنید." : "Type a name or mobile number to find an attendee."}
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {results.map((att) => {
              const affiliation = [att.title, att.organization].filter(Boolean).join(" · ");
              return (
                <li key={att.ticket_id}>
                  <button
                    type="button"
                    onClick={() => onOpen(att.ticket_id)}
                    aria-label={isRtl ? `بررسی ${att.attendee_name}` : `Review ${att.attendee_name}`}
                    aria-current={selectedTicketId === att.ticket_id ? "true" : undefined}
                    className="rx-row flex min-h-[68px] w-full items-start justify-between gap-3 px-4 py-3.5 text-start hover:bg-surface-panel-subtle cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring sm:px-5"
                  >
                    <span className="min-w-0 space-y-1">
                      <span className="block text-[15px] font-semibold leading-snug text-text-primary break-words">{att.attendee_name}</span>
                      {att.attendee_mobile && (
                        <span className={`block truncate ${codeFontClass(formatMobile(att.attendee_mobile, locale))} text-xs text-text-secondary`}>
                          <bdi dir="ltr">{formatMobile(att.attendee_mobile, locale)}</bdi>
                        </span>
                      )}
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
                        <span className="rounded-md bg-event-accent-soft px-1.5 py-0.5 font-semibold text-event-accent">{att.ticket_tier_name}</span>
                        {affiliation && <span className="min-w-0 break-words">{affiliation}</span>}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1.5">
                      <TicketStatusChip status={att.status} label={statusLabels[att.status] ?? att.status} />
                      <span className="text-[11px] text-text-muted tabular">
                        {isRtl ? "تردد:" : "Check-ins:"} {formatLocalizedNumber(att.checkin_count, locale)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
