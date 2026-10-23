import { useEffect, useState, type FormEvent } from "react";
import { localizedApiError, type OrganizerOut, type OrganizerProvisioned } from "../api/client";
import { commonCopy } from "../copy/common";
import { formatDate } from "../lib/format";
import { useMutation } from "../hooks/useMutation";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Field } from "../components/ui/Field";
import { TextInput } from "../components/ui/Input";
import { Notice } from "../components/ui/Notice";
import { PageHeader } from "../components/ui/PageHeader";
import { RowActions } from "../components/ui/RowActions";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/StateBlock";
import { StatusChip } from "../components/ui/StatusChip";
import { usePlatform } from "./platformContext";
import { PlatformOrganizerMembers } from "./PlatformOrganizerMembers";

/** Organizer accounts (tenants): add one, rotate its key, remove or restore access, manage members. Keys are shown once. */
export default function PlatformOrganizers() {
  const { client, locale, copy } = usePlatform();
  const c = copy.organizers;
  const [organizers, setOrganizers] = useState<OrganizerOut[] | null>(null);
  /** The list could not be (re)loaded. */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** An action (create, rotate, revoke) failed. */
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  // Each request ends its own busy state whatever happens (useMutation).
  const createRequest = useMutation(locale);
  const actionRequest = useMutation(locale);
  const [issued, setIssued] = useState<OrganizerProvisioned | null>(null);
  const [copied, setCopied] = useState(false);
  /** The organizer whose key rotation (or reinstatement) waits for confirmation. */
  const [rotating, setRotating] = useState<OrganizerOut | null>(null);
  // Kept after closing, so the dialog's exit animation still shows whose members it listed.
  const [membersFor, setMembersFor] = useState<{ organizer: OrganizerOut; open: boolean } | null>(null);
  const shownError = error ?? createRequest.error ?? actionRequest.error;

  const [reloads, setReloads] = useState(0);
  const load = () => setReloads((n) => n + 1);

  useEffect(() => {
    let active = true;
    client
      .GET("/api/organizers")
      .then(({ data, error: err, response }) => {
        if (!active) return;
        if (data) {
          setOrganizers(data);
          setLoadError(null);
        } else setLoadError(localizedApiError(err, locale, response.status));
      })
      .catch(() => active && setLoadError(commonCopy[locale].network));
    return () => {
      active = false;
    };
  }, [client, locale, reloads]);

  const clearMessages = () => {
    setError(null);
    createRequest.setError(null);
    actionRequest.setError(null);
  };

  const showKey = (key: OrganizerProvisioned) => {
    setIssued(key);
    setCopied(false);
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || createRequest.busy) return;
    clearMessages();
    const result = await createRequest.run(() => client.POST("/api/organizers", { body: { name: name.trim() } }));
    if (!result.ok) return;
    const { data, error: err, response } = result.value;
    if (!data) return setError(localizedApiError(err, locale, response.status));
    showKey(data);
    setName("");
    load();
  };

  /** Rotate (or, for a revoked organizer, reinstate with) a new key, or remove access. */
  const act = async (action: "rotate" | "revoke", organizer: OrganizerOut) => {
    clearMessages();
    const path = { organizer_id: organizer.id };
    const result = await actionRequest.run(async () => {
      if (action === "rotate") {
        const { data, error: err, response } = await client.POST("/api/organizers/{organizer_id}/rotate-key", { params: { path } });
        if (data) showKey(data);
        else setError(localizedApiError(err, locale, response.status));
      } else {
        const { error: err, response } = await client.POST("/api/organizers/{organizer_id}/revoke", { params: { path } });
        if (!response.ok) setError(localizedApiError(err, locale, response.status));
      }
    });
    // Refused because another action is in flight: that one reloads the list.
    if (!result.ok && result.message === null) return;
    load();
  };

  const copyKey = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.api_key);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const date = (iso: string) => formatDate(iso, "long", locale);

  return (
    <div className="space-y-6">
      <PageHeader title={c.title} />

      <form onSubmit={create} className="flex flex-col gap-3 rounded-card border border-border-default bg-surface-panel p-4 shadow-soft sm:flex-row sm:items-end sm:p-5">
        <Field label={c.newName} className="min-w-0 flex-1">
          <TextInput value={name} maxLength={200} onChange={(e) => setName(e.target.value)} data-testid="new-organizer-name" />
        </Field>
        <Button type="submit" variant="primary" icon="plus" loading={createRequest.busy} disabled={!name.trim()}>
          {c.create}
        </Button>
      </form>

      {issued && (
        <div data-testid="issued-key">
          <Notice tone="success" title={c.issued(issued.name)}>
            <p dir="ltr" className="mt-2 select-all break-all rounded-control bg-surface-panel px-4 py-3 font-mono text-body-sm text-text-primary">
              {issued.api_key}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" icon={copied ? "check" : "copy"} onClick={() => void copyKey()}>
                {copied ? commonCopy[locale].copied : c.copyKey}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setIssued(null)}>
                {c.hideKey}
              </Button>
            </div>
          </Notice>
        </div>
      )}

      {shownError && <Notice tone="danger">{shownError}</Notice>}

      {organizers === null ? (
        loadError ? (
          <ErrorState title={c.loadFailed} body={loadError} onRetry={() => {
                setLoadError(null);
                load();
              }} />
        ) : (
          <LoadingState />
        )
      ) : (
        <>
          {loadError && <Notice tone="danger">{loadError}</Notice>}
          {organizers.length === 0 ? (
            <EmptyState icon="users" title={c.empty} />
          ) : (
            <ul data-testid="organizer-list" className="divide-y divide-border-subtle rounded-card border border-border-default bg-surface-panel">
              {organizers.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-text-primary">
                      <bdi>{o.name}</bdi>
                      <StatusChip status={o.revoked_at ? "accessRemoved" : "active"} size="sm" />
                    </p>
                    <p className="text-caption text-text-muted">
                      {c.created(date(o.created_at))}
                      {o.key_rotated_at && ` · ${c.rotated(date(o.key_rotated_at))}`}
                    </p>
                  </div>
                  <RowActions
                    visible={1}
                    menuLabel={c.moreFor(o.name)}
                    actions={[
                      { label: c.members, icon: "users", onSelect: () => setMembersFor({ organizer: o, open: true }) },
                      { label: o.revoked_at ? c.reinstate : c.rotate, icon: "key", disabled: actionRequest.busy, onSelect: () => setRotating(o) },
                      ...(o.revoked_at
                        ? []
                        : [
                            {
                              label: c.revoke,
                              disabled: actionRequest.busy,
                              onSelect: () => void act("revoke", o),
                              destructive: { title: c.revokeTitle(o.name), description: c.revokeBody, confirmLabel: c.revoke },
                            },
                          ]),
                    ]}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {membersFor && (
        <PlatformOrganizerMembers
          key={membersFor.organizer.id}
          organizer={membersFor.organizer}
          isOpen={membersFor.open}
          onClose={() => setMembersFor({ ...membersFor, open: false })}
        />
      )}

      <ConfirmDialog
        isOpen={rotating !== null}
        title={rotating?.revoked_at ? c.reinstateTitle : c.rotateTitle}
        description={rotating ? (rotating.revoked_at ? c.reinstateBody(rotating.name) : c.rotateBody(rotating.name)) : undefined}
        confirmLabel={rotating?.revoked_at ? c.reinstateAction : c.rotateAction}
        onCancel={() => setRotating(null)}
        onConfirm={() => {
          const target = rotating;
          setRotating(null);
          if (target) void act("rotate", target);
        }}
      />
    </div>
  );
}
