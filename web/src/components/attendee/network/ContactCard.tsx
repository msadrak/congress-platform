import { useState } from "react";
import type { ConnectionOut } from "../../../api/client";
import { formatLocalizedDate, type AttendeeLocale } from "../../../lib/i18n";
import { formatMobile, telHref } from "../../../lib/mobile";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { Monogram } from "../Monogram";
import { networkCopy } from "../attendeeCopy";

interface ContactCardProps {
  contact: ConnectionOut;
  locale: AttendeeLocale;
  /** Just scanned: highlighted at the top of the list. */
  fresh: boolean;
  savingNote: boolean;
  onSaveNote: (note: string) => Promise<boolean>;
  onVcard: () => void;
  onRemove: () => void;
}

/** One contact: identity, mobile when shared, the private note (editable), vCard and removal. */
export function ContactCard({ contact, locale, fresh, savingNote, onSaveNote, onVcard, onRemove }: ContactCardProps) {
  const c = networkCopy[locale];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const noteId = `notes-${contact.id}`;

  const save = async () => {
    if (await onSaveNote(draft.trim())) setEditing(false);
  };

  return (
    <article
      aria-labelledby={`conn-${contact.id}`}
      className={`overflow-hidden rounded-[var(--radius-xl)] border bg-surface-panel shadow-soft transition-shadow hover:shadow-lift ${
        fresh ? "border-event-accent/50 ring-2 ring-event-accent/25" : "border-border-default"
      }`}
    >
      <div className="flex items-start gap-4 p-5 sm:p-6">
        <Monogram name={contact.full_name} seed={contact.connected_user_id} size="lg" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`conn-${contact.id}`} className="text-lg font-semibold leading-snug tracking-[-0.02em] text-text-primary break-words">
              {contact.full_name}
            </h3>
            {fresh && (
              <Badge variant="accent" size="sm" dot>
                {c.newBadge}
              </Badge>
            )}
          </div>
          {(contact.title || contact.organization) && (
            <p dir="auto" className="text-sm text-text-secondary break-words">
              {contact.title}
              {contact.title && contact.organization ? " · " : ""}
              {contact.organization && <span className="font-medium text-text-primary">{contact.organization}</span>}
            </p>
          )}
          <div className="pt-1 text-xs">
            {contact.mobile ? (
              <a
                href={telHref(contact.mobile)}
                className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded font-mono text-action-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-focus-ring"
              >
                <Icon name="phone" size={15} />
                <bdi dir="ltr" className="truncate">{formatMobile(contact.mobile, locale)}</bdi>
              </a>
            ) : (
              <span className="inline-flex items-start gap-1.5 rounded-lg bg-surface-panel-subtle px-2.5 py-1.5 leading-snug text-text-muted">
                <Icon name="lock" size={13} className="mt-px" />
                <span>{c.mobileHidden}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mx-5 mb-5 rounded-xl border border-border-subtle bg-surface-panel-subtle p-4 sm:mx-6">
        <div className="flex items-center justify-between gap-3">
          {editing ? (
            <label htmlFor={noteId} className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
              <Icon name="note" size={14} />
              {c.notes}
            </label>
          ) : (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
              <Icon name="note" size={14} />
              {c.notes}
            </span>
          )}
          {!editing && (
            <button
              type="button"
              onClick={() => {
                setDraft(contact.private_notes || "");
                setEditing(true);
              }}
              className="-my-2 -me-2 inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-xs font-semibold text-action-primary underline-offset-4 hover:underline cursor-pointer focus-visible:outline-2 focus-visible:outline-focus-ring"
            >
              {c.editNote}
            </button>
          )}
        </div>
        {editing ? (
          <div className="mt-3 space-y-3">
            <textarea id={noteId} rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={c.notePlaceholder} className="ui-textarea text-sm" />
            <div className="flex items-center gap-2">
              <Button type="button" variant="primary" size="md" disabled={savingNote} aria-busy={savingNote} onClick={() => void save()}>
                {savingNote ? c.saving : c.saveNote}
              </Button>
              <Button type="button" variant="ghost" size="md" disabled={savingNote} onClick={() => setEditing(false)}>
                {c.cancel}
              </Button>
            </div>
          </div>
        ) : (
          <p dir="auto" className="mt-2 whitespace-pre-line text-sm leading-relaxed text-text-secondary">
            {contact.private_notes || <span className="text-text-muted italic">{c.noNotes}</span>}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-5 py-3 sm:px-6">
        <p className="flex items-center gap-1.5 text-[11px] text-text-muted">
          <Icon name="calendar" size={14} />
          <span>{c.connectedOn}</span>
          <span>{formatLocalizedDate(contact.created_at, locale)}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="md" onClick={onVcard} className="text-xs">
            <Icon name="id-card" size={17} />
            <span>{c.vcard}</span>
          </Button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={c.removeLabel(contact.full_name)}
            title={c.remove}
            className="press grid size-11 place-items-center rounded-[10px] border border-border-default text-text-muted transition-colors hover:border-status-danger-border hover:bg-status-danger-bg hover:text-status-danger-text cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <Icon name="trash" size={18} />
          </button>
        </div>
      </div>
    </article>
  );
}
