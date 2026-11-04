import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiErrorCode, createApiClient, localizedApiError, type UserOut } from "../api/client";
import { attendeeCopy } from "../copy/attendee";
import { commonCopy } from "../copy/common";
import { AttendeeLayout } from "../layouts/AttendeeLayout";
import { Icon } from "../components/ui/Icon";
import { Avatar } from "../components/ui/Avatar";
import { Button, LinkButton } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Dialog } from "../components/ui/Dialog";
import { Field } from "../components/ui/Field";
import { TextInput } from "../components/ui/Input";
import { Notice } from "../components/ui/Notice";
import { PageHeader, SectionHeader } from "../components/ui/PageHeader";
import { LoadingBlock } from "../components/ui/PortalState";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { ErrorState, StateBlock } from "../components/ui/StateBlock";
import { Switch } from "../components/ui/Switch";
import { useLocale, type AttendeeLocale } from "../lib/i18n";
import { attendeeResponseState, isStoredAttendeeToken } from "../lib/attendeeSession";
import { useAttendeeSession } from "../hooks/useAttendeeSession";
import { congressPath } from "../lib/congressContext";
import { formatMobile } from "../lib/mobile";
import { networkErrorMessage } from "../lib/errorMessages";
import { codeFontClass } from "../lib/i18n";
import { InlineSignIn } from "../components/attendee/InlineSignIn";

type ProfileState = { status: "loading" } | { status: "ready"; user: UserOut } | { status: "signed-out" } | { status: "error" };

type Message = { tone: "ok" | "error"; text: string } | null;
type SettingKey = "peers" | "exhibitors";

/** Each language is named in itself: the other language's toggle label. */
const LANGUAGES = [
  { value: "fa", label: commonCopy.en.languageToggle, lang: "fa" },
  { value: "en", label: commonCopy.fa.languageToggle, lang: "en" },
] as const satisfies readonly { value: AttendeeLocale; label: string; lang: string }[];

/**
 * The attendee's account: editable name, organization and title (they also update passes for congresses
 * still to come), contact-sharing consents, language, a copy of their data, sign-out and account deletion.
 */
export default function MyProfile() {
  const { slug = "" } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const localeHook = useLocale();
  const { locale, setLocale } = localeHook;
  const c = attendeeCopy[locale].profile;
  const { token, signOut } = useAttendeeSession();
  const [state, setState] = useState<ProfileState>({ status: "loading" });
  const [form, setForm] = useState({ full_name: "", organization: "", title: "" });
  const [saving, setSaving] = useState(false);
  const [detailsMessage, setDetailsMessage] = useState<Message>(null);
  const [settingBusy, setSettingBusy] = useState<SettingKey | null>(null);
  const [settingMessage, setSettingMessage] = useState<Message>(null);
  const [exporting, setExporting] = useState(false);
  const [dataMessage, setDataMessage] = useState<Message>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteWord, setDeleteWord] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  useEffect(() => {
    if (!token) return;
    let active = true;
    createApiClient({ kind: "user", token })
      .GET("/api/auth/me")
      .then((me) => {
        if (!active) return;
        const session = attendeeResponseState(token, me.response.status);
        if (session === "changed") return;
        if (session === "expired") {
          setState({ status: "signed-out" });
        } else if (me.data) {
          setState({ status: "ready", user: me.data });
          setForm({ full_name: me.data.full_name, organization: me.data.organization, title: me.data.title });
        } else {
          setState({ status: "error" });
        }
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [token]);

  /** The visible values are the ones the server persisted, not the ones asked for. */
  const applyUser = (user: UserOut) => setState((prev) => (prev.status === "ready" ? { ...prev, user } : prev));

  /** A session that changed or ended meanwhile shows the signed-out state; true when the token is still current. */
  const stillSignedIn = (current: string, status?: number) => {
    const session = status === undefined ? (isStoredAttendeeToken(current) ? "current" : "changed") : attendeeResponseState(current, status);
    if (session !== "current") setState({ status: "signed-out" });
    return session === "current";
  };

  const saveDetails = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || saving) return;
    const body = { full_name: form.full_name.trim(), organization: form.organization.trim(), title: form.title.trim() };
    if (!body.full_name) return setDetailsMessage({ tone: "error", text: c.nameRequired });
    if (!stillSignedIn(token)) return;
    setSaving(true);
    setDetailsMessage(null);
    try {
      const { data, error, response } = await createApiClient({ kind: "user", token }).PATCH("/api/auth/me", { body });
      if (!stillSignedIn(token, response.status)) return;
      if (data) {
        applyUser(data);
        setForm({ full_name: data.full_name, organization: data.organization, title: data.title });
        setDetailsMessage({ tone: "ok", text: c.saved });
      } else {
        setDetailsMessage({ tone: "error", text: apiErrorCode(error) ? localizedApiError(error, locale) : c.saveFailed });
      }
    } catch {
      setDetailsMessage({ tone: "error", text: networkErrorMessage[locale] });
    } finally {
      setSaving(false);
    }
  };

  const toggleSetting = async (key: SettingKey, user: UserOut) => {
    if (!token || settingBusy) return;
    if (!stillSignedIn(token)) return;
    setSettingBusy(key);
    setSettingMessage(null);
    const client = createApiClient({ kind: "user", token });
    try {
      if (key === "peers") {
        const { data, response } = await client.PATCH("/api/attendees/me/network/privacy", {
          body: { share_contact_with_peers: !user.share_contact_with_peers },
        });
        if (!stillSignedIn(token, response.status)) return;
        if (!data) return setSettingMessage({ tone: "error", text: c.settingFailed });
        applyUser({ ...user, share_contact_with_peers: data.share_contact_with_peers });
      } else {
        const { data, response } = await client.PATCH("/api/auth/me", {
          body: { share_contact_with_exhibitors: !user.share_contact_with_exhibitors },
        });
        if (!stillSignedIn(token, response.status)) return;
        if (!data) return setSettingMessage({ tone: "error", text: c.settingFailed });
        applyUser({ ...user, share_contact_with_exhibitors: data.share_contact_with_exhibitors });
      }
      setSettingMessage({ tone: "ok", text: c.settingSaved });
    } catch {
      setSettingMessage({ tone: "error", text: networkErrorMessage[locale] });
    } finally {
      setSettingBusy(null);
    }
  };

  const exportData = async () => {
    if (!token || exporting) return;
    if (!stillSignedIn(token)) return;
    setExporting(true);
    setDataMessage(null);
    try {
      const { data, response } = await createApiClient({ kind: "user", token }).GET("/api/auth/me/export");
      if (!stillSignedIn(token, response.status)) return;
      if (!data) return setDataMessage({ tone: "error", text: c.exportFailed });
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "my-congress-data.json";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setDataMessage({ tone: "error", text: c.exportFailed });
    } finally {
      setExporting(false);
    }
  };

  const closeDelete = () => {
    if (deleting) return;
    setConfirmingDelete(false);
    setDeleteWord("");
    setDeleteError(null);
  };

  const wordMatches = [attendeeCopy.fa.profile.deleteWord, attendeeCopy.en.profile.deleteWord].some((w) => deleteWord.trim().toLowerCase() === w.toLowerCase());

  const deleteAccount = async () => {
    if (!token || deleting || !wordMatches) return;
    if (!stillSignedIn(token)) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const { response } = await createApiClient({ kind: "user", token }).DELETE("/api/auth/me");
      if (response.ok) {
        // The account is anonymised and this session no longer works: end it on this device too.
        setDeleted(true);
        setConfirmingDelete(false);
        signOut();
        return;
      }
      if (!stillSignedIn(token, response.status)) return;
      setDeleteError(c.deleteFailed);
    } catch {
      setDeleteError(networkErrorMessage[locale]);
    } finally {
      setDeleting(false);
    }
  };

  const signOutHere = () => {
    setConfirmingSignOut(false);
    signOut();
    navigate(slug ? congressPath(slug, "my-congress") : "/");
  };

  const view = deleted ? { status: "deleted" as const } : !token ? { status: "signed-out" as const } : state;
  let content;
  if (view.status === "deleted") {
    content = (
      <div role="status">
        <StateBlock
          icon="check-circle"
          title={c.deletedTitle}
          body={c.deletedBody}
          action={
            <LinkButton to={slug ? `/e/${encodeURIComponent(slug)}` : "/"} variant="secondary">
              {c.backHome}
            </LinkButton>
          }
        />
      </div>
    );
  } else if (view.status === "loading") {
    content = <LoadingBlock label={c.title} />;
  } else if (view.status === "signed-out") {
    content = <InlineSignIn locale={locale} title={c.signInTitle} body={c.signInBody} />;
  } else if (view.status === "error") {
    content = <ErrorState title={c.loadFailedTitle} body={c.loadFailedBody} onRetry={() => window.location.reload()} />;
  } else {
    const { user } = view;
    const dirty = form.full_name.trim() !== user.full_name || form.organization.trim() !== user.organization || form.title.trim() !== user.title;
    const field = (key: keyof typeof form, label: string, max: number, required = false) => (
      <Field label={label} required={required}>
        <TextInput
          dir="auto"
          required={required}
          maxLength={max}
          autoComplete={key === "full_name" ? "name" : key === "organization" ? "organization" : "organization-title"}
          value={form[key]}
          onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
        />
      </Field>
    );
    content = (
      <>
        <div className="flex items-center gap-4">
          <Avatar name={user.full_name} seed={user.id} size="lg" ring />
          <PageHeader
            className="min-w-0"
            title={<bdi>{user.full_name}</bdi>}
            meta={(user.title || user.organization) && <bdi>{[user.title, user.organization].filter(Boolean).join(" · ")}</bdi>}
          />
        </div>

        <div className="grid items-start gap-8 lg:grid-cols-12">
          {/* Details (editable) */}
          <section aria-labelledby="profile-details-title" className="space-y-4 lg:col-span-7">
            <SectionHeader id="profile-details-title" title={c.detailsTitle} />
            <form onSubmit={(e) => void saveDetails(e)} className="space-y-4" noValidate>
              {field("full_name", c.fullName, 200, true)}
              {field("organization", c.organization, 200)}
              {field("title", c.jobTitle, 100)}
              <Field label={c.mobile} hint={c.mobileFixed}>
                <p className="flex min-h-12 items-center gap-2 rounded-control border border-border-subtle bg-surface-panel-subtle px-3 text-sm text-text-secondary">
                  <Icon name="phone" size={16} className="text-ink-400" />
                  {user.mobile ? <bdi dir="ltr" className={codeFontClass(formatMobile(user.mobile, locale))}>{formatMobile(user.mobile, locale)}</bdi> : "—"}
                  <Icon name="lock" size={14} className="ms-auto text-ink-400" />
                </p>
              </Field>
              {detailsMessage && <Notice tone={detailsMessage.tone}>{detailsMessage.text}</Notice>}
              {dirty && (
                <div
                  data-testid="profile-save-bar"
                  className="sticky bottom-[calc(4.75rem+max(env(safe-area-inset-bottom),0.75rem))] z-30 -mx-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-default bg-surface-page/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none"
                >
                  <Button type="submit" variant="primary" size="lg" icon="check" loading={saving}>
                    {saving ? c.saving : c.save}
                  </Button>
                  <span className="text-xs text-text-muted">{c.updatesPass}</span>
                </div>
              )}
            </form>
          </section>

          <div className="space-y-6 lg:col-span-5">
            {/* Privacy */}
            <Card className="space-y-4 p-5">
              <h2 className="text-title-sm font-bold text-text-primary">{c.privacyTitle}</h2>
              <Switch
                label={c.peersLabel}
                description={c.peersDesc}
                checked={user.share_contact_with_peers}
                busy={settingBusy === "peers"}
                onChange={() => void toggleSetting("peers", user)}
              />
              <Switch
                label={c.exhibitorsLabel}
                description={c.exhibitorsDesc}
                checked={Boolean(user.share_contact_with_exhibitors)}
                busy={settingBusy === "exhibitors"}
                onChange={() => void toggleSetting("exhibitors", user)}
              />
              {settingMessage && <Notice tone={settingMessage.tone}>{settingMessage.text}</Notice>}
            </Card>

            {/* Language */}
            <Card className="space-y-3 p-5">
              <h2 id="profile-language-title" className="text-title-sm font-bold text-text-primary">{c.languageTitle}</h2>
              <SegmentedControl labelledBy="profile-language-title" options={LANGUAGES} value={locale} onChange={setLocale} />
            </Card>

            {/* Data, sign-out, deletion */}
            <Card className="space-y-5 p-5">
              <h2 className="text-title-sm font-bold text-text-primary">{c.dataTitle}</h2>
              <div className="space-y-2">
                <Button type="button" variant="secondary" size="md" icon="download" isFullWidth loading={exporting} onClick={() => void exportData()}>
                  {exporting ? c.exporting : c.exportLabel}
                </Button>
                <p className="text-xs leading-relaxed text-text-muted">{c.exportDesc}</p>
                {dataMessage && <Notice tone={dataMessage.tone}>{dataMessage.text}</Notice>}
              </div>
              <Button type="button" variant="secondary" size="md" icon="logout" isFullWidth onClick={() => setConfirmingSignOut(true)}>
                {c.signOut}
              </Button>
              <div className="space-y-2 rounded-control border border-status-danger-border bg-status-danger-bg/50 p-4">
                <h3 className="text-sm font-semibold text-status-danger-text">{c.deleteTitle}</h3>
                <p className="text-xs leading-relaxed text-text-secondary">{c.deleteDesc}</p>
                <Button type="button" variant="danger" size="md" icon="trash" onClick={() => setConfirmingDelete(true)}>
                  {c.deleteAction}
                </Button>
              </div>
            </Card>
          </div>
        </div>

        <ConfirmDialog
          isOpen={confirmingSignOut}
          title={attendeeCopy[locale].shell.logoutTitle}
          description={attendeeCopy[locale].shell.logoutBody}
          confirmLabel={attendeeCopy[locale].shell.logoutConfirm}
          tone="danger"
          onConfirm={signOutHere}
          onCancel={() => setConfirmingSignOut(false)}
        />

        <Dialog
          isOpen={confirmingDelete}
          onClose={closeDelete}
          title={c.deleteDialogTitle}
          description={c.deleteDialogLead}
          size="md"
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" size="md" onClick={closeDelete} disabled={deleting}>
                {commonCopy[locale].cancel}
              </Button>
              <Button type="submit" form="delete-account-form" variant="danger" size="md" icon="trash" disabled={!wordMatches} loading={deleting}>
                {deleting ? c.deleting : c.deleteConfirm}
              </Button>
            </div>
          }
        >
          <form
            id="delete-account-form"
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void deleteAccount();
            }}
          >
            <ul className="space-y-2 text-sm leading-relaxed text-text-secondary">
              {c.deleteConsequences.map((line: string) => (
                <li key={line} className="flex items-start gap-2">
                  <Icon name="x-circle" size={16} className="mt-0.5 shrink-0 text-status-danger-text" />
                  {line}
                </li>
              ))}
            </ul>
            <p className="rounded-control bg-surface-panel-subtle p-3 text-xs leading-relaxed text-text-secondary">{c.deleteExportHint}</p>
            <Field label={c.deleteTypeLabel(c.deleteWord)} error={deleteError}>
              <TextInput autoComplete="off" autoCapitalize="none" spellCheck={false} value={deleteWord} onChange={(e) => setDeleteWord(e.target.value)} />
            </Field>
          </form>
        </Dialog>
      </>
    );
  }

  return (
    <AttendeeLayout localeProps={localeHook} eventSlug={slug} destination="my-profile">
      <div className="mx-auto max-w-5xl space-y-6 px-4 pt-5 sm:space-y-8 sm:px-6 sm:pt-8">{content}</div>
    </AttendeeLayout>
  );
}
