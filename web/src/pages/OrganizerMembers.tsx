import React, { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { createApiClient, localizedApiError, type MemberOut, type OrganizerRole } from "../api/client";
import { formatLocalizedDate } from "../lib/i18n";
import { formatMobile, normalizeIranMobile } from "../lib/mobile";
import { CONSOLE_COPY, ORGANIZER_ROLES, ROLE_COPY, isOrganizerRole } from "../lib/organizerConsole";
import type { OrganizerOutletContext } from "./OrganizerLayout";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Dialog } from "../components/ui/Dialog";
import { Icon } from "../components/ui/Icon";
import { DialogActions, EmptyState, Field, FormAlert, Notice, SectionHeader } from "../components/organizer/WorkspaceUi";

type Notice = { tone: "ok" | "error"; text: string } | null;

/** `/organizer/members`: who signs in to this organizer's console, with which role (ADR 0016). */
export default function OrganizerMembers() {
  const { apiKey, session, locale, isRtl } = useOutletContext<OrganizerOutletContext>();
  const copy = CONSOLE_COPY[locale];
  const roles = ROLE_COPY[locale];
  const isOwner = session?.role === "owner";
  const [members, setMembers] = useState<MemberOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<MemberOut | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!apiKey) return;
    let alive = true;
    // A 401 reaches the layout's sign-in gate through the API client (registerUnauthorizedHandler).
    void createApiClient({ kind: "organizer", token: apiKey })
      .GET("/api/organizer/members")
      .then(({ data, error }) => {
        if (!alive) return;
        setLoading(false);
        if (data) setMembers(data);
        else setLoadError(localizedApiError(error, locale));
      });
    return () => {
      alive = false;
    };
  }, [apiKey, locale, reloadToken]);

  const retry = () => {
    setLoading(true);
    setLoadError(null);
    setReloadToken((n) => n + 1);
  };

  const replace = (saved: MemberOut) =>
    setMembers((prev) => (prev.some((m) => m.id === saved.id) ? prev.map((m) => (m.id === saved.id ? saved : m)) : [...prev, saved]));

  const changeRole = async (member: MemberOut, role: OrganizerRole) => {
    if (!apiKey || role === member.role) return;
    setBusyId(member.id);
    const { data, error } = await createApiClient({ kind: "organizer", token: apiKey }).PATCH("/api/organizer/members/{member_id}", {
      params: { path: { member_id: member.id } },
      body: { role },
    });
    setBusyId(null);
    if (data) {
      replace(data);
      setNotice({ tone: "ok", text: copy.roleSaved(data.display_name) });
    } else {
      setNotice({ tone: "error", text: localizedApiError(error, locale) });
    }
  };

  const remove = async (member: MemberOut) => {
    if (!apiKey) return;
    setBusyId(member.id);
    const { data, error } = await createApiClient({ kind: "organizer", token: apiKey }).POST("/api/organizer/members/{member_id}/revoke", {
      params: { path: { member_id: member.id } },
    });
    setBusyId(null);
    if (data) {
      replace(data);
      setNotice({ tone: "ok", text: copy.removed(data.display_name) });
    } else {
      setNotice({ tone: "error", text: localizedApiError(error, locale) });
    }
  };

  const addButton = isOwner ? (
    <Button type="button" variant="primary" size="md" onClick={() => setInviteOpen(true)}>
      <Icon name="user-plus" size={18} />
      {copy.inviteAction}
    </Button>
  ) : undefined;

  return (
    <div className="space-y-8 sm:space-y-10">
      <SectionHeader
        eyebrow={session ? <bdi>{session.organizer.name}</bdi> : copy.membersEyebrow}
        title={copy.membersTitle}
        description={copy.membersDesc}
        action={addButton}
      />

      {notice && (
        <Notice tone={notice.tone} onDismiss={() => setNotice(null)} dismissLabel={isRtl ? "بستن" : "Dismiss"}>
          {notice.text}
        </Notice>
      )}
      {!isOwner && session && (
        <p className="flex items-start gap-2.5 text-sm text-text-secondary">
          <Icon name="info" size={18} className="mt-0.5 shrink-0 text-aiteb-slate" />
          {copy.readOnly}
        </p>
      )}

      {loading ? (
        <div role="status" aria-busy="true" className="min-h-40">
          <span className="sr-only">{copy.loading}</span>
        </div>
      ) : loadError ? (
        <div className="space-y-3">
          <FormAlert>{loadError}</FormAlert>
          <Button type="button" variant="secondary" size="sm" onClick={retry}>
            <Icon name="sync" size={16} />
            {copy.retry}
          </Button>
        </div>
      ) : members.length === 0 ? (
        <EmptyState icon="users" title={copy.noMembers} action={addButton}>
          {copy.noMembersBody}
        </EmptyState>
      ) : (
        <div className="overflow-clip rounded-2xl border border-border-default bg-surface-panel shadow-soft">
          <table className="org-table org-table--stack" data-testid="members-table">
            <caption className="sr-only">{copy.membersTitle}</caption>
            <thead>
              <tr>
                <th scope="col">{copy.nameLabel}</th>
                <th scope="col">{copy.roleLabel}</th>
                <th scope="col">{isRtl ? "وضعیت" : "Status"}</th>
                <th scope="col">
                  <span className="sr-only">{isRtl ? "عملیات" : "Actions"}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const removed = member.revoked_at !== null;
                const isSelf = session?.member?.id === member.id;
                return (
                  <tr key={member.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden="true"
                          className={`grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold ${
                            removed ? "bg-surface-panel-inset text-text-muted" : "bg-aiteb-lavender text-aiteb-indigo"
                          }`}
                        >
                          {member.display_name.trim().charAt(0).toUpperCase() || "•"}
                        </span>
                        <div className="min-w-0">
                          <h3 className={`break-words text-sm font-semibold ${removed ? "text-text-secondary" : "text-text-primary"}`}>
                            <bdi>{member.display_name}</bdi>
                            {isSelf && <span className="ms-2 text-xs font-medium text-text-muted">({copy.you})</span>}
                          </h3>
                          {member.mobile && (
                            <p className="break-all font-mono text-xs text-text-muted">
                              <bdi dir="ltr">{formatMobile(member.mobile, locale)}</bdi>
                            </p>
                          )}
                          <p className="text-xs text-text-muted">
                            {copy.invitedBy(member.invited_by)} · {formatLocalizedDate(member.created_at, locale)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td data-label={copy.roleLabel}>
                      {isOwner && !removed ? (
                        <select
                          value={member.role}
                          aria-label={copy.roleChangeLabel(member.display_name)}
                          disabled={busyId === member.id}
                          onChange={(e) => {
                            if (isOrganizerRole(e.target.value)) void changeRole(member, e.target.value);
                          }}
                          className="ui-input min-h-10 w-auto py-1.5 text-sm"
                        >
                          {ORGANIZER_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {roles[role].label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Badge variant={member.role === "owner" ? "brand" : "neutral"} size="sm">
                          {roles[member.role].label}
                        </Badge>
                      )}
                    </td>
                    <td data-label={isRtl ? "وضعیت" : "Status"}>
                      <Badge variant={removed ? "neutral" : "success"} size="sm" dot={!removed}>
                        {removed ? copy.removedStatus : copy.active}
                      </Badge>
                    </td>
                    <td className="text-end">
                      {isOwner && !removed && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={busyId === member.id}
                          aria-busy={busyId === member.id}
                          onClick={() => setRemoveTarget(member)}
                          className="!text-status-danger-text hover:!border-status-danger-border hover:!bg-status-danger-bg"
                        >
                          <Icon name="lock" size={16} />
                          <span>{copy.removeAction}</span>
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <dl className="grid max-w-3xl gap-3 text-sm sm:grid-cols-2">
        {ORGANIZER_ROLES.map((role) => (
          <div key={role} className="rounded-xl border border-border-default bg-surface-panel px-4 py-3">
            <dt className="font-semibold text-text-primary">{roles[role].label}</dt>
            <dd className="mt-0.5 text-text-secondary">{roles[role].summary}</dd>
          </div>
        ))}
      </dl>

      <InviteDialog
        isOpen={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSaved={(saved) => {
          replace(saved);
          setInviteOpen(false);
          setNotice({ tone: "ok", text: copy.invited(saved.display_name) });
        }}
      />

      <ConfirmDialog
        isOpen={removeTarget !== null}
        tone="danger"
        title={copy.removeTitle}
        description={removeTarget ? copy.removeDesc(removeTarget.display_name) : ""}
        confirmLabel={copy.removeAction}
        cancelLabel={copy.cancel}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => {
          const target = removeTarget;
          setRemoveTarget(null);
          if (target) void remove(target);
        }}
      />
    </div>
  );
}

function InviteDialog({ isOpen, onClose, onSaved }: { isOpen: boolean; onClose: () => void; onSaved: (member: MemberOut) => void }) {
  const { apiKey, locale } = useOutletContext<OrganizerOutletContext>();
  const copy = CONSOLE_COPY[locale];
  const roles = ROLE_COPY[locale];
  const [name, setName] = useState("");
  const [mobileInput, setMobileInput] = useState("");
  const [role, setRole] = useState<OrganizerRole>("staff");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setFormError(copy.nameRequired);
    const mobile = normalizeIranMobile(mobileInput);
    if (!mobile) return setFormError(copy.mobileInvalid);
    if (!apiKey) return;
    setSubmitting(true);
    setFormError(null);
    const { data, error } = await createApiClient({ kind: "organizer", token: apiKey }).POST("/api/organizer/members", {
      body: { display_name: name.trim(), mobile, role },
    });
    setSubmitting(false);
    if (data) {
      setName("");
      setMobileInput("");
      setRole("staff");
      onSaved(data);
    } else {
      setFormError(localizedApiError(error, locale));
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => {
        if (!submitting) {
          setFormError(null);
          onClose();
        }
      }}
      title={copy.inviteTitle}
      description={copy.inviteDesc}
      size="md"
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label={copy.nameLabel} required>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} className="ui-input" />
        </Field>
        <Field label={copy.mobileLabel} required>
          <input
            type="tel"
            dir="ltr"
            inputMode="tel"
            autoComplete="off"
            value={mobileInput}
            onChange={(e) => setMobileInput(e.target.value)}
            placeholder="09xx xxx xxxx"
            className="ui-input font-mono"
          />
        </Field>
        <fieldset className="space-y-2">
          <legend className="ui-label">{copy.roleLabel}</legend>
          {ORGANIZER_ROLES.map((option) => (
            <label
              key={option}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-border-default px-3.5 py-2.5 has-[:checked]:border-action-primary has-[:checked]:bg-action-subtle"
            >
              <input type="radio" name="member-role" value={option} checked={role === option} onChange={() => setRole(option)} className="mt-1" />
              <span>
                <span className="block text-sm font-semibold text-text-primary">{roles[option].label}</span>
                <span className="block text-xs text-text-secondary">{roles[option].summary}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {formError && <FormAlert>{formError}</FormAlert>}
        <DialogActions>
          <Button type="button" variant="ghost" size="md" disabled={submitting} onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button type="submit" variant="primary" size="md" disabled={submitting} aria-busy={submitting}>
            {submitting ? copy.inviting : copy.inviteSubmit}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
