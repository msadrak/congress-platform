import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatApiError, type OrganizerOut, type OrganizerProvisioned } from "../api/client";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Icon } from "../components/ui/Icon";
import { EmptyState, Field, FormAlert, SectionHeader } from "../components/organizer/WorkspaceUi";
import { usePlatform } from "./platformContext";

type Pending = { action: "rotate" | "revoke"; organizer: OrganizerOut } | null;

/** Organizer accounts (tenants): create, rotate a key, revoke. Keys are shown once, at creation or rotation. */
export default function PlatformOrganizers() {
  const { client, checkResponse, locale, isRtl } = usePlatform();
  const [organizers, setOrganizers] = useState<OrganizerOut[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<OrganizerProvisioned | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState<Pending>(null);

  const load = useCallback(async () => {
    const { data, error: err, response } = await client.GET("/api/organizers");
    checkResponse(response.status);
    if (data) setOrganizers(data);
    else setError(err ? formatApiError(err) : isRtl ? "فهرست بارگذاری نشد." : "The list could not be loaded.");
  }, [client, checkResponse, isRtl]);

  useEffect(() => {
    let active = true;
    client.GET("/api/organizers").then(({ data, error: err, response }) => {
      checkResponse(response.status);
      if (!active) return;
      if (data) setOrganizers(data);
      else setError(err ? formatApiError(err) : "—");
    });
    return () => {
      active = false;
    };
  }, [client, checkResponse]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    setError(null);
    const { data, error: err, response } = await client.POST("/api/organizers", { body: { name: name.trim() } });
    checkResponse(response.status);
    setCreating(false);
    if (data) {
      setIssued(data);
      setCopied(false);
      setName("");
      void load();
    } else {
      setError(err ? formatApiError(err) : isRtl ? "ساخته نشد." : "Not created.");
    }
  };

  const confirm = async () => {
    const target = pending;
    setPending(null);
    if (!target) return;
    const path = { organizer_id: target.organizer.id };
    if (target.action === "rotate") {
      const { data, error: err, response } = await client.POST("/api/organizers/{organizer_id}/rotate-key", { params: { path } });
      checkResponse(response.status);
      if (data) {
        setIssued(data);
        setCopied(false);
      } else setError(err ? formatApiError(err) : "—");
    } else {
      const { error: err, response } = await client.POST("/api/organizers/{organizer_id}/revoke", { params: { path } });
      checkResponse(response.status);
      if (err) setError(formatApiError(err));
    }
    void load();
  };

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.api_key);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const date = (iso: string) => new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : "en-US", { dateStyle: "medium" }).format(new Date(iso));

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow={isRtl ? "پنل مدیریت سامانه" : "Platform console"}
        title={isRtl ? "برگزارکنندگان" : "Organizers"}
        description={
          isRtl
            ? "هر برگزارکننده با کلید API خود وارد کنسول برگزارکننده می‌شود. کلید فقط یک‌بار نمایش داده می‌شود."
            : "Each organizer signs in to the organizer console with their own API key. A key is shown only once."
        }
      />

      <form onSubmit={create} className="flex flex-wrap items-end gap-3 rounded-2xl border border-border-default bg-surface-panel p-5 shadow-soft">
        <Field label={isRtl ? "نام برگزارکننده جدید" : "New organizer name"} className="min-w-0 flex-1">
          <input type="text" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} className="ui-input" />
        </Field>
        <Button type="submit" variant="primary" size="md" disabled={creating || !name.trim()}>
          <Icon name="plus" size={16} />
          {creating ? "..." : isRtl ? "ساخت و صدور کلید" : "Create and issue key"}
        </Button>
      </form>

      {issued && (
        <div role="status" data-testid="issued-key" className="space-y-3 rounded-2xl border border-status-success-border bg-status-success-bg p-5 text-status-success-text">
          <p className="text-sm font-bold">
            {isRtl ? `کلید API برای «${issued.name}» — فقط همین یک‌بار نمایش داده می‌شود:` : `API key for “${issued.name}”, shown only this once:`}
          </p>
          <p dir="ltr" className="select-all break-all rounded-xl bg-surface-panel px-4 py-3 font-mono text-sm text-text-primary">{issued.api_key}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ink" size="sm" onClick={() => void copy()}>
              <Icon name={copied ? "check" : "copy"} size={15} />
              {copied ? (isRtl ? "کپی شد" : "Copied") : isRtl ? "کپی کلید" : "Copy key"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setIssued(null)}>
              {isRtl ? "تحویل دادم، پنهان شود" : "Handed over, hide it"}
            </Button>
          </div>
        </div>
      )}

      {error && <FormAlert>{error}</FormAlert>}

      {organizers === null ? (
        <div className="skeleton h-40" />
      ) : organizers.length === 0 ? (
        <EmptyState icon="users" title={isRtl ? "هنوز برگزارکننده‌ای ساخته نشده است." : "No organizer yet."} />
      ) : (
        <ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-default bg-surface-panel">
          {organizers.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <p className="font-semibold text-text-primary"><bdi>{o.name}</bdi></p>
                <p className="text-xs text-text-muted">
                  {isRtl ? "ساخته شده " : "Created "}{date(o.created_at)}
                  {o.key_rotated_at && ` · ${isRtl ? "کلید تعویض شده " : "key rotated "}${date(o.key_rotated_at)}`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={o.revoked_at ? "danger" : "success"} size="sm" dot={!o.revoked_at}>
                  {o.revoked_at ? (isRtl ? "لغو شده" : "Revoked") : isRtl ? "فعال" : "Active"}
                </Badge>
                <Button type="button" variant="secondary" size="sm" onClick={() => setPending({ action: "rotate", organizer: o })}>
                  <Icon name="key" size={15} />
                  {o.revoked_at ? (isRtl ? "فعال‌سازی با کلید جدید" : "Reinstate with a new key") : isRtl ? "تعویض کلید" : "Rotate key"}
                </Button>
                {!o.revoked_at && (
                  <Button type="button" variant="danger" size="sm" onClick={() => setPending({ action: "revoke", organizer: o })}>
                    {isRtl ? "لغو دسترسی" : "Revoke"}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        isOpen={pending !== null}
        tone={pending?.action === "revoke" ? "danger" : "default"}
        title={
          pending?.action === "revoke"
            ? isRtl ? "لغو دسترسی برگزارکننده؟" : "Revoke this organizer?"
            : isRtl ? "صدور کلید جدید؟" : "Issue a new key?"
        }
        description={
          pending
            ? pending.action === "revoke"
              ? isRtl ? `کلید «${pending.organizer.name}» دیگر کار نمی‌کند؛ اطلاعات همایش‌ها حفظ می‌شود.` : `“${pending.organizer.name}” can no longer sign in; their congresses are kept.`
              : isRtl ? `کلید فعلی «${pending.organizer.name}» بلافاصله از کار می‌افتد و کلید جدید یک‌بار نمایش داده می‌شود.` : `The current key of “${pending.organizer.name}” stops working immediately; the new key is shown once.`
            : ""
        }
        confirmLabel={pending?.action === "revoke" ? (isRtl ? "لغو دسترسی" : "Revoke") : isRtl ? "صدور کلید جدید" : "Issue new key"}
        cancelLabel={isRtl ? "انصراف" : "Cancel"}
        onCancel={() => setPending(null)}
        onConfirm={() => void confirm()}
      />
    </div>
  );
}
