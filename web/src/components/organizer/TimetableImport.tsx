import React, { useId, useMemo, useState } from "react";
import type { EventSessionImport, EventSessionImportOut, VenuePlaceOut } from "../../api/client";
import { formatLocalizedNumber } from "../../lib/i18n";
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
import { Icon } from "../ui/Icon";
import { FormAlert } from "./WorkspaceUi";
import { sessionDateFormats } from "./sessionTime";

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
  isRtl: boolean;
  onImport: (body: EventSessionImport) => Promise<{ result?: EventSessionImportOut; error?: string }>;
  onDone: (result: EventSessionImportOut) => void;
  onCancel: () => void;
}

const MAX_FILE_BYTES = 2_000_000;

const FIELD_LABEL: Record<SessionCsvField, { fa: string; en: string }> = {
  title: { fa: "عنوان", en: "Title" },
  track: { fa: "نوع", en: "Track" },
  hall: { fa: "سالن", en: "Hall" },
  speakers: { fa: "سخنرانان", en: "Speakers" },
  description: { fa: "توضیحات", en: "Description" },
  starts_at: { fa: "شروع", en: "Start" },
  ends_at: { fa: "پایان", en: "End" },
};

/** Decodes the file as UTF-8, falling back to Windows-1256 (Excel's legacy "CSV" for Persian). */
function decodeCsv(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1256").decode(bytes);
  }
}

export function TimetableImport({ existingCount, halls, templateDay, fileBase, timeZone, locale, isRtl, onImport, onDone, onCancel }: TimetableImportProps) {
  const fileInputId = useId();
  const replaceId = useId();
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<SessionCsvResult | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fmt = (n: number) => formatLocalizedNumber(n, locale);
  const sessionsEn = (n: number) => `${n} ${n === 1 ? "session" : "sessions"}`;
  const lang = isRtl ? "fa" : "en";
  const formats = useMemo(() => sessionDateFormats(locale, timeZone), [locale, timeZone]);

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
      setReadError(isRtl ? "حجم فایل بیش از ۲ مگابایت است." : "The file is larger than 2 MB.");
      return;
    }
    try {
      setParsed(parseSessionCsv(decodeCsv(await file.arrayBuffer()), { timeZone }));
    } catch {
      setReadError(isRtl ? "فایل خوانده نشد." : "The file could not be read.");
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
    else setSubmitError(error ?? (isRtl ? "برنامه وارد نشد." : "The timetable was not imported."));
  };

  const fieldName = (field: SessionCsvField) => FIELD_LABEL[field][lang];
  const problemText = (p: SessionRowProblem): string => {
    switch (p.code) {
      case "required":
        return isRtl ? `${fieldName(p.field)} خالی است` : `${fieldName(p.field)} is empty`;
      case "too_long":
        return isRtl ? `${fieldName(p.field)} بیش از ${fmt(p.max)} نویسه است` : `${fieldName(p.field)} is longer than ${p.max} characters`;
      case "invalid_date":
        return isRtl
          ? `${fieldName(p.field)} تاریخ معتبر نیست (نمونه: 1405/08/11 09:00 یا 2026-11-02 09:00)`
          : `${fieldName(p.field)} is not a valid date (e.g. 2026-11-02 09:00 or 1405/08/11 09:00)`;
      case "ends_before_start":
        return isRtl ? "پایان باید بعد از شروع باشد" : "must end after it starts";
    }
  };

  const fileErrorText = (result: Exclude<SessionCsvResult, { ok: true }>): string => {
    switch (result.error) {
      case "no_rows":
        return isRtl ? "در این فایل هیچ جلسه‌ای پیدا نشد." : "No session was found in this file.";
      case "missing_columns":
        return isRtl
          ? `ستون‌های ضروری در سطر عنوان پیدا نشد: ${result.missing.map((f) => `${fieldName(f)} (${f})`).join("، ")}`
          : `Required columns are missing from the header row: ${result.missing.map((f) => `${fieldName(f)} (${f})`).join(", ")}`;
      case "too_many_rows":
        return isRtl
          ? `این فایل ${fmt(result.count)} جلسه دارد؛ در هر بارگذاری حداکثر ${fmt(result.max)} جلسه پذیرفته می‌شود.`
          : `This file has ${result.count} sessions; at most ${result.max} can be uploaded at once.`;
      case "unterminated_quote":
        return isRtl
          ? `علامت نقل‌قولی که در خط ${fmt(result.line)} باز شده بسته نشده است.`
          : `A quotation mark opened on line ${result.line} is never closed.`;
    }
  };

  const timeText = (startIso: string, endIso: string) => {
    const start = new Date(startIso);
    const end = new Date(endIso);
    const sameDay = formats.shortDay.format(start) === formats.shortDay.format(end);
    return `${formats.shortDay.format(start)} ${formats.time.format(start)} – ${sameDay ? "" : `${formats.shortDay.format(end)} `}${formats.time.format(end)}`;
  };

  return (
    <section
      aria-labelledby="timetable-import-title"
      data-testid="timetable-import"
      className="space-y-5 shape-arc border border-border-default bg-surface-panel p-5 shadow-soft sm:p-7"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <h2 id="timetable-import-title" className="text-base font-bold text-text-primary">
            {isRtl ? "بارگذاری جدول زمانی (CSV)" : "Upload a timetable (CSV)"}
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-text-secondary">
            {isRtl
              ? `در اکسل یک سطر عنوان و برای هر جلسه یک سطر بنویسید و با «CSV UTF-8» ذخیره کنید. ستون‌ها: title (عنوان)، track (نوع)، hall (سالن)، speakers (سخنرانان)، description (توضیحات)، starts_at (شروع) و ends_at (پایان). تاریخ‌ها شمسی یا میلادی، مانند 1405/08/11 09:00 یا 2026-11-02 09:00 (قالب 11/2/2026 9:00 اکسل هم پذیرفته می‌شود)، به وقت همایش (${timeZone}). سالن‌هایی که هنوز تعریف نشده‌اند ساخته می‌شوند.`
              : `Write one header row and one row per session in Excel, then save as “CSV UTF-8”. Columns: title, track, hall, speakers, description, starts_at and ends_at. Dates are Gregorian or Solar Hijri, like 2026-11-02 09:00 or 1405/08/11 09:00 (Excel's 11/2/2026 9:00 works too), in the congress time zone (${timeZone}). Halls that don't exist yet are created.`}
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={downloadTemplate}>
          <Icon name="download" size={16} />
          {isRtl ? "دریافت فایل نمونه" : "Download template"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor={fileInputId}
          className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-[10px] border border-dashed border-border-strong bg-surface-panel-subtle px-4 text-sm font-semibold text-text-primary transition-colors hover:border-action-primary focus-within:outline-2 focus-within:outline-focus-ring"
        >
          <Icon name="upload" size={18} />
          {isRtl ? "انتخاب فایل CSV" : "Choose a CSV file"}
          <input id={fileInputId} type="file" accept=".csv,text/csv" onChange={(e) => void handleFile(e)} className="sr-only" />
        </label>
        {fileName && (
          <span className="min-w-0 truncate text-sm text-text-secondary">
            <bdi dir="ltr">{fileName}</bdi>
          </span>
        )}
      </div>

      {readError && <FormAlert>{readError}</FormAlert>}
      {parsed && parsed.ok === false && <FormAlert>{fileErrorText(parsed)}</FormAlert>}

      {parsed?.ok && (
        <div className="space-y-4">
          <p role="status" className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
            <Badge variant={invalidRows.length ? "danger" : "success"} size="md">
              {invalidRows.length
                ? isRtl
                  ? `${fmt(invalidRows.length)} سطر از ${fmt(rows.length)} سطر ایراد دارد`
                  : `${invalidRows.length} of ${rows.length} rows need fixing`
                : isRtl
                  ? `${fmt(rows.length)} جلسه آمادهٔ ورود`
                  : `${sessionsEn(rows.length)} ready to import`}
            </Badge>
            {parsed.ignoredColumns.length > 0 && (
              <span>
                {isRtl ? "ستون‌های نادیده گرفته‌شده: " : "Ignored columns: "}
                <bdi>{parsed.ignoredColumns.join(isRtl ? "، " : ", ")}</bdi>
              </span>
            )}
          </p>

          <div className="max-h-[26rem] overflow-auto rounded-xl border border-border-default">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <caption className="sr-only">{isRtl ? "پیش‌نمایش جلسه‌های فایل" : "Preview of the file's sessions"}</caption>
              <thead className="sticky top-0 bg-surface-panel-subtle text-xs text-text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">#</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">{FIELD_LABEL.title[lang]}</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">{FIELD_LABEL.track[lang]}</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">{FIELD_LABEL.hall[lang]}</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">{isRtl ? "زمان" : "Time"}</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">{isRtl ? "وضعیت" : "Status"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {rows.map((r) => (
                  <tr key={r.row} className={r.problems.length ? "bg-status-danger-bg/60" : undefined}>
                    <td className="px-3 py-2 align-top font-mono text-xs text-text-muted">
                      <span title={isRtl ? `خط ${r.line} فایل` : `Line ${r.line} of the file`}>{fmt(r.row)}</span>
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
                        <bdi dir="ltr" className="font-mono text-xs">
                          {r.values.starts_at || "?"} → {r.values.ends_at || "?"}
                        </bdi>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {r.problems.length === 0 ? (
                        <Badge variant="success" size="sm">{isRtl ? "درست" : "OK"}</Badge>
                      ) : (
                        <ul className="space-y-0.5 text-xs text-status-danger-text">
                          {r.problems.map((p) => (
                            <li key={`${p.code}-${"field" in p ? p.field : ""}`}>
                              {isRtl ? `سطر ${fmt(r.row)} (خط ${fmt(r.line)}): ` : `Row ${r.row} (line ${r.line}): `}
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
            <p className="flex items-start gap-2 text-sm text-text-secondary">
              <Icon name="info" size={16} className="mt-0.5 shrink-0 text-status-info-text" />
              <span>
                {isRtl ? "این سالن‌ها ساخته می‌شوند: " : "These halls will be created: "}
                <bdi>{newHalls.join(isRtl ? "، " : ", ")}</bdi>
              </span>
            </p>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor={replaceId} className="flex min-h-[40px] cursor-pointer items-start gap-3 text-sm text-text-primary">
          <input
            id={replaceId}
            type="checkbox"
            checked={replace}
            onChange={(e) => setReplace(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-aiteb-indigo"
          />
          <span>
            <span className="font-semibold">{isRtl ? "جایگزینی برنامهٔ فعلی" : "Replace the existing program"}</span>
            <span className="block text-xs leading-relaxed text-text-muted">
              {replace
                ? isRtl
                  ? `${fmt(existingCount)} جلسهٔ فعلی حذف و جلسه‌های این فایل جایگزین آن‌ها می‌شوند.`
                  : `The ${existingCount} existing sessions are deleted and replaced by this file's sessions.`
                : isRtl
                  ? "بدون این گزینه، جلسه‌های فایل به برنامهٔ فعلی اضافه می‌شوند."
                  : "Without this option, the file's sessions are added to the current program."}
            </span>
          </span>
        </label>
      </div>

      {submitError && <FormAlert>{submitError}</FormAlert>}

      <div className="flex flex-col-reverse gap-2 border-t border-border-subtle pt-5 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" size="md" disabled={submitting} onClick={onCancel}>
          {isRtl ? "انصراف" : "Cancel"}
        </Button>
        <Button type="button" variant={replace && existingCount > 0 ? "danger" : "primary"} size="md" disabled={!canImport} onClick={() => void submit()}>
          <Icon name="upload" size={18} />
          {submitting
            ? isRtl
              ? "در حال ورود…"
              : "Importing…"
            : replace
              ? isRtl
                ? `جایگزینی با ${fmt(rows.length)} جلسه`
                : `Replace with ${sessionsEn(rows.length)}`
              : isRtl
                ? `افزودن ${fmt(rows.length)} جلسه`
                : `Import ${sessionsEn(rows.length)}`}
        </Button>
      </div>
      <p className="text-xs text-text-muted">
        {isRtl
          ? `ورود همه یا هیچ است: اگر حتی یک سطر رد شود، هیچ جلسه‌ای ذخیره نمی‌شود. حداکثر ${fmt(MAX_SESSION_IMPORT_ROWS)} جلسه در هر بارگذاری.`
          : `Importing is all-or-nothing: if any row is rejected, nothing is saved. Up to ${MAX_SESSION_IMPORT_ROWS} sessions per upload.`}
      </p>
    </section>
  );
}
