import { useEffect, useId, useState, type ChangeEvent, type FormEvent } from "react";
import type { ProgramFileOut } from "../../api/lifecycleTypes";
import { formatLocalizedNumber } from "../../lib/i18n";
import {
  MAX_PROGRAM_FILE_LABEL,
  MAX_PROGRAM_FILES,
  PROGRAM_FILE_TYPES,
  deleteProgramFile,
  formatFileSize,
  labelFromFileName,
  listProgramFiles,
  precheckProgramFile,
  programFileObjectUrl,
  reorderPatches,
  updateProgramFile,
  uploadProgramFile,
  type ProgramFileErrorCode,
} from "../../lib/programFiles";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Icon } from "../ui/Icon";
import { FormAlert, Notice } from "./WorkspaceUi";

interface ScheduleFilesManagerProps {
  apiKey: string;
  eventId: string;
  locale: "fa" | "en";
  isRtl: boolean;
  /** Called with every response status, so the layout can drop a rejected organizer key. */
  onStatus: (status: number) => void;
}

const ERROR_COPY: Record<ProgramFileErrorCode, { fa: string; en: string }> = {
  unsupported_type: { fa: "فقط فایل PDF یا تصویر PNG، JPEG یا WebP پذیرفته می‌شود.", en: "Upload a PDF, or a PNG, JPEG or WebP image." },
  too_large: { fa: "حجم فایل برنامه حداکثر ۸ مگابایت است.", en: "Schedule files are limited to 8 MB." },
  empty: { fa: "فایل خالی است.", en: "The file is empty." },
  rejected_pdf: {
    fa: "این PDF پذیرفته نشد: یا PDF معتبر نیست یا اسکریپت، فایل پیوست یا فرم فعال دارد. آن را دوباره «چاپ به PDF» کنید.",
    en: "This PDF was refused: it is not a valid PDF, or it has scripts, attachments or active forms. Print it to PDF again.",
  },
  rejected_image: { fa: "این تصویر خوانده نشد یا ابعادش بیش از حد مجاز است.", en: "This image could not be read or is too large in pixels." },
  label_required: { fa: "برای فایل یک عنوان بنویسید.", en: "Give the file a label." },
  limit_reached: { fa: `هر همایش حداکثر ${formatLocalizedNumber(MAX_PROGRAM_FILES, "fa")} فایل برنامه دارد؛ ابتدا یکی را حذف کنید.`, en: `An event can have at most ${MAX_PROGRAM_FILES} schedule files; delete one first.` },
  archived: { fa: "این همایش بایگانی شده و قابل ویرایش نیست.", en: "This event is archived and read-only." },
  not_found: { fa: "این فایل دیگر وجود ندارد؛ صفحه را تازه کنید.", en: "This file no longer exists; refresh the page." },
  unauthorized: { fa: "کلید برگزارکننده پذیرفته نشد.", en: "The organizer key was not accepted." },
  network: { fa: "اتصال به سرور برقرار نشد.", en: "Could not reach the server." },
  server: { fa: "خطای سرور؛ دوباره تلاش کنید.", en: "Server error; please try again." },
};

const byPosition = (a: ProgramFileOut, b: ProgramFileOut) =>
  a.position - b.position || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

/**
 * The congress schedule as files: upload a PDF or an image with a label, then reorder, show or hide and
 * delete. Visible files are live for attendees as soon as they are saved (no publish step, like the program).
 */
export function ScheduleFilesManager({ apiKey, eventId, locale, isRtl, onStatus }: ScheduleFilesManagerProps) {
  const labelId = useId();
  const fileId = useId();
  const lang = isRtl ? "fa" : "en";
  const [files, setFiles] = useState<ProgramFileOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ProgramFileErrorCode | null>(null);
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<ProgramFileErrorCode | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProgramFileOut | null>(null);
  const [inputKey, setInputKey] = useState(0);

  const errorText = (code: ProgramFileErrorCode) => ERROR_COPY[code][lang];

  /** Bumped to load the list again (retry, or after a failed reorder left it uncertain). */
  const [loadCount, setLoadCount] = useState(0);
  const reload = () => {
    setLoading(true);
    setLoadCount((n) => n + 1);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      const result = await listProgramFiles(apiKey, eventId);
      if (!active) return;
      if ("code" in result) {
        onStatus(result.status);
        setLoadError(result.code);
      } else {
        setLoadError(null);
        setFiles([...result.value].sort(byPosition));
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [apiKey, eventId, onStatus, loadCount]);

  const chooseFile = (e: ChangeEvent<HTMLInputElement>) => {
    const chosen = e.currentTarget.files?.[0] ?? null;
    setFile(chosen);
    setUploadError(null);
    if (chosen && !label.trim()) setLabel(labelFromFileName(chosen.name));
  };

  const upload = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    const problem = precheckProgramFile(file, label);
    if (problem) {
      setUploadError(problem);
      return;
    }
    setUploading(true);
    setUploadError(null);
    const result = await uploadProgramFile(apiKey, eventId, file, label);
    setUploading(false);
    if ("code" in result) {
      onStatus(result.status);
      setUploadError(result.code);
      return;
    }
    const saved = result.value;
    setFiles((prev) => [...prev, saved].sort(byPosition));
    setFile(null);
    setLabel("");
    setInputKey((k) => k + 1);
    setNotice({ tone: "ok", text: isRtl ? `فایل «${saved.label}» بارگذاری شد.` : `“${saved.label}” uploaded.` });
  };

  const fail = (status: number, code: ProgramFileErrorCode, what: { fa: string; en: string }) => {
    onStatus(status);
    setNotice({ tone: "error", text: `${what[lang]} ${errorText(code)}` });
  };

  const toggleVisible = async (item: ProgramFileOut) => {
    setBusyId(item.id);
    const result = await updateProgramFile(apiKey, eventId, item.id, { is_visible: !item.is_visible });
    setBusyId(null);
    if ("code" in result) return fail(result.status, result.code, { fa: "تغییر نمایش انجام نشد.", en: "Visibility was not changed." });
    const saved = result.value;
    setFiles((prev) => prev.map((f) => (f.id === saved.id ? saved : f)));
  };

  const move = async (item: ProgramFileOut, delta: -1 | 1) => {
    const ids = files.map((f) => f.id);
    const from = ids.indexOf(item.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    setBusyId(item.id);
    let updated = files;
    for (const patch of reorderPatches(files, ids)) {
      const result = await updateProgramFile(apiKey, eventId, patch.id, { position: patch.position });
      if ("code" in result) {
        setBusyId(null);
        fail(result.status, result.code, { fa: "ترتیب ذخیره نشد.", en: "The order was not saved." });
        return reload();
      }
      updated = updated.map((f) => (f.id === result.value.id ? result.value : f));
    }
    setBusyId(null);
    setFiles([...updated].sort(byPosition));
  };

  const remove = async (item: ProgramFileOut) => {
    setBusyId(item.id);
    const result = await deleteProgramFile(apiKey, eventId, item.id);
    setBusyId(null);
    if ("code" in result) return fail(result.status, result.code, { fa: "فایل حذف نشد.", en: "The file was not deleted." });
    setFiles((prev) => prev.filter((f) => f.id !== item.id));
    setNotice({ tone: "ok", text: isRtl ? `فایل «${item.label}» حذف شد.` : `“${item.label}” deleted.` });
  };

  const open = async (item: ProgramFileOut) => {
    // Opened before the await so the browser treats it as a direct result of the click (no popup block).
    const tab = window.open("", "_blank");
    const url = await programFileObjectUrl(apiKey, item);
    if (url && tab) tab.location.href = url;
    else {
      tab?.close();
      setNotice({ tone: "error", text: isRtl ? "فایل باز نشد." : "The file could not be opened." });
    }
  };

  const meta = (item: ProgramFileOut) => {
    const size = formatFileSize(item.byte_size, locale);
    if (item.kind === "pdf") {
      const pages = item.page_count ? (isRtl ? ` · ${formatLocalizedNumber(item.page_count, locale)} صفحه` : ` · ${item.page_count} page${item.page_count === 1 ? "" : "s"}`) : "";
      return `PDF${pages} · ${size}`;
    }
    const dims = item.width && item.height ? ` · ${formatLocalizedNumber(item.width, locale)}×${formatLocalizedNumber(item.height, locale)}` : "";
    return `${isRtl ? "تصویر" : "Image"}${dims} · ${size}`;
  };

  const full = files.length >= MAX_PROGRAM_FILES;

  return (
    <section aria-labelledby="schedule-files-title" data-testid="schedule-files" className="space-y-5 shape-arc border border-border-default bg-surface-panel p-5 shadow-soft sm:p-7">
      <div className="space-y-1.5">
        <h2 id="schedule-files-title" className="flex items-center gap-2 text-base font-bold text-text-primary">
          <Icon name="file" size={18} className="text-aiteb-indigo/70" />
          {isRtl ? "فایل‌های برنامه" : "Schedule files"}
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-text-secondary">
          {isRtl
            ? "برنامهٔ همایش را به‌صورت PDF یا تصویر (PNG، JPEG یا WebP، حداکثر ۸ مگابایت) هم در اختیار شرکت‌کنندگان بگذارید. فایل‌های قابل مشاهده بلافاصله در صفحهٔ همایش و جزئیات همایش نمایش داده می‌شوند."
            : "Share the congress program as a PDF or an image too (PNG, JPEG or WebP, up to 8 MB). Visible files appear on the congress page and the congress details right away."}
        </p>
      </div>

      {notice && (
        <Notice tone={notice.tone} onDismiss={() => setNotice(null)} dismissLabel={isRtl ? "بستن پیام" : "Dismiss message"}>
          {notice.text}
        </Notice>
      )}

      <form onSubmit={(e) => void upload(e)} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
        <div>
          <label htmlFor={labelId} className="ui-label">
            {isRtl ? "عنوان فایل" : "Label"}
          </label>
          <input
            id={labelId}
            className="ui-input"
            value={label}
            maxLength={MAX_PROGRAM_FILE_LABEL}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={isRtl ? "مثلاً برنامهٔ روز اول" : "e.g. Day 1 programme"}
            disabled={full}
          />
        </div>
        <label
          htmlFor={fileId}
          className="inline-flex min-h-[44px] max-w-full cursor-pointer items-center gap-2 rounded-[10px] border border-dashed border-border-strong bg-surface-panel-subtle px-4 text-sm font-semibold text-text-primary transition-colors hover:border-action-primary focus-within:outline-2 focus-within:outline-focus-ring"
        >
          <Icon name="upload" size={18} />
          <span className="min-w-0 truncate">{file ? <bdi dir="ltr">{file.name}</bdi> : isRtl ? "انتخاب PDF یا تصویر" : "Choose a PDF or image"}</span>
          <input
            key={inputKey}
            id={fileId}
            type="file"
            accept={`.pdf,${PROGRAM_FILE_TYPES.join(",")}`}
            onChange={chooseFile}
            className="sr-only"
            disabled={full}
          />
        </label>
        <Button type="submit" variant="primary" size="md" disabled={!file || uploading || full}>
          <Icon name="upload" size={18} />
          {uploading ? (isRtl ? "در حال بارگذاری…" : "Uploading…") : isRtl ? "بارگذاری" : "Upload"}
        </Button>
      </form>
      {full && <p className="text-xs text-text-muted">{errorText("limit_reached")}</p>}
      {uploadError && <FormAlert>{errorText(uploadError)}</FormAlert>}

      {loading ? (
        <div role="status" aria-label={isRtl ? "در حال بارگذاری فایل‌ها" : "Loading files"} className="skeleton h-20" />
      ) : loadError ? (
        <div className="space-y-3">
          <FormAlert>{`${isRtl ? "فهرست فایل‌ها بارگذاری نشد." : "The files could not be loaded."} ${errorText(loadError)}`}</FormAlert>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={reload}
          >
            <Icon name="sync" size={16} />
            {isRtl ? "تلاش دوباره" : "Try again"}
          </Button>
        </div>
      ) : files.length === 0 ? (
        <p className="text-sm text-text-muted">{isRtl ? "هنوز فایلی بارگذاری نشده است." : "No schedule file yet."}</p>
      ) : (
        <ol className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-default">
          {files.map((item, index) => (
            <li key={item.id} data-testid="schedule-file" className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Icon name={item.kind === "pdf" ? "file" : "image"} size={20} className="shrink-0 text-text-muted" />
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-text-primary">
                  <bdi className="break-words">{item.label}</bdi>
                  {!item.is_visible && (
                    <Badge variant="neutral" size="sm" icon={<Icon name="eye-off" size={11} />}>
                      {isRtl ? "پنهان" : "Hidden"}
                    </Badge>
                  )}
                </p>
                <p className="text-xs text-text-muted">
                  <bdi>{meta(item)}</bdi>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => void open(item)} aria-label={isRtl ? `باز کردن ${item.label}` : `Open ${item.label}`}>
                  <Icon name="arrow-up-right" size={16} />
                  <span>{isRtl ? "مشاهده" : "Open"}</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busyId !== null || index === 0}
                  onClick={() => void move(item, -1)}
                  aria-label={isRtl ? `انتقال ${item.label} به بالا` : `Move ${item.label} up`}
                >
                  <Icon name="arrow-up" size={16} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busyId !== null || index === files.length - 1}
                  onClick={() => void move(item, 1)}
                  aria-label={isRtl ? `انتقال ${item.label} به پایین` : `Move ${item.label} down`}
                >
                  <Icon name="arrow-down" size={16} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busyId !== null}
                  onClick={() => void toggleVisible(item)}
                  aria-label={item.is_visible ? (isRtl ? `پنهان کردن ${item.label}` : `Hide ${item.label}`) : isRtl ? `نمایش ${item.label}` : `Show ${item.label}`}
                >
                  <Icon name={item.is_visible ? "eye-off" : "eye"} size={16} />
                  <span>{item.is_visible ? (isRtl ? "پنهان" : "Hide") : isRtl ? "نمایش" : "Show"}</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busyId !== null}
                  onClick={() => setDeleteTarget(item)}
                  aria-label={isRtl ? `حذف ${item.label}` : `Delete ${item.label}`}
                >
                  <Icon name="trash" size={16} />
                  <span>{isRtl ? "حذف" : "Delete"}</span>
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        tone="danger"
        title={isRtl ? "حذف این فایل؟" : "Delete this file?"}
        description={
          deleteTarget
            ? isRtl
              ? `«${deleteTarget.label}» از صفحهٔ همایش و جزئیات همایش حذف می‌شود.`
              : `“${deleteTarget.label}” is removed from the congress page and the congress details.`
            : ""
        }
        confirmLabel={isRtl ? "حذف فایل" : "Delete file"}
        cancelLabel={isRtl ? "انصراف" : "Cancel"}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (target) void remove(target);
        }}
      />
    </section>
  );
}
