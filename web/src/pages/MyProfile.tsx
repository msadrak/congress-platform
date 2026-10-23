import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiErrorCode, createApiClient, localizedApiError, type UserOut } from "../api/client";
import { AttendeeLayout } from "../layouts/AttendeeLayout";
import { Icon } from "../components/ui/Icon";
import { Button, LinkButton } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { ArcMotif } from "../components/brand/Aiteb";
import { codeFontClass, useAttendeeLocale, type AttendeeLocale } from "../lib/i18n";
import { attendeeResponseState, isStoredAttendeeToken } from "../lib/attendeeSession";
import { useAttendeeSession } from "../hooks/useAttendeeSession";
import { congressPath } from "../lib/congressContext";
import { signInPath } from "../lib/safeRedirect";
import { formatMobile } from "../lib/mobile";
import { networkErrorMessage } from "../lib/errorMessages";
import { LoadingBlock, StatusPanel } from "../components/ui/PortalState";
import { Monogram } from "../components/attendee/Monogram";
import { SectionHeader } from "../components/attendee/SectionHeader";
import { SettingSwitch } from "../components/attendee/SettingSwitch";
import { SignInPrompt } from "../components/attendee/SignInPrompt";
import { profileCopy } from "../components/attendee/attendeeCopy";
import { sectionIndex } from "../components/attendee/congressTime";

type ProfileState = { status: "loading" } | { status: "ready"; user: UserOut } | { status: "signed-out" } | { status: "error" };

type Message = { tone: "ok" | "error"; text: string } | null;
type SettingKey = "peers" | "exhibitors";

const LANGUAGES: { value: AttendeeLocale; label: string; lang: string }[] = [
  { value: "fa", label: "فارسی", lang: "fa" },
  { value: "en", label: "English", lang: "en" },
];

function MessageLine({ message }: { message: Message }) {
  if (!message) return null;
  const error = message.tone === "error";
  return (
    <p
      role={error ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-xl border p-3 text-xs leading-relaxed ${
        error ? "border-status-danger-border bg-status-danger-bg text-status-danger-text" : "border-action-subtle-border bg-action-subtle text-action-primary"
      }`}
    >
      <Icon name={error ? "alert" : "check-circle"} size={15} className="mt-px shrink-0" />
      {message.text}
    </p>
  );
}

const panel = "relative space-y-5 overflow-hidden rounded-[var(--radius-xl)] border border-border-default bg-surface-panel p-6 shadow-soft sm:p-7";

/**
 * The attendee's account: editable name, organization and title (they also update passes for congresses
 * still to come), contact-sharing consents, language, a copy of their data, sign-out and account deletion.
 */
export default function MyProfile() {
  const { slug = "" } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const localeHook = useAttendeeLocale();
  const { locale, t, setLocale } = localeHook;
  const c = profileCopy[locale];
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

  const wordMatches = [profileCopy.fa.deleteWord, profileCopy.en.deleteWord].some((w) => deleteWord.trim().toLowerCase() === w.toLowerCase());

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
    signOut();
    navigate(slug ? congressPath(slug, "my-congress") : "/");
  };

  const view = deleted ? { status: "deleted" as const } : !token ? { status: "signed-out" as const } : state;
  let content;
  if (view.status === "deleted") {
    content = (
      <div className="mx-auto max-w-3xl">
        <StatusPanel icon="check-circle" title={c.deletedTitle}>
          <p>{c.deletedBody}</p>
          <LinkButton to={slug ? `/e/${encodeURIComponent(slug)}` : "/"} variant="secondary" size="md">
            {c.backHome}
          </LinkButton>
        </StatusPanel>
      </div>
    );
  } else if (view.status === "loading") {
    content = <LoadingBlock label={t.navMyProfile} />;
  } else if (view.status === "signed-out") {
    content = (
      <SignInPrompt
        seed={slug}
        icon="user"
        title={t.unauthenticatedTitle}
        description={t.unauthenticatedDesc}
        actionLabel={t.loginAction}
        to={signInPath(slug, congressPath(slug, "my-profile"))}
      />
    );
  } else if (view.status === "error") {
    content = (
      <div className="mx-auto max-w-3xl">
        <StatusPanel tone="danger" icon="alert" title={c.loadFailedTitle}>
          <p>{c.loadFailedBody}</p>
          <Button type="button" variant="secondary" size="md" onClick={() => window.location.reload()}>
            <Icon name="sync" size={16} />
            {c.retry}
          </Button>
        </StatusPanel>
      </div>
    );
  } else {
    const { user } = view;
    const dirty = form.full_name.trim() !== user.full_name || form.organization.trim() !== user.organization || form.title.trim() !== user.title;
    const field = (key: keyof typeof form, label: string, max: number, required = false) => (
      <div>
        <label htmlFor={`profile-${key}`} className="ui-label">
          {label}
          {required && <span aria-hidden="true" className="text-status-danger-text"> *</span>}
        </label>
        <input
          id={`profile-${key}`}
          type="text"
          dir="auto"
          required={required}
          maxLength={max}
          autoComplete={key === "full_name" ? "name" : key === "organization" ? "organization" : "organization-title"}
          value={form[key]}
          onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
          className="ui-input"
        />
      </div>
    );
    content = (
      <>
        {/* Masthead */}
        <div className="relative overflow-hidden shape-arc-lg border border-border-default bg-surface-panel shadow-soft">
          <div aria-hidden="true" className="bg-meridian absolute inset-0 opacity-70" />
          <div aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] bg-[image:var(--grad-aiteb)]" />
          <ArcMotif weight={5} className="pointer-events-none absolute -bottom-10 -end-6 hidden size-64 opacity-25 sm:block rtl:-scale-x-100" />
          <div className="relative flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:gap-7 sm:p-10">
            <Monogram name={user.full_name} seed={user.id} size="xl" />
            <div className="min-w-0 space-y-2">
              <span className="eyebrow">{t.navMyProfile}</span>
              <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.03em] text-text-primary break-words sm:text-4xl">{user.full_name}</h1>
              {(user.title || user.organization) && (
                <p dir="auto" className="text-sm text-text-secondary break-words">
                  {[user.title, user.organization].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="grid items-start gap-10 lg:grid-cols-12">
          {/* Details (editable) */}
          <section aria-labelledby="profile-details-title" className="space-y-5 lg:col-span-7">
            <SectionHeader index={sectionIndex(1, locale)} id="profile-details-title" title={c.detailsTitle} />
            <form onSubmit={(e) => void saveDetails(e)} className="space-y-4" noValidate>
              {field("full_name", c.fullName, 200, true)}
              {field("organization", c.organization, 200)}
              {field("title", c.title, 100)}
              <div>
                <p className="ui-label">{c.mobile}</p>
                <p className="flex min-h-11 items-center gap-2 rounded-xl border border-border-subtle bg-surface-panel-subtle px-3 text-sm text-text-secondary">
                  <Icon name="phone" size={16} className="text-ink-400" />
                  {user.mobile ? (
                    <bdi dir="ltr" className={codeFontClass(formatMobile(user.mobile, locale))}>{formatMobile(user.mobile, locale)}</bdi>
                  ) : (
                    "—"
                  )}
                  <Icon name="lock" size={14} className="ms-auto text-ink-400" />
                </p>
                <p className="mt-1.5 text-xs text-text-muted">{c.mobileFixed}</p>
              </div>
              <p className="flex items-start gap-2 rounded-xl border border-status-info-border bg-status-info-bg p-3 text-xs leading-relaxed text-status-info-text">
                <Icon name="ticket" size={15} className="mt-px shrink-0" />
                {c.updatesPass}
              </p>
              <MessageLine message={detailsMessage} />
              <Button type="submit" variant="primary" size="lg" disabled={saving || !dirty} aria-busy={saving}>
                <Icon name="check" size={18} />
                {saving ? c.saving : c.save}
              </Button>
            </form>
          </section>

          <div className="space-y-6 lg:col-span-5">
            {/* Privacy */}
            <section aria-labelledby="profile-privacy-title" className={`${panel} shape-arc`}>
              <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] bg-[image:var(--grad-aiteb)]" />
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-ink text-white">
                  <Icon name="shield" size={18} />
                </span>
                <h2 id="profile-privacy-title" className="text-base font-semibold tracking-[-0.01em] text-text-primary">{c.privacyTitle}</h2>
              </div>
              <SettingSwitch
                label={c.peersLabel}
                description={c.peersDesc}
                checked={user.share_contact_with_peers}
                busy={settingBusy === "peers"}
                onLabel={c.on}
                offLabel={c.off}
                onToggle={() => void toggleSetting("peers", user)}
              />
              <SettingSwitch
                label={c.exhibitorsLabel}
                description={c.exhibitorsDesc}
                checked={Boolean(user.share_contact_with_exhibitors)}
                busy={settingBusy === "exhibitors"}
                onLabel={c.on}
                offLabel={c.off}
                onToggle={() => void toggleSetting("exhibitors", user)}
              />
              <MessageLine message={settingMessage} />
              <p className="flex items-center gap-2 border-t border-border-subtle pt-4 text-xs text-text-muted">
                <Icon name="globe" size={15} />
                {c.allCongresses}
              </p>
            </section>

            {/* Language */}
            <section aria-labelledby="profile-language-title" className={panel}>
              <h2 id="profile-language-title" className="text-base font-semibold tracking-[-0.01em] text-text-primary">{c.languageTitle}</h2>
              <div role="radiogroup" aria-labelledby="profile-language-title" className="grid grid-cols-2 gap-1 rounded-full border border-border-default bg-surface-panel-subtle p-1">
                {LANGUAGES.map((option) => {
                  const selected = locale === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      lang={option.lang}
                      onClick={() => setLocale(option.value)}
                      className={`press min-h-11 rounded-full text-sm font-semibold transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                        selected ? "bg-surface-ink text-white shadow-soft" : "text-text-secondary hover:text-text-primary"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Data, sign-out, deletion */}
            <section aria-labelledby="profile-data-title" className={panel}>
              <h2 id="profile-data-title" className="text-base font-semibold tracking-[-0.01em] text-text-primary">{c.dataTitle}</h2>
              <div className="space-y-2">
                <Button type="button" variant="secondary" size="md" isFullWidth onClick={() => void exportData()} disabled={exporting} aria-busy={exporting}>
                  <Icon name="download" size={17} />
                  {exporting ? c.exporting : c.exportLabel}
                </Button>
                <p className="text-xs leading-relaxed text-text-muted">{c.exportDesc}</p>
                <MessageLine message={dataMessage} />
              </div>
              <div className="space-y-2 border-t border-border-subtle pt-5">
                <Button type="button" variant="secondary" size="md" isFullWidth onClick={signOutHere}>
                  <Icon name="logout" size={17} />
                  {c.signOut}
                </Button>
                <p className="text-xs leading-relaxed text-text-muted">{c.signOutDesc}</p>
              </div>
              <div className="space-y-2 rounded-2xl border border-status-danger-border bg-status-danger-bg/50 p-4">
                <h3 className="text-sm font-semibold text-status-danger-text">{c.deleteTitle}</h3>
                <p className="text-xs leading-relaxed text-text-secondary">{c.deleteDesc}</p>
                <Button type="button" variant="danger" size="md" onClick={() => setConfirmingDelete(true)}>
                  <Icon name="trash" size={17} />
                  {c.deleteAction}
                </Button>
              </div>
            </section>
          </div>
        </div>

        <Dialog isOpen={confirmingDelete} onClose={closeDelete} title={c.deleteDialogTitle} description={c.deleteDialogLead} size="md">
          <form
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
            <p className="rounded-xl bg-surface-panel-subtle p-3 text-xs leading-relaxed text-text-secondary">{c.deleteExportHint}</p>
            <div>
              <label htmlFor="delete-confirm-word" className="ui-label">
                {c.deleteTypeLabel(c.deleteWord)}
              </label>
              <input
                id="delete-confirm-word"
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={deleteWord}
                onChange={(e) => setDeleteWord(e.target.value)}
                className="ui-input"
              />
            </div>
            {deleteError && (
              <p role="alert" className="flex items-start gap-2 rounded-xl border border-status-danger-border bg-status-danger-bg p-3 text-xs text-status-danger-text">
                <Icon name="alert" size={15} className="mt-px shrink-0" />
                {deleteError}
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" size="md" onClick={closeDelete} disabled={deleting}>
                {c.cancel}
              </Button>
              <Button type="submit" variant="danger" size="md" disabled={!wordMatches || deleting} aria-busy={deleting}>
                <Icon name="trash" size={17} />
                {deleting ? c.deleting : c.deleteConfirm}
              </Button>
            </div>
          </form>
        </Dialog>
      </>
    );
  }

  return (
    <AttendeeLayout localeProps={localeHook} eventSlug={slug} destination="my-profile">
      <div className="mx-auto max-w-6xl space-y-10 px-4 pt-5 sm:space-y-14 sm:px-6 sm:pt-8">{content}</div>
    </AttendeeLayout>
  );
}
