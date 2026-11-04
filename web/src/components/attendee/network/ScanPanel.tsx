import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { ConnectionOut } from "../../../api/client";
import type { AttendeeLocale } from "../../../lib/i18n";
import { formatCountdown } from "../../../lib/retryAfter";
import { QrCameraInput } from "../../QrCameraInput";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { attendeeCopy } from "../../../copy/attendee";

export interface ScanError {
  text: string;
  /** ACTIVE_TICKET_REQUIRED: offer the way to a pass. */
  register?: boolean;
}

export interface ScanResult {
  contact: ConnectionOut;
  /** 200: the badge belongs to someone already in this network. */
  already: boolean;
}

interface ScanPanelProps {
  locale: AttendeeLocale;
  busy: boolean;
  error: ScanError | null;
  /** Seconds until scanning is allowed again after a 429; null when not rate limited. */
  retrySeconds: number | null;
  registerTo: string;
  result: ScanResult | null;
  noteBusy: boolean;
  noteSaved: boolean;
  /** The camera starts by itself (the person asked to scan, and the browser already allows the camera). */
  autoStart?: boolean;
  onSubmit: (secret: string) => void;
  onSaveNote: (note: string) => void;
  onNext: () => void;
}

/**
 * The scan sheet: the camera first, typing the code behind a link. After a successful scan it turns into
 * the confirmation with an optional private note, then back to the camera for the next person.
 */
export function ScanPanel({ locale, busy, error, retrySeconds, registerTo, result, noteBusy, noteSaved, autoStart = false, onSubmit, onSaveNote, onNext }: ScanPanelProps) {
  const c = attendeeCopy[locale].network;
  const id = useId();
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState("");
  const [note, setNote] = useState(result?.contact.private_notes ?? "");
  const [noteFor, setNoteFor] = useState(result?.contact.id ?? null);
  // A new result starts from that contact's stored note.
  if ((result?.contact.id ?? null) !== noteFor) {
    setNoteFor(result?.contact.id ?? null);
    setNote(result?.contact.private_notes ?? "");
  }
  const limited = retrySeconds !== null;

  const submitTyped = (e: FormEvent) => {
    e.preventDefault();
    // The connection code is case-insensitive; people may type it grouped or in capitals.
    const secret = code.replace(/\s+/g, "").toLowerCase();
    if (secret) onSubmit(secret);
  };

  if (result) {
    const name = result.contact.full_name;
    return (
      <div className="space-y-5">
        <div
          role="status"
          className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-medium leading-relaxed motion-safe:animate-fade ${
            result.already ? "border-action-subtle-border bg-action-subtle text-action-primary" : "border-status-success-border bg-status-success-bg text-status-success-text"
          }`}
        >
          <Icon name={result.already ? "users" : "check-circle"} size={20} className="mt-0.5 shrink-0" />
          <p className="min-w-0 break-words">{result.already ? c.already(name) : c.added(name)}</p>
        </div>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSaveNote(note.trim());
          }}
        >
          <label htmlFor={`${id}-note`} className="ui-label">
            {c.noteLabel}
          </label>
          <textarea
            id={`${id}-note`}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={c.notePlaceholder}
            aria-describedby={`${id}-note-hint`}
            className="ui-textarea text-sm"
          />
          <p id={`${id}-note-hint`} className="text-xs text-text-muted">{c.noteHint}</p>
          {noteSaved && (
            <p role="status" className="flex items-center gap-2 text-xs font-semibold text-status-success-text">
              <Icon name="check" size={15} />
              {c.noteSaved}
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" variant="primary" size="lg" disabled={noteBusy || note.trim() === ""} aria-busy={noteBusy}>
              <Icon name="note" size={18} />
              {noteBusy ? c.saving : c.saveNote}
            </Button>
            <Button type="button" variant="secondary" size="lg" onClick={onNext}>
              <Icon name="scan" size={18} />
              {noteSaved ? c.scanAnother : c.skipNote}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-text-secondary">{c.scanLead}</p>
      <QrCameraInput locale={locale} disabled={busy || limited} autoStart={autoStart} onDecode={onSubmit} />
      {busy && (
        <p role="status" className="text-xs text-text-secondary">
          {c.saving}
        </p>
      )}

      {limited && (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-status-warning-border bg-status-warning-bg p-3 text-sm text-status-warning-text">
          <Icon name="hourglass" size={17} className="mt-0.5 shrink-0" />
          {c.retryIn(formatCountdown(retrySeconds, locale))}
        </p>
      )}
      {error && !limited && (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-status-danger-border bg-status-danger-bg p-3 text-sm leading-relaxed text-status-danger-text">
          <p className="flex items-start gap-2">
            <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
            {error.text}
          </p>
          {error.register && (
            <Link to={registerTo} className="inline-flex min-h-12 items-center gap-1 font-semibold underline underline-offset-4">
              {c.getPass}
              <Icon name="arrow-right" size={14} />
            </Link>
          )}
        </div>
      )}

      <button
        type="button"
        aria-expanded={manual}
        aria-controls={`${id}-manual`}
        onClick={() => setManual((v) => !v)}
        className="inline-flex min-h-12 items-center gap-1.5 rounded-lg text-sm font-semibold text-action-primary underline-offset-4 hover:underline cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <Icon name={manual ? "camera" : "keyboard"} size={17} />
        {manual ? c.hideCodeLink : c.enterCodeLink}
      </button>

      {manual && (
        <form id={`${id}-manual`} onSubmit={submitTyped} className="space-y-3 rounded-2xl border border-border-default bg-surface-panel-subtle p-4">
          <div>
            <label htmlFor={`${id}-code`} className="ui-label">
              {c.codeLabel}
            </label>
            <div className="relative">
              <Icon name="qr" size={18} className="pointer-events-none absolute inset-y-0 start-3.5 my-auto text-ink-400" />
              <input
                id={`${id}-code`}
                type="text"
                required
                dir="ltr"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="k7m2 q9xa …"
                className="ui-input ps-10 font-mono text-start"
              />
            </div>
          </div>
          <Button type="submit" variant="primary" size="lg" isFullWidth disabled={busy || limited} aria-busy={busy}>
            {busy ? c.saving : c.saveContact}
          </Button>
        </form>
      )}
    </div>
  );
}
