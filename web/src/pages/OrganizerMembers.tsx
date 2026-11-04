import React, { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { apiErrorCode, createApiClient, localizedApiError, type MemberOut, type OrganizerRole } from "../api/client";
import { codeFontClass, formatMobile } from "../lib/format";
import { normalizeIranMobile } from "../lib/mobile";
import { ROLE_COPY } from "../lib/organizerConsole";
import { focusFirstInvalid } from "../lib/organizerWorkspace";
import { organizerCopy } from "../copy/organizer";
import { commonCopy } from "../copy/common";
import type { OrganizerOutletContext } from "./OrganizerLayout";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Button, LinkButton } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Field } from "../components/ui/Field";
import { TextInput } from "../components/ui/Input";
import { Notice } from "../components/ui/Notice";
import { PageHeader } from "../components/ui/PageHeader";
import { RowActions } from "../components/ui/RowActions";
import { EmptyState, ErrorState, LoadingState, StateBlock } from "../components/ui/StateBlock";
import { RolePicker } from "../components/organizer/RolePicker";
import { DialogActions, FormAlert } from "../components/organizer/WorkspaceUi";

type MemberNotice = { tone: "ok" | "error"; text: string } | null;
type LoadFailure = { body: unknown; status: number };

/** `/organizer/members`: who signs in to this organizer's console, with which role (ADR 0016). Owners change it. */
export default function OrganizerMembers() {
  const { apiKey, session, locale } = useOutletContext<OrganizerOutletContext>();
  const copy = organizerCopy[locale];
  const roles = ROLE_COPY[locale];
  const isOwner = session?.role === "owner";
  const [members, setMembers] = useState<MemberOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [notice, setNotice] = useState<MemberNotice>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleTarget, setRoleTarget] = useState<MemberOut | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!apiKey) return;
    let alive = true;
    // A 401 reaches the layout's sign-in gate through the API client; no connection resolves to an error result.
    void createApiClient({ kind: "organizer", token: apiKey }, { networkErrors: "result" })
      .GET("/api/organizer/members")
      .then(({ data, error, response }) => {
        if (!alive) return;
        if (data) setMembers(data);
        else setFailure({ body: error, status: response.status });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [apiKey, reloadToken]);

  const client = () => createApiClient({ kind: "organizer", token: apiKey ?? "" }, { networkErrors: "result" });
  const replace = (saved: MemberOut) =>
    setMembers((prev) => (prev.some((m) => m.id === saved.id) ? prev.map((m) => (m.id === saved.id ? saved : m)) : [...prev, saved]));

  const changeRole = async (member: MemberOut, role: OrganizerRole) => {
    if (!apiKey || role === member.role) return;
    setBusyId(member.id);
    const { data, error, response } = await client().PATCH("/api/organizer/members/{member_id}", {
      params: { path: { member_id: member.id } },
      body: { role },
    });
    setBusyId(null);
    setRoleTarget(null);
    if (data) {
      replace(data);
      setNotice({ tone: "ok", text: copy.members.roleSaved(data.display_name) });
    } else {
      setNotice({ tone: "error", text: localizedApiError(error, locale, response.status) });
    }
  };

  const remove = async (member: MemberOut) => {
    if (!apiKey) return;
    setBusyId(member.id);
    const { data, error, response } = await client().POST("/api/organizer/members/{member_id}/revoke", {
      params: { path: { member_id: member.id } },
    });
    setBusyId(null);
    if (data) {
      replace(data);
      setNotice({ tone: "ok", text: copy.members.removed(data.display_name) });
    } else {
      setNotice({ tone: "error", text: localizedApiError(error, locale, response.status) });
    }
  };

  const addButton = isOwner ? (
    <Button type="button" variant="primary" icon="user-plus" onClick={() => setInviteOpen(true)}>
      {copy.members.create}
    </Button>
  ) : undefined;

  const forbidden = failure && (failure.status === 403 || apiErrorCode(failure.body) === "ROLE_FORBIDDEN");

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader title={copy.members.title} actions={members.length > 0 ? addButton : undefined} />

      {notice && (
        <Notice tone={notice.tone} onDismiss={() => setNotice(null)} dismissLabel={commonCopy[locale].dismissMessage}>
          {notice.text}
        </Notice>
      )}

      {loading ? (
        <LoadingState />
      ) : forbidden ? (
        <StateBlock
          kind="forbidden"
          title={copy.members.forbidden}
          action={
            <LinkButton to="/organizer" variant="secondary" icon="arrow-left">
              {copy.shell.congresses}
            </LinkButton>
          }
        />
      ) : failure ? (
        <ErrorState
          title={copy.members.loadFailed}
          offline={failure.status === 503}
          body={localizedApiError(failure.body, locale, failure.status)}
          onRetry={() => {
            setLoading(true);
            setFailure(null);
            setReloadToken((n) => n + 1);
          }}
          retryLabel={commonCopy[locale].retry}
        />
      ) : members.length === 0 ? (
        <EmptyState icon="users" title={copy.members.noMembers} body={copy.members.noMembersBody} action={addButton} />
      ) : (
        <div className="overflow-clip rounded-card border border-border-default bg-surface-panel shadow-soft">
          <table className="org-table org-table--stack" data-testid="members-table">
            <caption className="sr-only">{copy.members.title}</caption>
            <thead>
              <tr>
                <th scope="col">{copy.members.nameLabel}</th>
                <th scope="col">{copy.members.roleLabel}</th>
                <th scope="col">{copy.members.statusLabel}</th>
                {isOwner && (
                  <th scope="col">
                    <span className="sr-only">{copy.members.actionsLabel}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const removed = member.revoked_at !== null;
                const isSelf = session?.member?.id === member.id;
                const mobile = member.mobile ? formatMobile(member.mobile, locale) : "";
                return (
                  <tr key={member.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <Avatar name={member.display_name} seed={member.id} size="sm" className={removed ? "opacity-50" : ""} />
                        <div className="min-w-0">
                          <p className={`break-words text-body-sm font-semibold ${removed ? "text-text-secondary" : "text-text-primary"}`}>
                            <bdi>{member.display_name}</bdi>
                            {isSelf && <span className="ms-2 text-caption font-medium text-text-muted">({copy.members.you})</span>}
                          </p>
                          {mobile && (
                            <p className={`text-caption text-text-muted ${codeFontClass(mobile)}`}>
                              <bdi dir="ltr">{mobile}</bdi>
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td data-label={copy.members.roleLabel}>
                      <Badge variant={member.role === "owner" ? "brand" : "neutral"} size="sm">
                        {roles[member.role].label}
                      </Badge>
                    </td>
                    <td data-label={copy.members.statusLabel}>
                      <Badge variant={removed ? "neutral" : "success"} size="sm" dot={!removed}>
                        {removed ? commonCopy[locale].status.accessRemoved : commonCopy[locale].status.active}
                      </Badge>
                    </td>
                    {isOwner && (
                      <td className="text-end">
                        {!removed && (
                          <RowActions
                            visible={0}
                            menuLabel={copy.members.actionsFor(member.display_name)}
                            actions={[
                              { label: copy.members.changeRole, icon: "users", disabled: busyId === member.id, onSelect: () => setRoleTarget(member) },
                              {
                                label: copy.members.removeAction,
                                icon: "lock",
                                disabled: busyId === member.id,
                                onSelect: () => void remove(member),
                                destructive: {
                                  title: copy.members.removeTitle(member.display_name),
                                  description: copy.members.removeDesc(member.display_name),
                                  confirmLabel: copy.members.removeAction,
                                },
                              },
                            ]}
                          />
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog isOpen={roleTarget !== null} onClose={() => setRoleTarget(null)} title={roleTarget ? copy.members.roleOf(roleTarget.display_name) : ""} size="md">
        {roleTarget && (
          <RolePicker
            value={roleTarget.role}
            locale={locale}
            memberName={roleTarget.display_name}
            busy={busyId === roleTarget.id}
            onChange={(role) => void changeRole(roleTarget, role)}
          />
        )}
      </Dialog>

      <InviteDialog
        isOpen={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSaved={(saved) => {
          replace(saved);
          setInviteOpen(false);
          setNotice({ tone: "ok", text: copy.members.invited(saved.display_name) });
        }}
      />
    </div>
  );
}

function InviteDialog({ isOpen, onClose, onSaved }: { isOpen: boolean; onClose: () => void; onSaved: (member: MemberOut) => void }) {
  const { apiKey, locale } = useOutletContext<OrganizerOutletContext>();
  const copy = organizerCopy[locale].members;
  const [name, setName] = useState("");
  const [mobileInput, setMobileInput] = useState("");
  const [role, setRole] = useState<OrganizerRole>("staff");
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<"name" | "mobile" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const mobile = normalizeIranMobile(mobileInput);
    const found = !name.trim() ? "name" : !mobile ? "mobile" : null;
    setProblem(found);
    setFormError(null);
    if (found) {
      // The first invalid field gets focus once its error is rendered.
      requestAnimationFrame(() => focusFirstInvalid(form));
      return;
    }
    if (!apiKey || !mobile) return;
    setSubmitting(true);
    const { data, error, response } = await createApiClient({ kind: "organizer", token: apiKey }, { networkErrors: "result" }).POST("/api/organizer/members", {
      body: { display_name: name.trim(), mobile, role },
    });
    setSubmitting(false);
    if (data) {
      setName("");
      setMobileInput("");
      setRole("staff");
      onSaved(data);
    } else {
      setFormError(localizedApiError(error, locale, response.status));
    }
  };

  const close = () => {
    if (submitting) return;
    setProblem(null);
    setFormError(null);
    onClose();
  };

  return (
    <Dialog isOpen={isOpen} onClose={close} title={copy.create} description={copy.inviteDesc} size="md">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label={copy.nameLabel} required error={problem === "name" ? copy.nameRequired : undefined}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </Field>
        <Field label={copy.mobileLabel} required error={problem === "mobile" ? commonCopy[locale].mobileInvalid : undefined}>
          <TextInput
            type="tel"
            dir="ltr"
            inputMode="tel"
            autoComplete="off"
            value={mobileInput}
            onChange={(e) => setMobileInput(e.target.value)}
            className={codeFontClass(mobileInput)}
          />
        </Field>
        <RolePicker value={role} onChange={setRole} locale={locale} confirm={false} legend={copy.roleLabel} />
        {formError && <FormAlert>{formError}</FormAlert>}
        <DialogActions>
          <Button type="button" variant="ghost" disabled={submitting} onClick={close}>
            {commonCopy[locale].cancel}
          </Button>
          <Button type="submit" variant="primary" loading={submitting}>
            {organizerCopy[locale].form.add}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
