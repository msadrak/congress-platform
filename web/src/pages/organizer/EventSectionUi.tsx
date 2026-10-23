import { Button, LinkButton } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { FormAlert, Notice } from "../../components/organizer/WorkspaceUi";
import { useEventWorkspace } from "../../components/organizer/eventWorkspaceContext";

/** Pieces every section of the event workspace shares: load states, the add action, the change notice. */

export type SectionNoticeState = { tone: "ok" | "error"; text: string } | null;

/**
 * What a section shows instead of its content: a skeleton until the event and the section's lists have
 * loaded, then the failure card when the event itself could not be loaded. Render it while
 * `!event || error || !listsLoaded`; it renders nothing once the event is there.
 */
export function EventSectionGate({ listsLoaded }: { listsLoaded: boolean }) {
  const { event, loading, error, reload, isRtl, t } = useEventWorkspace();
  if ((loading && !event) || !listsLoaded) {
    return (
      <div className="space-y-6" aria-hidden="true">
        <div className="skeleton h-60 shape-arc-lg" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="skeleton h-32 rounded-2xl" />
          <div className="skeleton h-32 rounded-2xl" />
          <div className="skeleton h-32 rounded-2xl" />
          <div className="skeleton h-32 rounded-2xl" />
        </div>
        <div className="skeleton h-64 rounded-2xl" />
      </div>
    );
  }
  if (!error && event) return null;
  return (
    <div className="relative overflow-hidden shape-arc border border-status-danger-border bg-status-danger-bg px-6 py-12 text-center sm:py-16">
      <div aria-hidden="true" className="pointer-events-none absolute -end-24 -top-24 size-56 rounded-full border border-status-danger-border" />
      <div aria-hidden="true" className="pointer-events-none absolute -end-14 -top-14 size-36 rounded-full border border-status-danger-border" />
      <div className="relative mx-auto max-w-md space-y-3">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-white text-status-danger-text shadow-soft">
          <Icon name="alert" size={26} />
        </span>
        <h1 className="pt-1 text-xl font-bold text-status-danger-text">{isRtl ? "خطا در بارگذاری همایش" : "Failed to Load Event"}</h1>
        <p className="text-sm text-text-secondary">
          {isRtl ? "اطلاعات این همایش دریافت نشد. دوباره تلاش کنید." : "This congress could not be loaded. Try again."}
        </p>
        {error && (
          <p dir="auto" className="text-xs text-text-muted" data-testid="event-load-error">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-center gap-2 pt-3">
          <Button type="button" variant="primary" size="md" disabled={loading} aria-busy={loading} onClick={reload}>
            <Icon name="sync" size={18} />
            {t.retryAction}
          </Button>
          <LinkButton to="/organizer" variant="secondary" size="md">
            <Icon name="arrow-left" size={18} />
            {t.breadcrumbEvents}
          </LinkButton>
        </div>
      </div>
    </div>
  );
}

/** Primary "add" action of a section header or empty state. */
export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="primary" size="md" onClick={onClick}>
      <Icon name="plus" size={18} />
      <span>{label}</span>
    </Button>
  );
}

/** Result of the last change, announced politely; errors are announced assertively. */
export function SectionNotice({ notice, onDismiss }: { notice: SectionNoticeState; onDismiss: () => void }) {
  const { isRtl } = useEventWorkspace();
  if (!notice) return null;
  return (
    <Notice tone={notice.tone} onDismiss={onDismiss} dismissLabel={isRtl ? "بستن پیام" : "Dismiss message"}>
      {notice.text}
    </Notice>
  );
}

/**
 * A list of this section failed to load: say so and offer a retry, which reloads the event as well.
 * `loading` covers the section's lists; the event's own reload is added here.
 */
export function SectionLoadError({ error, loading, onRetry }: { error: string | null; loading: boolean; onRetry: () => void }) {
  const { loading: eventLoading, reload, t } = useEventWorkspace();
  if (!error) return null;
  const busy = loading || eventLoading;
  return (
    <div className="space-y-3">
      <FormAlert>
        {t.sectionsLoadFailed} <bdi>{error}</bdi>
      </FormAlert>
      <Button
        type="button"
        variant="secondary"
        size="md"
        disabled={busy}
        aria-busy={busy}
        onClick={() => {
          reload();
          onRetry();
        }}
      >
        <Icon name="sync" size={16} />
        {t.retryAction}
      </Button>
    </div>
  );
}
