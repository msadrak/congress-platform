import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useSearchParams } from "react-router-dom";
import { apiErrorCode, localizedApiError, type EventOut, type MediaAssetOut, type PageStateOut } from "../api/client";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Dialog } from "../components/ui/Dialog";
import { Icon } from "../components/ui/Icon";
import { RowActions, type RowAction } from "../components/ui/RowActions";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { Notice } from "../components/organizer/WorkspaceUi";
import { useEventWorkspace } from "../components/organizer/eventWorkspaceContext";
import { eventTimeZone } from "../components/organizer/sessionTime";
import { BrandPanel } from "../components/organizer/studio/BrandPanel";
import { MediaLibrary } from "../components/organizer/studio/MediaLibrary";
import { PreviewFrame } from "../components/organizer/studio/PreviewFrame";
import { SectionEditor } from "../components/organizer/studio/SectionEditor";
import { SeoPanel } from "../components/organizer/studio/SeoPanel";
import { IconButton } from "../components/organizer/studio/StudioFields";
import { StudioContext, type StudioContextValue } from "../components/organizer/studio/studioContext";
import { SECTION_ICONS, studioCopy } from "../components/organizer/studio/studioCopy";
import { organizerProgramCopy } from "../copy/organizerProgram";
import { formatTime } from "../lib/format";
import {
  ADDABLE_SECTIONS,
  MAX_SECTIONS,
  addSection,
  documentDiff,
  isCoreSection,
  localized,
  moveSection,
  normalizeDocument,
  referencedImages,
  removeSection,
  sameDocument,
  sectionAnchor,
  toApiDocument,
  updateSection,
  type PageDoc,
  type PageLocale,
  type PageSection,
  type SectionType,
} from "../lib/pageDocument";
import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_BYTES, useOrganizerImages } from "../lib/pageMedia";
import { EventSectionGate } from "./organizer/EventSectionUi";
import { PanelFrame, type PanelView } from "./OrganizerPanel";

type Tab = "sections" | "brand" | "seo";
type Confirm = "publish" | "unpublish" | "discard" | "revert" | { remove: string } | null;
const PANEL_VIEWS: readonly PanelView[] = ["home", "details", "card"];
/** What the preview shows: the public page (live edits) or the attendee panel (the saved draft). */
type PreviewTarget = "page" | "panel";

/** Selected-tab look shared by the studio's tab rows: an underline, never a filled block. */
const TAB_CLASS =
  "relative inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 px-3 text-body-sm font-semibold whitespace-nowrap text-text-muted transition-colors hover:text-text-primary aria-selected:text-text-primary after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full aria-selected:after:bg-action-primary";

/**
 * `/organizer/events/:eventId/page`: Page Studio. Edits the public page's draft with a live preview, which can
 * also show the attendee panel (`?preview=panel`). Viewers and archived congresses look without changing it.
 */
export default function OrganizerPageStudio() {
  return <EventSectionGate>{(event) => <PageStudio event={event} />}</EventSectionGate>;
}

function PageStudio({ event }: { event: EventOut }) {
  const { eventId, apiKey, client, canEdit, can, locale } = useEventWorkspace();
  const copy = studioCopy[locale];
  const panelCopy = organizerProgramCopy[locale].panel;
  const [search] = useSearchParams();
  const panelFirst = search.get("preview") === "panel";

  const [load, setLoad] = useState<"loading" | "ready" | "error">("loading");
  const [page, setPage] = useState<PageStateOut | null>(null);
  const [saved, setSaved] = useState<PageDoc | null>(null);
  const [doc, setDoc] = useState<PageDoc | null>(null);
  const [assets, setAssets] = useState<MediaAssetOut[]>([]);

  const [tab, setTab] = useState<Tab>("sections");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lang, setLang] = useState<PageLocale>(locale);
  const [device, setDevice] = useState<"desktop" | "mobile">(panelFirst ? "mobile" : "desktop");
  const [pane, setPane] = useState<"edit" | "preview">(panelFirst ? "preview" : "edit");
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget>(panelFirst ? "panel" : "page");
  const [panelView, setPanelView] = useState<PanelView>("home");
  const [busy, setBusy] = useState<null | "save" | "publish" | "unpublish" | "discard">(null);
  /** A save or publish lost a race with another editor: their saved version (null when it could not be read). */
  const [conflict, setConflict] = useState<{ latest: PageStateOut | null } | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [adding, setAdding] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const pickResolver = useRef<((id: string | null) => void) | null>(null);

  // Every request goes through the workspace's API client: a 401 reaches the console's key gate by itself.
  const path = { params: { path: { event_id: eventId } } };

  const accept = (next: PageStateOut) => {
    const normalized = normalizeDocument(next.draft);
    setPage(next);
    setSaved(normalized);
    return normalized;
  };

  const loadAll = useCallback(async () => {
    if (!client) return;
    setLoad("loading");
    const [pg, media] = await Promise.all([client.GET("/api/events/{event_id}/page", path), client.GET("/api/events/{event_id}/media", path)]);
    if (!pg.data || !media.data) {
      setLoad("error");
      return;
    }
    setAssets(media.data);
    const normalized = normalizeDocument(pg.data.draft);
    setPage(pg.data);
    setSaved(normalized);
    setDoc(normalized);
    setConflict(null);
    setLoad("ready");
    // `path` is derived from eventId, which is fixed for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, eventId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const dirty = Boolean(doc && saved && !sameDocument(doc, saved));

  // Leaving for another console page with unsaved edits asks first (reloads and closing the tab: beforeunload).
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && canEdit && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const images = useOrganizerImages(apiKey, eventId, assets);
  const previewAssets = useMemo(() => assets.map((a) => ({ id: a.id, width: a.width, height: a.height })), [assets]);
  const inUse = useMemo(() => {
    const ids = new Set<string>();
    for (const d of [doc, saved]) if (d) referencedImages(d).forEach((id) => ids.add(id));
    return ids;
  }, [doc, saved]);

  /** A refused save/publish: a stale revision fetches the other editor's version to compare; anything else is told. */
  const failure = async (body: unknown, status?: number) => {
    if (apiErrorCode(body) !== "PAGE_DRAFT_STALE") {
      setNotice({ tone: "error", text: localizedApiError(body, locale, status) });
      return;
    }
    const latest = client ? await client.GET("/api/events/{event_id}/page", path).catch(() => null) : null;
    setConflict({ latest: latest?.data ?? null });
  };

  /** Saves the draft; returns the new revision, or null when it failed. */
  const save = async (): Promise<number | null> => {
    if (!client || !doc || !page) return null;
    const sent = doc;
    const { data, error, response } = await client.PUT("/api/events/{event_id}/page", {
      ...path,
      body: { revision: page.draft_revision, document: toApiDocument(sent) },
    });
    if (!data) {
      await failure(error, response.status);
      return null;
    }
    const normalized = accept(data);
    setDoc((current) => (current === sent ? normalized : current));
    return data.draft_revision;
  };

  /** Conflict choice "keep my changes": save this editor's document over the other version. */
  const overwrite = async () => {
    const latest = conflict?.latest;
    if (!client || !doc || !latest) return;
    const sent = doc;
    setBusy("save");
    setNotice(null);
    try {
      const { data, error, response } = await client.PUT("/api/events/{event_id}/page", {
        ...path,
        body: { revision: latest.draft_revision, document: toApiDocument(sent) },
      });
      if (!data) {
        await failure(error, response.status);
        return;
      }
      setConflict(null);
      const normalized = accept(data);
      setDoc((current) => (current === sent ? normalized : current));
      setNotice({ tone: "ok", text: copy.overwrittenNotice });
    } catch {
      setNotice({ tone: "error", text: copy.loadFailed });
    } finally {
      setBusy(null);
    }
  };

  /** Conflict choice "load the latest": continue from the other version, dropping this editor's unsaved edits. */
  const loadLatest = () => {
    const latest = conflict?.latest;
    if (!latest) {
      void loadAll();
      return;
    }
    setDoc(accept(latest));
    setConflict(null);
  };

  const run = async (kind: NonNullable<typeof busy>) => {
    if (!client || !page) return;
    setBusy(kind);
    setNotice(null);
    try {
      if (kind === "save") {
        if ((await save()) !== null) setNotice({ tone: "ok", text: page.is_published ? copy.savedNotice : copy.savedFirstNotice });
        return;
      }
      if (kind === "unpublish") {
        const { data, error, response } = await client.POST("/api/events/{event_id}/page/unpublish", path);
        if (data) {
          accept(data);
          setNotice({ tone: "ok", text: copy.unpublishedNotice });
        } else await failure(error, response.status);
        return;
      }
      const revision = dirty ? await save() : page.draft_revision;
      if (revision === null) return;
      const route = kind === "publish" ? "/api/events/{event_id}/page/publish" : "/api/events/{event_id}/page/discard";
      const { data, error, response } = await client.POST(route, { ...path, body: { revision } });
      if (!data) {
        await failure(error, response.status);
        return;
      }
      const normalized = accept(data);
      setDoc(normalized);
      setNotice({ tone: "ok", text: kind === "publish" ? copy.publishedNotice : copy.discardedNotice });
    } catch {
      setNotice({ tone: "error", text: copy.loadFailed });
    } finally {
      setBusy(null);
    }
  };

  // Ctrl/Cmd+S saves the draft, under the same conditions as the Save button.
  const saveRef = useRef<() => void>(() => undefined);
  saveRef.current = () => {
    if (dirty && canEdit && busy === null && !conflict) void run("save");
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pickImage = useCallback(
    () =>
      new Promise<string | null>((resolve) => {
        pickResolver.current?.(null);
        pickResolver.current = resolve;
        setLibraryOpen(true);
      }),
    [],
  );
  const closeLibrary = (id: string | null) => {
    pickResolver.current?.(id);
    pickResolver.current = null;
    setLibraryOpen(false);
  };
  const upload = async (file: File): Promise<string | null> => {
    if (!client) return copy.loadFailed;
    if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) return copy.media.typeError;
    if (file.size > MAX_IMAGE_BYTES) return copy.media.sizeError;
    // The raw image bytes; the API client reports a rejected key to the console's gate like any request.
    const { data, error, response } = await client.POST("/api/events/{event_id}/media", {
      params: { path: { event_id: eventId }, header: { "content-type": file.type } },
      body: file as unknown as string,
      bodySerializer: (body: unknown) => body as BodyInit,
    });
    if (!data) {
      if (response.status === 415) return copy.media.typeError;
      if (response.status === 413) return copy.media.sizeError;
      return localizedApiError(error, locale, response.status) || copy.media.uploadFailed;
    }
    setAssets((current) => [data, ...current]);
    closeLibrary(data.id);
    return null;
  };
  const deleteImage = async (id: string): Promise<string | null> => {
    if (!client) return copy.media.deleteFailed;
    const { error, response } = await client.DELETE("/api/events/{event_id}/media/{asset_id}", {
      params: { path: { event_id: eventId, asset_id: id } },
    });
    if (!response.ok) {
      return localizedApiError(error, locale, response.status) || copy.media.deleteFailed;
    }
    setAssets((current) => current.filter((a) => a.id !== id));
    return null;
  };

  const studio: StudioContextValue = { copy, lang, assets, images, pickImage };
  const onPreviewLocale = useCallback((next: PageLocale) => setLang(next), []);

  if (load !== "ready" || !doc || !page || !saved) {
    return (
      <div role="status" className="grid min-h-[50vh] place-items-center">
        {load === "error" ? (
          <div className="space-y-4 text-center">
            <p className="text-body-sm text-text-secondary">{copy.loadFailed}</p>
            <Button variant="secondary" icon="sync" onClick={() => void loadAll()}>
              {copy.retry}
            </Button>
          </div>
        ) : (
          <Icon name="sync" size={22} className="text-text-muted motion-safe:animate-spin" />
        )}
      </div>
    );
  }

  const selected = doc.sections.find((s) => s.id === selectedId) ?? null;
  const ahead = page.is_published && (page.has_unpublished_changes || dirty);
  const status = !page.is_published
    ? { tone: "warning" as const, label: copy.statusNotPublished }
    : ahead
      ? { tone: "info" as const, label: copy.statusPending }
      : { tone: "success" as const, label: copy.statusLive };
  const canPublish = dirty || page.has_unpublished_changes || !page.is_published;
  const publicUrl = `${window.location.host}/e/${event.slug}`;
  const select = (section: PageSection | null) => {
    setSelectedId(section?.id ?? null);
  };
  const focusAnchor = selected ? sectionAnchor(selected) : null;
  const sectionNames = (sections: PageSection[]) => sections.map((section) => copy.sections[section.type].name).join(copy.listSeparator);
  const conflictChanges = (() => {
    if (!conflict?.latest) return null;
    const diff = documentDiff(doc, normalizeDocument(conflict.latest.draft));
    return [
      diff.hero ? copy.diffHero : "",
      diff.branding ? copy.diffBranding : "",
      diff.seo ? copy.diffSeo : "",
      diff.added.length ? copy.diffAdded(sectionNames(diff.added)) : "",
      diff.removed.length ? copy.diffRemoved(sectionNames(diff.removed)) : "",
      diff.changed.length ? copy.diffChanged(sectionNames(diff.changed)) : "",
      diff.order ? copy.diffOrder : "",
    ].filter(Boolean);
  })();

  const sectionLabel = (section: PageSection) => {
    const own = localized(section.title, lang);
    return { name: copy.sections[section.type].name, detail: own ?? copy.sections[section.type].description };
  };

  // Secondary page actions live in one ⋯ menu; each destructive one asks through its own dialog below.
  const locked = busy !== null || conflict !== null;
  const menu: RowAction[] = [
    ...(page.is_published
      ? [{ label: copy.openLive, icon: "arrow-up-right" as const, onSelect: () => window.open(`/e/${encodeURIComponent(event.slug)}`, "_blank", "noopener,noreferrer") }]
      : []),
    ...(canEdit && dirty ? [{ label: copy.revert, icon: "sync" as const, disabled: busy !== null, onSelect: () => setConfirm("revert") }] : []),
    ...(canEdit && page.is_published && page.has_unpublished_changes
      ? [{ label: copy.discard, icon: "trash" as const, disabled: locked, onSelect: () => setConfirm("discard") }]
      : []),
    ...(canEdit && page.is_published ? [{ label: copy.unpublish, icon: "eye-off" as const, disabled: busy !== null, onSelect: () => setConfirm("unpublish") }] : []),
  ];

  const languageSwitch = (
    <SegmentedControl<PageLocale>
      label={copy.editingLanguage}
      value={lang}
      onChange={setLang}
      options={(["fa", "en"] as const).map((l) => ({ value: l, label: copy.languages[l], lang: l }))}
    />
  );

  return (
    <StudioContext.Provider value={studio}>
      <div className="space-y-5" data-testid="page-studio">
        <header className="sticky top-0 z-30 -mx-4 border-b border-border-default bg-surface-page/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <div className="min-w-0 basis-full space-y-1 sm:basis-auto sm:flex-1">
              <h1 className="text-title font-bold text-text-primary">{copy.title}</h1>
              <p className="flex flex-wrap items-center gap-2">
                <Badge variant={status.tone} size="md" dot data-testid="page-status">
                  {status.label}
                </Badge>
                <span className="text-meta text-text-muted" aria-live="polite" data-testid="save-state">
                  {busy === "save" ? copy.saving : dirty ? copy.unsaved : copy.savedAt(formatTime(page.draft_updated_at, locale, eventTimeZone(event)))}
                </span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canEdit && (
                <>
                  <Button variant="secondary" icon="check" onClick={() => void run("save")} disabled={!dirty || locked}>
                    {copy.save}
                  </Button>
                  <Button variant="primary" icon="web" onClick={() => setConfirm("publish")} disabled={!canPublish || locked} loading={busy === "publish"}>
                    {busy === "publish" ? copy.publishing : copy.publish}
                  </Button>
                </>
              )}
              {menu.length > 0 && <RowActions visible={0} menuLabel={copy.more} actions={menu} />}
            </div>
          </div>
        </header>

        {!can("manager") && (
          <p role="status" className="flex items-start gap-2.5 rounded-card border border-border-default bg-surface-panel-subtle p-4 text-body-sm leading-relaxed text-text-secondary">
            <Icon name="eye" size={18} className="mt-0.5 shrink-0" />
            {copy.readOnly}
          </p>
        )}
        {conflict && (
          <div role="alert" data-testid="studio-conflict" className="space-y-3 rounded-card border border-status-warning-border bg-status-warning-bg p-4 text-body-sm text-status-warning-text">
            <div className="flex items-start gap-3">
              <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1 space-y-2 leading-relaxed">
                <p>{copy.conflict}</p>
                {conflictChanges && (
                  <div data-testid="studio-conflict-diff">
                    <p className="font-semibold">{conflictChanges.length > 0 ? `${copy.conflictSummary}:` : `${copy.conflictSummary} ${copy.conflictSame}`}</p>
                    {conflictChanges.length > 0 && (
                      <ul className="mt-1 list-disc space-y-0.5 ps-5">
                        {conflictChanges.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {conflict.latest && canEdit && (
                <Button variant="secondary" size="sm" icon="check" onClick={() => void overwrite()} disabled={busy !== null}>
                  {copy.keepMine}
                </Button>
              )}
              <Button variant="secondary" size="sm" icon="sync" onClick={loadLatest} disabled={busy !== null}>
                {conflict.latest ? copy.loadLatest : copy.reload}
              </Button>
            </div>
          </div>
        )}
        {notice && (
          <Notice tone={notice.tone} onDismiss={() => setNotice(null)} dismissLabel={copy.dismiss}>
            {notice.text}
          </Notice>
        )}

        {/* Below 1280 px the editor and the preview share the space through this switch. */}
        <div role="tablist" className="flex border-b border-border-subtle xl:hidden">
          {(["edit", "preview"] as const).map((p) => (
            <button key={p} type="button" role="tab" aria-selected={pane === p} onClick={() => setPane(p)} className={`${TAB_CLASS} flex-1 justify-center`}>
              {p === "edit" ? copy.edit : copy.preview.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(360px,420px)_minmax(0,1fr)]">
          {/* ── Editor ────────────────────────────────────────────────── */}
          <aside aria-label={copy.title} className={`space-y-4 ${pane === "preview" ? "max-xl:hidden" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div role="tablist" aria-label={copy.title} className="flex min-w-0 max-w-full overflow-x-auto border-b border-border-subtle [scrollbar-width:none]">
                {(
                  [
                    ["sections", copy.tabSections, "layers"],
                    ["brand", copy.tabBrand, "palette"],
                    ["seo", copy.tabSeo, "globe"],
                  ] as const
                ).map(([key, label, icon]) => (
                  <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={TAB_CLASS}>
                    <Icon name={icon} size={16} />
                    {label}
                  </button>
                ))}
              </div>
              {languageSwitch}
            </div>

            <fieldset disabled={!canEdit} className="min-w-0 rounded-card border border-border-default bg-surface-panel p-4 sm:p-5">
              {tab === "brand" && <BrandPanel doc={doc} onChange={setDoc} eventName={event.name} />}
              {tab === "seo" && <SeoPanel doc={doc} onChange={setDoc} eventName={event.name} slug={event.slug} />}
              {tab === "sections" && !selected && (
                <div className="space-y-4">
                  <ol className="space-y-2" data-testid="section-list">
                    {doc.sections.map((section, i) => {
                      const label = sectionLabel(section);
                      const core = isCoreSection(section);
                      return (
                        <li
                          key={section.id}
                          data-section={section.id}
                          className={`flex items-center gap-2 rounded-control border p-1.5 ${section.visible ? "border-border-default bg-surface-panel" : "border-dashed border-border-strong bg-surface-panel-subtle"}`}
                        >
                          <button type="button" onClick={() => select(section)} className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md p-1 text-start">
                            <span className={`grid size-9 shrink-0 place-items-center rounded-md bg-surface-panel-subtle ${section.visible ? "text-text-secondary" : "text-text-muted"}`}>
                              <Icon name={SECTION_ICONS[section.type]} size={18} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className={`flex items-center gap-1.5 text-body-sm font-semibold ${section.visible ? "text-text-primary" : "text-text-muted"}`}>
                                <span className="truncate">{label.name}</span>
                                {!section.visible && <Badge variant="neutral" size="sm">{copy.hidden}</Badge>}
                                {core && (
                                  <span title={copy.coreHint} className="inline-flex shrink-0">
                                    <Icon name="lock" size={12} className="text-text-muted" aria-label={copy.eventData} />
                                  </span>
                                )}
                              </span>
                              <span className="block truncate text-meta text-text-muted">{label.detail}</span>
                            </span>
                          </button>
                          <span className="flex shrink-0 items-center">
                            <IconButton icon="arrow-up" label={copy.moveUp} disabled={i === 0} onClick={() => setDoc(moveSection(doc, section.id, -1))} />
                            <IconButton icon="arrow-down" label={copy.moveDown} disabled={i === doc.sections.length - 1} onClick={() => setDoc(moveSection(doc, section.id, 1))} />
                            <IconButton
                              icon={section.visible ? "eye" : "eye-off"}
                              label={section.visible ? copy.hide : copy.show}
                              pressed={!section.visible}
                              onClick={() => setDoc(updateSection(doc, { ...section, visible: !section.visible }))}
                            />
                            {!core && <IconButton icon="trash" tone="danger" label={copy.remove} onClick={() => setConfirm({ remove: section.id })} />}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                  <div className="space-y-1.5">
                    <Button variant="secondary" icon="plus" isFullWidth onClick={() => setAdding(true)} disabled={doc.sections.length >= MAX_SECTIONS}>
                      {copy.addSection}
                    </Button>
                    {doc.sections.length >= MAX_SECTIONS && <p className="text-meta text-text-muted">{copy.sectionLimit}</p>}
                  </div>
                </div>
              )}
              {tab === "sections" && selected && (
                <div className="space-y-5">
                  <Button variant="ghost" size="sm" icon="arrow-left" onClick={() => select(null)}>
                    {copy.back}
                  </Button>
                  <div className="flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-panel-subtle text-text-secondary">
                      <Icon name={SECTION_ICONS[selected.type]} size={20} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-body font-bold text-text-primary">{copy.sections[selected.type].name}</h2>
                      <p className="text-meta leading-relaxed text-text-muted">{isCoreSection(selected) ? copy.coreHint : copy.sections[selected.type].description}</p>
                    </div>
                  </div>
                  <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-control border border-border-default px-3.5">
                    <span className="text-body-sm font-semibold text-text-primary">{copy.fields.visible}</span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={selected.visible}
                      onChange={() => setDoc(updateSection(doc, { ...selected, visible: !selected.visible }))}
                      className="size-5 accent-[var(--aiteb-indigo)]"
                    />
                  </label>
                  <div className="space-y-5">
                    <SectionEditor section={selected} eventDescription={event.description} onChange={(next) => setDoc(updateSection(doc, next))} />
                  </div>
                </div>
              )}
            </fieldset>
          </aside>

          {/* ── Preview ───────────────────────────────────────────────── */}
          <section aria-label={copy.preview.label} className={`space-y-3 xl:sticky xl:top-24 ${pane === "edit" ? "max-xl:hidden" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SegmentedControl<PreviewTarget>
                label={copy.previewOf}
                value={previewTarget}
                onChange={setPreviewTarget}
                options={(["page", "panel"] as const).map((target) => ({ value: target, label: copy.targets[target] }))}
              />
              <div className="flex flex-wrap items-center gap-2">
                {previewTarget === "panel" && (
                  <SegmentedControl<PanelView> label={panelCopy.viewsLabel} value={panelView} onChange={setPanelView} options={PANEL_VIEWS.map((view) => ({ value: view, label: panelCopy.views[view] }))} />
                )}
                <SegmentedControl<"desktop" | "mobile">
                  label={copy.preview.label}
                  value={device}
                  onChange={setDevice}
                  options={[
                    { value: "desktop", label: copy.preview.desktop, icon: "monitor" },
                    { value: "mobile", label: copy.preview.mobile, icon: "smartphone" },
                  ]}
                />
              </div>
            </div>
            <div className="h-[min(78vh,980px)] rounded-card border border-border-default bg-surface-panel-subtle p-3 sm:p-4">
              {previewTarget === "page" ? (
                <PreviewFrame
                  eventId={eventId}
                  doc={doc}
                  assets={previewAssets}
                  locale={lang}
                  device={device}
                  focusAnchor={focusAnchor}
                  onLocaleChange={onPreviewLocale}
                  title={copy.preview.frameTitle}
                />
              ) : (
                <PanelFrame
                  eventId={eventId}
                  view={panelView}
                  locale={lang}
                  device={device}
                  refreshTick={page.draft_revision}
                  onViewChange={setPanelView}
                  title={panelCopy.frameTitle}
                />
              )}
            </div>
            <p className="text-meta leading-relaxed text-text-muted">{previewTarget === "page" ? copy.preview.note : panelCopy.note}</p>
          </section>
        </div>
      </div>

      <Dialog isOpen={adding} onClose={() => setAdding(false)} title={copy.addSectionTitle} size="lg">
        <ul className="grid gap-2 sm:grid-cols-2">
          {ADDABLE_SECTIONS.map((type: SectionType) => (
            <li key={type}>
              <button
                type="button"
                onClick={() => {
                  const result = addSection(doc, type, selectedId ?? undefined);
                  setDoc(result.doc);
                  setSelectedId(result.id);
                  setTab("sections");
                  setAdding(false);
                }}
                className="flex h-full w-full cursor-pointer items-start gap-3 rounded-control border border-border-default bg-surface-panel p-3 text-start transition-colors hover:border-border-strong hover:bg-surface-panel-subtle"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-panel-subtle text-text-secondary">
                  <Icon name={SECTION_ICONS[type]} size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-text-primary">{copy.sections[type].name}</span>
                  <span className="block text-xs leading-relaxed text-text-muted">{copy.sections[type].description}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Dialog>

      <MediaLibrary
        isOpen={libraryOpen}
        copy={copy}
        assets={assets}
        images={images}
        inUse={inUse}
        onUpload={upload}
        onDelete={deleteImage}
        onPick={(id) => closeLibrary(id)}
        onClose={() => closeLibrary(null)}
      />

      <ConfirmDialog
        isOpen={confirm === "publish"}
        title={copy.confirmPublishTitle}
        description={copy.confirmPublishBody(publicUrl)}
        confirmLabel={copy.publish}
        cancelLabel={copy.cancel}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          void run("publish");
        }}
      />
      <ConfirmDialog
        isOpen={confirm === "unpublish"}
        title={copy.confirmUnpublishTitle}
        description={copy.confirmUnpublishBody}
        confirmLabel={copy.unpublish}
        cancelLabel={copy.cancel}
        tone="danger"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          void run("unpublish");
        }}
      />
      <ConfirmDialog
        isOpen={confirm === "discard"}
        title={copy.confirmDiscardTitle}
        description={copy.confirmDiscardBody}
        confirmLabel={copy.discard}
        cancelLabel={copy.cancel}
        tone="danger"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          void run("discard");
        }}
      />
      <ConfirmDialog
        isOpen={confirm === "revert"}
        title={copy.confirmRevertTitle}
        description={copy.confirmRevertBody}
        confirmLabel={copy.revert}
        cancelLabel={copy.cancel}
        tone="danger"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          setDoc(saved);
        }}
      />
      <ConfirmDialog
        isOpen={typeof confirm === "object" && confirm !== null}
        title={copy.confirmRemoveTitle}
        description={copy.confirmRemoveBody}
        confirmLabel={copy.remove}
        cancelLabel={copy.cancel}
        tone="danger"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (typeof confirm === "object" && confirm !== null) {
            setDoc(removeSection(doc, confirm.remove));
            if (selectedId === confirm.remove) setSelectedId(null);
          }
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        isOpen={blocker.state === "blocked"}
        tone="danger"
        title={copy.leaveTitle}
        description={copy.leaveBody}
        confirmLabel={copy.leaveConfirm}
        cancelLabel={copy.stay}
        onCancel={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
      />
    </StudioContext.Provider>
  );
}
