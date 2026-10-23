import { useEffect, useState, type FormEvent } from "react";
import { localizedApiError, type MemberOut, type OrganizerOut, type OrganizerRole } from "../api/client";
import { codeFontClass, formatLocalizedDate } from "../lib/i18n";
import { networkErrorMessage } from "../lib/errorMessages";
import { formatMobile, normalizeIranMobile } from "../lib/mobile";
import { ORGANIZER_ROLES, ROLE_COPY, inviterLabel, isOrganizerRole } from "../lib/organizerConsole";
import { useMutation } from "../hooks/useMutation";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Icon } from "../components/ui/Icon";
import { Field, FormAlert } from "../components/organizer/WorkspaceUi";
import { usePlatform } from "./platformContext";

const COPY = {
  fa: {
    title: (name: string) => `اعضای «${name}»`,
    description:
      "اعضا با شماره موبایل و کد پیامکی وارد کنسول برگزارکننده می‌شوند. مالکی که اینجا اضافه می‌کنید بقیهٔ اعضا را خودش از کنسول دعوت می‌کند.",
    loading: "در حال بارگیری اعضا…",
    loadFailed: "فهرست اعضا بارگیری نشد.",
    retry: "تلاش دوباره",
    empty: "هنوز عضوی ندارد. نخستین مالک را اضافه کنید.",
    active: "فعال",
    removed: "حذف‌شده",
    invitedBy: (who: string, date: string) => `افزوده‌شده به دست ${who} · ${date}`,
    addTitle: "افزودن عضو",
    name: "نام و نام خانوادگی",
    mobile: "شماره موبایل",
    role: "نقش",
    nameRequired: "نام عضو را وارد کنید.",
    mobileInvalid: "یک شماره موبایل معتبر وارد کنید؛ مثلاً ۰۹۱۲ ۳۴۵ ۶۷۸۹.",
    submit: "افزودن و ارسال پیامک",
    submitting: "در حال افزودن…",
    added: (name: string) => `${name} اضافه شد؛ پیامکی با نشانی کنسول برایش فرستاده می‌شود.`,
    failed: "عضو اضافه نشد.",
    close: "بستن",
  },
  en: {
    title: (name: string) => `Members of “${name}”`,
    description:
      "Members sign in to the organizer console with their mobile number and an SMS code. The owner you add here invites the rest from the console.",
    loading: "Loading members…",
    loadFailed: "The member list could not be loaded.",
    retry: "Try again",
    empty: "No members yet. Add the first owner.",
    active: "Active",
    removed: "Removed",
    invitedBy: (who: string, date: string) => `Added by ${who} · ${date}`,
    addTitle: "Add a member",
    name: "Full name",
    mobile: "Mobile number",
    role: "Role",
    nameRequired: "Enter the member's name.",
    mobileInvalid: "Enter a valid mobile number, e.g. 0912 345 6789.",
    submit: "Add and send SMS",
    submitting: "Adding…",
    added: (name: string) => `${name} was added and will receive an SMS with the console address.`,
    failed: "The member was not added.",
    close: "Close",
  },
} as const;

/**
 * An organizer's members as the platform admin sees them (`GET/POST /api/organizers/{id}/members`, ADR 0016):
 * who can sign in to its console, and adding the first owner by mobile number.
 */
export function PlatformOrganizerMembers({ organizer, isOpen, onClose }: { organizer: OrganizerOut; isOpen: boolean; onClose: () => void }) {
  const { client, checkResponse, locale } = usePlatform();
  const copy = COPY[locale];
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
        checkResponse(response.status);
        if (!active) return;
        if (data) {
          setMembers(data);
          setLoadError(null);
        } else setLoadError(error ? localizedApiError(error, locale) : copy.loadFailed);
      })
      .catch(() => {
        if (active) setLoadError(networkErrorMessage[locale]);
      });
    return () => {
      active = false;
    };
  }, [client, checkResponse, organizer.id, isOpen, reloads, locale, copy.loadFailed]);

  const retry = () => {
    setLoadError(null);
    setMembers(null);
    setReloads((n) => n + 1);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAdded(null);
    if (!name.trim()) return setFormError(copy.nameRequired);
    const mobile = normalizeIranMobile(mobileInput);
    if (!mobile) return setFormError(copy.mobileInvalid);
    setFormError(null);
    const result = await addRequest.run(() =>
      client.POST("/api/organizers/{organizer_id}/members", {
        params: { path: { organizer_id: organizer.id } },
        body: { display_name: name.trim(), mobile, role },
      }),
    );
    if (!result.ok) return;
    const { data, error, response } = result.value;
    checkResponse(response.status);
    if (!data) return setFormError(error ? localizedApiError(error, locale) : copy.failed);
    setMembers((prev) => [...(prev ?? []).filter((m) => m.id !== data.id), data]);
    setAdded(copy.added(data.display_name));
    setName("");
    setMobileInput("");
    setRole("owner");
  };

  const shownFormError = formError ?? addRequest.error;

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={copy.title(organizer.name)} description={copy.description} size="lg">
      <div className="space-y-6">
        {members === null && !loadError ? (
          <div role="status" aria-busy="true" className="skeleton h-24">
            <span className="sr-only">{copy.loading}</span>
          </div>
        ) : loadError ? (
          <div className="space-y-3">
            <FormAlert>{loadError}</FormAlert>
            <Button type="button" variant="secondary" size="md" onClick={retry}>
              <Icon name="sync" size={16} />
              {copy.retry}
            </Button>
          </div>
        ) : members && members.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-default px-4 py-5 text-center text-sm text-text-secondary">{copy.empty}</p>
        ) : (
          <ul data-testid="platform-members" className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-default">
            {members?.map((member) => {
              const removed = member.revoked_at !== null;
              const mobile = member.mobile ? formatMobile(member.mobile, locale) : null;
              return (
                <li key={member.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                  <div className="min-w-0 space-y-0.5">
                    <p className={`break-words text-sm font-semibold ${removed ? "text-text-secondary" : "text-text-primary"}`}>
                      <bdi>{member.display_name}</bdi>
                    </p>
                    {mobile && (
                      <p className={`text-xs text-text-muted ${codeFontClass(mobile)}`}>
                        <bdi dir="ltr">{mobile}</bdi>
                      </p>
                    )}
                    <p className="text-xs text-text-muted">
                      {copy.invitedBy(inviterLabel(member.invited_by, locale), formatLocalizedDate(member.created_at, locale))}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={member.role === "owner" ? "brand" : "neutral"} size="sm">
                      {roles[member.role].label}
                    </Badge>
                    <Badge variant={removed ? "neutral" : "success"} size="sm" dot={!removed}>
                      {removed ? copy.removed : copy.active}
                    </Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <form onSubmit={submit} noValidate className="space-y-4 rounded-xl border border-border-default bg-surface-panel-subtle p-4" aria-labelledby="platform-add-member">
          <h3 id="platform-add-member" className="text-sm font-bold text-text-primary">
            {copy.addTitle}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={copy.name} required>
              <input type="text" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} className="ui-input" />
            </Field>
            <Field label={copy.mobile} required>
              <input
                type="tel"
                dir="ltr"
                inputMode="tel"
                autoComplete="off"
                value={mobileInput}
                onChange={(e) => setMobileInput(e.target.value)}
                placeholder="09xx xxx xxxx"
                className={`ui-input ${codeFontClass(mobileInput)}`}
              />
            </Field>
          </div>
          <Field label={copy.role} hint={roles[role].summary}>
            <select
              value={role}
              onChange={(e) => {
                if (isOrganizerRole(e.target.value)) setRole(e.target.value);
              }}
              className="ui-select"
            >
              {ORGANIZER_ROLES.map((option) => (
                <option key={option} value={option}>
                  {roles[option].label}
                </option>
              ))}
            </select>
          </Field>
          {shownFormError && <FormAlert>{shownFormError}</FormAlert>}
          {added && (
            <p role="status" className="text-sm font-medium text-status-success-text">
              {added}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" size="md" onClick={onClose}>
              {copy.close}
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={addRequest.busy} aria-busy={addRequest.busy}>
              <Icon name="user-plus" size={16} />
              {addRequest.busy ? copy.submitting : copy.submit}
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}
