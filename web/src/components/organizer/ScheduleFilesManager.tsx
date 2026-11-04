import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { apiErrorCode, isNetworkFailure, type ProgramFileOut } from "../../api/client";
import {
  MAX_PROGRAM_FILE_LABEL,
  MAX_PROGRAM_FILES,
  PROGRAM_FILE_TYPES,
  formatFileSize,
  labelFromFileName,
  precheckProgramFile,
  programFileErrorCode,
  reorderPatches,
  type ProgramFileErrorCode,
} from "../../lib/programFiles";
import { formatNumber } from "../../lib/format";
import { Badge } from "../ui/Badge";
import { Button, IconButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { Icon } from "../ui/Icon";
import { TextInput } from "../ui/Input";
import { RowActions } from "../ui/RowActions";
import { ErrorState } from "../ui/StateBlock";
import { FormAlert, Notice } from "./WorkspaceUi";
import { useEventWorkspace } from "./eventWorkspaceContext";
import { commonCopy } from "../../copy/common";
import { organizerProgramCopy } from "../../copy/organizerProgram";

/** Narrow with `"code" in result` (the app's tsconfig is not strict, so `ok` alone does not narrow). */
type Outcome<T> = { ok: true; value: T } | { ok: false; code: ProgramFileErrorCode };

/**
 * The screen's outcome of an organizer API call: the value, or the error code the copy maps to words. The calls
 * go through the workspace's API client, so a 401 reaches the console's key gate like every other request.
 */
function outcome<T>(res: { data?: T; error?: unknown; response: Response }, upload?: { contentType: string }): Outcome<T> {
  if (res.response.ok) return { ok: true, value: res.data as T };
  if (isNetworkFailure(res.response)) return { ok: false, code: "network" };
  return { ok: false, code: programFileErrorCode(res.response.status, apiErrorCode(res.error), upload) };
}

const byPosition = (a: ProgramFileOut, b: ProgramFileOut) =>
  a.position - b.position || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

/**
 * The congress schedule as files: upload a PDF or an image with a label, then reorder, show or hide and
 * delete. Visible files are live for attendees as soon as they are saved (no publish step, like the program).
 * Viewers and archived congresses only see and open the files.
 */
export function ScheduleFilesManager() {
  const { eventId, client, canEdit, locale } = useEventWorkspace();
  const c = organizerProgramCopy[locale].files;
  const common = commonCopy[locale];
  const [files, setFiles] = useState<ProgramFileOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ProgramFileErrorCode | null>(null);
  /** The file chosen for upload; the dialog is open while it is set. */
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<ProgramFileErrorCode | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [inputKey, setInputKey] = useState(0);
  /** Bumped to load the list again (retry, or after a failed reorder left it uncertain). */
  const [loadCount, setLoadCount] = useState(0);

  const path = { event_id: eventId };
  const reload = () => {
    setLoading(true);
    setLoadCount((n) => n + 1);
  };

  useEffect(() => {
    if (!client) return;
    let active = true;
    (async () => {
      const result = outcome(await client.GET("/api/events/{event_id}/program-files", { params: { path: { event_id: eventId } } }));
      if (!active) return;
      if ("code" in result) setLoadError(result.code);
      else {
        setLoadError(null);
        setFiles([...result.value].sort(byPosition));
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [client, eventId, loadCount]);

  const chooseFile = (e: ChangeEvent<HTMLInputElement>) => {
    const chosen = e.currentTarget.files?.[0] ?? null;
    setInputKey((k) => k + 1);
    if (!chosen) return;
    setFile(chosen);
    setLabel(labelFromFileName(chosen.name));
    setUploadError(null);
  };

  const closeDialog = () => {
    if (uploading) return;
    setFile(null);
    setUploadError(null);
  };

  const upload = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || !client) return;
    const problem = precheckProgramFile(file, label);
    if (problem) {
      setUploadError(problem);
      return;
    }
    setUploading(true);
    setUploadError(null);
    const result = outcome(
      await client.POST("/api/events/{event_id}/program-files", {
        params: { path, query: { label: label.trim() }, header: { "content-type": file.type } },
        // The body is the file itself, sent as is.
        body: file as unknown as string,
        bodySerializer: (body: unknown) => body as BodyInit,
      }),
      { contentType: file.type },
    );
    setUploading(false);
    if ("code" in result) {
      setUploadError(result.code);
      return;
    }
    const saved = result.value;
    setFiles((prev) => [...prev, saved].sort(byPosition));
    setFile(null);
    setNotice({ tone: "ok", text: c.uploaded(saved.label) });
  };

  const fail = (code: ProgramFileErrorCode, what: string) => setNotice({ tone: "error", text: `${what} ${c.errors[code]}` });

  const update = async (item: ProgramFileOut, body: { is_visible?: boolean; position?: number }): Promise<Outcome<ProgramFileOut>> =>
    client
      ? outcome(await client.PATCH("/api/events/{event_id}/program-files/{file_id}", { params: { path: { event_id: eventId, file_id: item.id } }, body }))
      : { ok: false, code: "server" };

  const toggleVisible = async (item: ProgramFileOut) => {
    setBusyId(item.id);
    const result = await update(item, { is_visible: !item.is_visible });
    setBusyId(null);
    if ("code" in result) return fail(result.code, c.visibilityFailed);
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
      const target = files.find((f) => f.id === patch.id);
      if (!target) continue;
      const result = await update(target, { position: patch.position });
      if ("code" in result) {
        setBusyId(null);
        fail(result.code, c.orderFailed);
        return reload();
      }
      updated = updated.map((f) => (f.id === result.value.id ? result.value : f));
    }
    setBusyId(null);
    setFiles([...updated].sort(byPosition));
  };

  const remove = async (item: ProgramFileOut) => {
    if (!client) return;
    setBusyId(item.id);
    const result = outcome(
      await client.DELETE("/api/events/{event_id}/program-files/{file_id}", { params: { path: { event_id: eventId, file_id: item.id } } }),
    );
    setBusyId(null);
    if ("code" in result) return fail(result.code, c.deleteFailed);
    setFiles((prev) => prev.filter((f) => f.id !== item.id));
    setNotice({ tone: "ok", text: c.deleted(item.label) });
  };

  const open = async (item: ProgramFileOut) => {
    if (!client) return;
    // Opened before the await so the browser treats it as a direct result of the click (no popup block).
    const tab = window.open("", "_blank");
    const { data, response } = await client.GET("/api/events/{event_id}/program-files/{file_id}/content", {
      params: { path: { event_id: eventId, file_id: item.id } },
      parseAs: "blob",
    });
    if (response.ok && data instanceof Blob && tab) tab.location.href = URL.createObjectURL(data);
    else {
      tab?.close();
      setNotice({ tone: "error", text: c.openFailed });
    }
  };

  const meta = (item: ProgramFileOut) => {
    const size = formatFileSize(item.byte_size, locale);
    if (item.kind === "pdf") return ["PDF", item.page_count ? c.pages(formatNumber(item.page_count, locale)) : "", size].filter(Boolean).join(" · ");
    const dims = item.width && item.height ? `${formatNumber(item.width, locale)}×${formatNumber(item.height, locale)}` : "";
    return [c.image, dims, size].filter(Boolean).join(" · ");
  };

  const full = files.length >= MAX_PROGRAM_FILES;

  return (
    <section aria-label={organizerProgramCopy[locale].tabs.files} data-testid="schedule-files" className="space-y-5">
      {canEdit && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="text-meta text-text-muted">{full ? c.errors.limit_reached : c.hint}</span>
          <label
            className={`inline-flex min-h-(--control-md) items-center gap-2 rounded-control bg-action-primary px-4 text-body-sm font-semibold text-text-inverse shadow-soft focus-within:outline-2 focus-within:outline-focus-ring ${
              full ? "cursor-not-allowed opacity-55" : "cursor-pointer hover:bg-action-hover"
            }`}
          >
            <Icon name="upload" size={18} />
            {c.upload}
            <input
              key={inputKey}
              type="file"
              accept={`.pdf,${PROGRAM_FILE_TYPES.join(",")}`}
              onChange={chooseFile}
              className="sr-only"
              disabled={full}
            />
          </label>
        </div>
      )}

      {notice && (
        <Notice tone={notice.tone} onDismiss={() => setNotice(null)} dismissLabel={common.dismissMessage}>
          {notice.text}
        </Notice>
      )}

      {loading ? (
        <div role="status" aria-label={common.loading} className="skeleton h-20 rounded-card" />
      ) : loadError ? (
        <ErrorState title={c.loadFailed} onRetry={reload} retryLabel={common.retry}>
          <p>{c.errors[loadError]}</p>
        </ErrorState>
      ) : files.length === 0 ? (
        <p className="text-body-sm text-text-muted">{c.empty}</p>
      ) : (
        <ol className="divide-y divide-border-subtle overflow-hidden rounded-card border border-border-default bg-surface-panel">
          {files.map((item, index) => (
            <li key={item.id} data-testid="schedule-file" className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Icon name={item.kind === "pdf" ? "file" : "image"} size={20} className="shrink-0 text-text-muted" />
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="flex flex-wrap items-center gap-2 text-body-sm font-semibold text-text-primary">
                  <bdi className="break-words">{item.label}</bdi>
                  {!item.is_visible && (
                    <Badge variant="neutral" size="sm" icon={<Icon name="eye-off" size={11} />}>
                      {c.hidden}
                    </Badge>
                  )}
                </p>
                <p className="text-meta text-text-muted">
                  <bdi>{meta(item)}</bdi>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {canEdit && (
                  <>
                    <IconButton icon="arrow-up" size="sm" label={c.moveUp(item.label)} disabled={busyId !== null || index === 0} onClick={() => void move(item, -1)} />
                    <IconButton
                      icon="arrow-down"
                      size="sm"
                      label={c.moveDown(item.label)}
                      disabled={busyId !== null || index === files.length - 1}
                      onClick={() => void move(item, 1)}
                    />
                  </>
                )}
                <RowActions
                  visible={canEdit ? 2 : 1}
                  menuLabel={c.more(item.label)}
                  actions={[
                    { label: c.open, icon: "arrow-up-right", onSelect: () => void open(item) },
                    ...(canEdit
                      ? [
                          { label: item.is_visible ? c.hide : c.show, icon: item.is_visible ? ("eye-off" as const) : ("eye" as const), disabled: busyId !== null, onSelect: () => void toggleVisible(item) },
                          {
                            label: common.delete,
                            icon: "trash" as const,
                            disabled: busyId !== null,
                            onSelect: () => void remove(item),
                            destructive: { title: c.deleteTitle(item.label), description: c.deleteBody, confirmLabel: common.delete },
                          },
                        ]
                      : []),
                  ]}
                />
              </div>
            </li>
          ))}
        </ol>
      )}

      {file && (
        <Dialog
          isOpen
          onClose={closeDialog}
          title={c.dialogTitle}
          size="sm"
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" disabled={uploading} onClick={closeDialog}>
                {common.cancel}
              </Button>
              <Button type="submit" form="schedule-file-form" variant="primary" icon="upload" loading={uploading}>
                {uploading ? c.uploading : c.submit}
              </Button>
            </div>
          }
        >
          <form id="schedule-file-form" onSubmit={(e) => void upload(e)} className="space-y-4" noValidate>
            <p className="flex min-w-0 items-center gap-2 text-body-sm text-text-secondary">
              <Icon name={file.type === "application/pdf" ? "file" : "image"} size={18} className="shrink-0" />
              <bdi dir="ltr" className="truncate">
                {file.name}
              </bdi>
            </p>
            <Field label={c.label} required>
              <TextInput value={label} maxLength={MAX_PROGRAM_FILE_LABEL} onChange={(e) => setLabel(e.target.value)} placeholder={c.labelPlaceholder} />
            </Field>
            {uploadError && <FormAlert>{c.errors[uploadError]}</FormAlert>}
          </form>
        </Dialog>
      )}
    </section>
  );
}
