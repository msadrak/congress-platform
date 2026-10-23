import { useRef, useState } from "react";
import type { MediaAssetOut } from "../../../api/client";
import type { PageImages } from "../../../lib/pageDocument";
import { ACCEPTED_IMAGE_TYPES } from "../../../lib/pageMedia";
import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { Dialog } from "../../ui/Dialog";
import { Icon } from "../../ui/Icon";
import { FormAlert } from "../WorkspaceUi";
import type { StudioCopy } from "./studioCopy";

interface MediaLibraryProps {
  isOpen: boolean;
  copy: StudioCopy;
  assets: MediaAssetOut[];
  images: PageImages;
  /** Ids used by the draft or the published page: they cannot be deleted. */
  inUse: ReadonlySet<string>;
  onUpload: (file: File) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
  onPick: (id: string) => void;
  onClose: () => void;
}

/** This congress's images: pick one, upload a new one (picked on success), delete unused ones. */
export function MediaLibrary({ isOpen, copy, assets, images, inUse, onUpload, onDelete, onPick, onClose }: MediaLibraryProps) {
  const m = copy.media;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const upload = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const failure = await onUpload(file);
      if (failure) setError(failure);
    } catch {
      setError(m.uploadFailed);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async (id: string) => {
    setDeleting(id);
    setError(null);
    try {
      const failure = await onDelete(id);
      if (failure) setError(failure);
    } catch {
      setError(m.deleteFailed);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={m.library} size="lg">
      <div className="space-y-5">
        <label
          data-over={over || undefined}
          onDragOver={(e) => e.preventDefault()}
          onDragEnter={(e) => {
            e.preventDefault();
            if (!busy) setOver(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            if (busy) return;
            void upload(e.dataTransfer.files[0]);
          }}
          className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-action-subtle-border bg-aiteb-lavender/40 px-4 py-6 text-center transition-colors hover:bg-aiteb-lavender has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus-ring data-[over]:border-aiteb-indigo data-[over]:bg-aiteb-lavender"
        >
          <input
            ref={input}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(",")}
            className="sr-only"
            disabled={busy}
            data-testid="page-image-input"
            onChange={(e) => void upload(e.target.files?.[0])}
          />
          <span className="grid size-11 place-items-center rounded-xl bg-surface-panel text-aiteb-indigo shadow-soft">
            <Icon name={busy ? "sync" : "upload"} size={20} className={busy ? "motion-safe:animate-spin" : ""} />
          </span>
          <span className="text-sm font-semibold text-aiteb-indigo">{busy ? m.uploading : m.upload}</span>
          <span className="text-xs text-text-muted">{m.uploadHint}</span>
        </label>

        {error && <FormAlert>{error}</FormAlert>}

        {assets.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-muted">{m.empty}</p>
        ) : (
          <ul className="grid max-h-[46vh] grid-cols-2 gap-3 overflow-y-auto pe-1 sm:grid-cols-3">
            {assets.map((asset) => {
              const url = images[asset.id]?.url;
              const used = inUse.has(asset.id);
              return (
                <li key={asset.id} className="group relative overflow-hidden rounded-xl border border-border-default bg-surface-panel-subtle">
                  <button
                    type="button"
                    onClick={() => onPick(asset.id)}
                    className="block w-full cursor-pointer focus-visible:outline-2 focus-visible:outline-focus-ring"
                    aria-label={`${m.use} (${asset.width}×${asset.height})`}
                  >
                    <span className="block aspect-[4/3] bg-[repeating-conic-gradient(var(--surface-panel-subtle)_0%_25%,var(--surface-panel)_0%_50%)] bg-[length:14px_14px]">
                      {url ? <img src={url} alt="" className="size-full object-contain" /> : <span className="block size-full animate-pulse" />}
                    </span>
                  </button>
                  <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                    <span className="font-mono text-caption text-text-muted tabular" dir="ltr">
                      {asset.width}×{asset.height}
                    </span>
                    {used ? (
                      <span className="text-caption font-semibold text-aiteb-indigo">{m.inUse}</span>
                    ) : (
                      <button
                        type="button"
                        title={m.delete}
                        aria-label={m.delete}
                        disabled={deleting === asset.id}
                        aria-busy={deleting === asset.id}
                        onClick={() => setConfirmDelete(asset.id)}
                        className="grid size-7 cursor-pointer place-items-center rounded-md text-text-muted hover:bg-status-danger-bg hover:text-status-danger-text disabled:cursor-wait disabled:opacity-50"
                      >
                        <Icon name={deleting === asset.id ? "sync" : "trash"} size={14} className={deleting === asset.id ? "motion-safe:animate-spin" : ""} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex justify-end border-t border-border-subtle pt-4">
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            {copy.cancel}
          </Button>
        </div>
        <ConfirmDialog
          isOpen={confirmDelete !== null}
          title={m.confirmDeleteTitle}
          description={m.confirmDeleteBody}
          confirmLabel={m.delete}
          cancelLabel={copy.cancel}
          tone="danger"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            const id = confirmDelete;
            setConfirmDelete(null);
            if (id) void remove(id);
          }}
        />
      </div>
    </Dialog>
  );
}
