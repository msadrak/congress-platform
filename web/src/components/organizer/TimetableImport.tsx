import React, { useId, useState } from "react";
import type { EventSessionImport, EventSessionImportOut, VenuePlaceOut } from "../../api/client";
import { codeFontClass, formatDate, formatNumber } from "../../lib/format";
import {
  MAX_SESSION_IMPORT_ROWS,
  parseSessionCsv,
  sessionCsvTemplate,
  type SessionCsvField,
  type SessionCsvResult,
  type SessionRowProblem,
} from "../../lib/sessionCsv";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { FormAlert } from "./WorkspaceUi";
import { commonCopy } from "../../copy/common";
import { organizerProgramCopy } from "../../copy/organizerProgram";

interface TimetableImportProps {
  /** Sessions the event already has (removed when "replace" is chosen). */
  existingCount: number;
  halls: VenuePlaceOut[];
  /** Local day (YYYY-MM-DD) used for the template's example rows. */
  templateDay: string;
  /** Slug-like base for the template file name. */
  fileBase: string;
  /** The event's IANA zone: the file's wall-clock times are read, and previewed, in it. */
  timeZone: string;
  locale: "fa" | "en";
  onImport: (body: EventSessionImport) => Promise<{ result?: EventSessionImportOut; error?: string }>;
  onDone: (result: EventSessionImportOut) => void;
  onClose: () => void;
}

const MAX_FILE_BYTES = 2_000_000;

/** Decodes the file as UTF-8, falling back to Windows-1256 (Excel's legacy "CSV" for Persian). */
function decodeCsv(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1256").decode(bytes);
  }
}

/** «ورود از اکسل»: a CSV timetable checked row by row, then imported all-or-nothing, in a dialog. */
export function TimetableImport({ existingCount, halls, templateDay, fileBase, timeZone, locale, onImport, onDone, onClose }: TimetableImportProps) {
  const c = organizerProgramCopy[locale].importer;
  const fileInputId = useId();
  const replaceId = useId();
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<SessionCsvResult | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fmt = (n: number) => formatNumber(n, locale);

  const rows = parsed?.ok ? parsed.rows : [];
  const invalidRows = rows.filter((r) => r.problems.length > 0);
  const knownHalls = new Set(halls.map((h) => h.name.trim().toLowerCase()));
  const newHalls = [
    ...new Map(
      rows
        .map((r) => r.values.hall)
        .filter((name) => name && !knownHalls.has(name.toLowerCase()))
        .map((name) => [name.toLowerCase(), name] as const),
    ).values(),
  ];
  const canImport = parsed?.ok === true && rows.length > 0 && invalidRows.length === 0 && !submitting;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    // Clearing the input lets the organizer pick the same file again after fixing it.
    input.value = "";
    if (!file) return;
    setSubmitError(null);
    setReadError(null);
    setParsed(null);
    setFileName(file.name);
    if (file.size > MAX_FILE_BYTES) {
      setReadError(c.tooBig);
      return;
    }
    try {
      setParsed(parseSessionCsv(decodeCsv(await file.arrayBuffer()), { timeZone }));
    } catch {
      setReadError(c.unreadable);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([sessionCsvTemplate(locale, templateDay)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileBase || "program"}-timetable-template.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const submit = async () => {
    if (!parsed?.ok || !canImport) return;
    setSubmitting(true);
    setSubmitError(null);
    const sessions = rows.flatMap((r) => (r.session ? [r.session] : []));
    const { result, error } = await onImport({ replace, sessions });
    setSubmitting(false);
    if (result) onDone(result);
    else setSubmitError(error ?? c.failed);
  };

  const fieldName = (field: SessionCsvField) => c.fields[field];
  const problemText = (p: SessionRowProblem): string => {
    switch (p.code) {
      case "required":
        return c.required(fieldName(p.field));
      case "too_long":
        return c.tooLong(fieldName(p.field), fmt(p.max));
      case "invalid_date":
        return c.invalidDate(fieldName(p.field));
      case "ends_before_start":
        return c.endsBeforeStart;
    }
  };

  const fileErrorText = (result: Exclude<SessionCsvResult, { ok: true }>): string => {
    switch (result.error) {
      case "no_rows":
        return c.noRows;
      case "missing_columns":
        return c.missingColumns(result.missing.map((f) => `${fieldName(f)} (${f})`).join(c.listSeparator));
      case "too_many_rows":
        return c.tooManyRows(fmt(result.max));
      case "unterminated_quote":
        return c.unterminatedQuote(fmt(result.line));
    }
  };

  const timeText = (startIso: string, endIso: string) => {
    const day = (iso: string) => formatDate(iso, "short", locale, timeZone);
    const time = (iso: string) => formatDate(iso, "time", locale, timeZone);
    const sameDay = day(startIso) === day(endIso);
    return c.timeRange(`${day(startIso)} ${time(startIso)}`, `${sameDay ? "" : `${day(endIso)} `}${time(endIso)}`);
  };

  const close = () => {
    if (!submitting) onClose();
  };

  return (
    <Dialog
      isOpen
      onClose={close}
      title={c.title}
      size="full"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" disabled={submitting} onClick={close}>
            {commonCopy[locale].cancel}
          </Button>
          <Button type="button" variant={replace && existingCount > 0 ? "danger" : "primary"} icon="upload" disabled={!canImport} loading={submitting} onClick={() => void submit()}>
            {submitting ? c.importing : replace ? c.replaceWith(fmt(rows.length)) : c.importN(fmt(rows.length))}
          </Button>
        </div>
      }
    >
      <div data-testid="timetable-import" className="space-y-5">
        <p className="flex flex-wrap items-center gap-x-2 text-body-sm text-text-secondary">
          <span>{c.help}</span>
          <button type="button" onClick={downloadTemplate} className="inline-flex min-h-11 cursor-pointer items-center gap-1 font-semibold text-action-primary hover:underline">
            <Icon name="download" size={16} />
            {c.sample}
          </button>
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <label
            htmlFor={fileInputId}
            className="inline-flex min-h-(--control-md) cursor-pointer items-center gap-2 rounded-control border border-dashed border-border-strong bg-surface-panel-subtle px-4 text-body-sm font-semibold text-text-primary transition-colors hover:border-action-primary focus-within:outline-2 focus-within:outline-focus-ring"
          >
            <Icon name="upload" size={18} />
            {c.choose}
            <input id={fileInputId} type="file" accept=".csv,text/csv" onChange={(e) => void handleFile(e)} className="sr-only" />
          </label>
          {fileName && (
            <span className="min-w-0 truncate text-body-sm text-text-secondary">
              <bdi dir="ltr">{fileName}</bdi>
            </span>
          )}
        </div>

        {readError && <FormAlert>{readError}</FormAlert>}
        {parsed && parsed.ok === false && <FormAlert>{fileErrorText(parsed)}</FormAlert>}

        {parsed?.ok && (
          <div className="space-y-4">
            <p role="status" className="flex flex-wrap items-center gap-2 text-body-sm text-text-secondary">
              <Badge variant={invalidRows.length ? "danger" : "success"} size="md">
                {invalidRows.length ? c.rowsInvalid(fmt(invalidRows.length), fmt(rows.length)) : c.rowsReady(fmt(rows.length))}
              </Badge>
              {parsed.ignoredColumns.length > 0 && (
                <span>
                  {c.ignoredColumns}
                  <bdi>{parsed.ignoredColumns.join(c.listSeparator)}</bdi>
                </span>
              )}
            </p>

            <div className="max-h-[26rem] overflow-auto rounded-control border border-border-default">
              <table className="w-full min-w-[40rem] border-collapse text-body-sm">
                <caption className="sr-only">{c.caption}</caption>
                <thead className="sticky top-0 bg-surface-panel-subtle text-meta text-text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-start font-semibold">#</th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold">{c.fields.title}</th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold">{c.fields.track}</th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold">{c.fields.hall}</th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold">{c.colTime}</th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold">{c.colStatus}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {rows.map((r) => (
                    <tr key={r.row} className={r.problems.length ? "bg-status-danger-bg/60" : undefined}>
                      <td className={`px-3 py-2 align-top ${codeFontClass(fmt(r.row))} text-meta text-text-muted tabular`}>
                        <span title={c.lineOfFile(fmt(r.line))}>{fmt(r.row)}</span>
                      </td>
                      <td className="max-w-[16rem] px-3 py-2 align-top font-semibold text-text-primary">
                        <bdi className="line-clamp-2 break-words">{r.values.title || "—"}</bdi>
                      </td>
                      <td className="px-3 py-2 align-top text-text-secondary">
                        <bdi>{r.values.track || "—"}</bdi>
                      </td>
                      <td className="px-3 py-2 align-top text-text-secondary">
                        <bdi>{r.values.hall || "—"}</bdi>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 align-top text-text-secondary">
                        {r.session ? (
                          <bdi className="tabular">{timeText(r.session.starts_at, r.session.ends_at)}</bdi>
                        ) : (
                          <bdi dir="ltr" className="font-mono text-meta">
                            {r.values.starts_at || "?"} → {r.values.ends_at || "?"}
                          </bdi>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {r.problems.length === 0 ? (
                          <Badge variant="success" size="sm">
                            {c.rowOk}
                          </Badge>
                        ) : (
                          <ul className="space-y-0.5 text-meta text-status-danger-text">
                            {r.problems.map((p) => (
                              <li key={`${p.code}-${"field" in p ? p.field : ""}`}>
                                {c.rowProblem(fmt(r.row), fmt(r.line))}
                                {problemText(p)}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {newHalls.length > 0 && invalidRows.length === 0 && (
              <p className="flex items-start gap-2 text-body-sm text-text-secondary">
                <Icon name="info" size={16} className="mt-0.5 shrink-0 text-status-info-text" />
                <span>
                  {c.newHalls}
                  <bdi>{newHalls.join(c.listSeparator)}</bdi>
                </span>
              </p>
            )}
          </div>
        )}

        <label htmlFor={replaceId} className="flex min-h-11 cursor-pointer items-start gap-3 text-body-sm text-text-primary">
          <input
            id={replaceId}
            type="checkbox"
            checked={replace}
            onChange={(e) => setReplace(e.target.checked)}
            className="mt-1 size-4 shrink-0 accent-aiteb-indigo"
          />
          <span>
            <span className="font-semibold">{c.replace}</span>
            <span className="block text-meta leading-relaxed text-text-muted">{replace ? c.replaceOn(fmt(existingCount)) : c.replaceOff}</span>
          </span>
        </label>

        {submitError && <FormAlert>{submitError}</FormAlert>}
        <p className="text-meta text-text-muted">
          {c.allOrNothing} {c.tooManyRows(fmt(MAX_SESSION_IMPORT_ROWS))}
        </p>
      </div>
    </Dialog>
  );
}
