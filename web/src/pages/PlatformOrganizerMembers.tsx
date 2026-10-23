import { useEffect, useState, type FormEvent } from "react";
import { localizedApiError, type MemberOut, type OrganizerOut, type OrganizerRole } from "../api/client";
import { commonCopy } from "../copy/common";
import { codeFontClass, formatDate, formatMobile } from "../lib/format";
import { normalizeIranMobile } from "../lib/mobile";
import { ROLE_COPY, inviterLabel } from "../lib/organizerConsole";
import { useMutation } from "../hooks/useMutation";
import { RolePicker } from "../components/organizer/RolePicker";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Field } from "../components/ui/Field";
import { TextInput } from "../components/ui/Input";
import { Notice } from "../components/ui/Notice";
import { ErrorState, LoadingState } from "../components/ui/StateBlock";
import { StatusChip } from "../components/ui/StatusChip";
import { usePlatform } from "./platformContext";

/**
 * An organizer's members as the platform admin sees them (`GET/POST /api/organizers/{id}/members`, ADR 0016):
 * who can sign in to its console, and adding the first owner by mobile number.
 */
export function PlatformOrganizerMembers({ organizer, isOpen, onClose }: { organizer: OrganizerOut; isOpen: boolean; onClose: () => void }) {
  const { client, locale, copy } = usePlatform();
  const c = copy.members;
  const roles = ROLE_COPY[locale];
  const [members, setMembers] = useState<MemberOut[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const [name, setName] = useState("");
  const [mobileInput, setMobileInput] = useState("");
  const [role, setRole] = useState<OrganizerRole>("owner");
  const [formError, setFormError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const addRequest = useMutation(locale);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    client
      .GET("/api/organizers/{organizer_id}/members", { params: { path: { organizer_id: organizer.id } } })
      .then(({ data, error, response }) => {
        if (!active) return;
        if (data) {
          setMembers(data);
          setLoadError(null);
        } else setLoadError(localizedApiError(error, locale, response.status));
      })
      .catch(() => active && setLoadError(commonCopy[locale].network));
    return () => {
      active = false;
    };
  }, [client, organizer.id, isOpen, reloads, locale]);

  const retry = () => {
    setLoadError(null);
    setMembers(null);
    setReloads((n) => n + 1);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAdded(null);
    if (!name.trim()) return setFormError(c.nameRequired);
    const mobile = normalizeIranMobile(mobileInput);
    if (!mobile) return setFormError(commonCopy[locale].mobileInvalid);
    setFormError(null);
    const result = await addRequest.run(() =>
      client.POST("/api/organizers/{organizer_id}/members", {
        params: { path: { organizer_id: organizer.id } },
        body: { display_name: name.trim(), mobile, role },
      }),
    );
    if (!result.ok) return;
    const { data, error, response } = result.value;
    if (!data) return setFormError(localizedApiError(error, locale, response.status));
    setMembers((prev) => [...(prev ?? []).filter((m) => m.id !== data.id), data]);
    setAdded(c.added(data.display_name));
    setName("");
    setMobileInput("");
    setRole("owner");
  };

  const shownFormError = formError ?? addRequest.error;

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={copy.organizers.membersOf(organizer.name)} description={c.description} size="lg">
      <div className="space-y-6">
        {loadError ? (
          <ErrorState title={c.loadFailed} body={loadError} headingLevel={3} onRetry={retry} />
        ) : members === null ? (
          <LoadingState />
        ) : members.length === 0 ? (
          <p className="rounded-control border border-dashed border-border-default px-4 py-5 text-center text-body-sm text-text-secondary">{c.empty}</p>
        ) : (
          <ul data-testid="platform-members" className="divide-y divide-border-subtle rounded-control border border-border-default">
            {members.map((member) => {
              const removed = member.revoked_at !== null;
              const mobile = member.mobile ? formatMobile(member.mobile, locale) : null;
              return (
                <li key={member.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                  <div className="min-w-0 space-y-0.5">
                    <p className={`break-words text-body-sm font-semibold ${removed ? "text-text-secondary" : "text-text-primary"}`}>
                      <bdi>{member.display_name}</bdi>
                    </p>
                    {mobile && (
                      <p className={`text-caption text-text-muted ${codeFontClass(mobile)}`}>
                        <bdi dir="ltr">{mobile}</bdi>
                      </p>
                    )}
                    <p className="text-caption text-text-muted">{c.invitedBy(inviterLabel(member.invited_by, locale), formatDate(member.created_at, "long", locale))}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={member.role === "owner" ? "brand" : "neutral"} size="sm">
                      {roles[member.role].label}
                    </Badge>
                    <StatusChip status={removed ? "accessRemoved" : "active"} size="sm" />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <form onSubmit={submit} noValidate className="space-y-4 rounded-control border border-border-default bg-surface-panel-subtle p-4" aria-labelledby="platform-add-member">
          <h3 id="platform-add-member" className="text-body font-bold text-text-primary">
            {c.addTitle}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={c.name} required>
              <TextInput value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={c.mobile} required>
              <TextInput
                type="tel"
                dir="ltr"
                inputMode="tel"
                autoComplete="off"
                value={mobileInput}
                onChange={(e) => setMobileInput(e.target.value)}
                placeholder="09xx xxx xxxx"
                className={codeFontClass(mobileInput)}
              />
            </Field>
          </div>
          <RolePicker value={role} onChange={setRole} locale={locale} confirm={false} busy={addRequest.busy} />
          {shownFormError && <Notice tone="danger">{shownFormError}</Notice>}
          {added && <Notice tone="success">{added}</Notice>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onClose}>
              {commonCopy[locale].close}
            </Button>
            <Button type="submit" variant="primary" icon="user-plus" loading={addRequest.busy}>
              {c.submit}
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}
