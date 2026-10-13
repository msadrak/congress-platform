import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ATTENDEE_TOKEN_STORAGE, createApiClient, type PrivacyPreferenceOut, type UserOut } from "../api/client";
import { AttendeeLayout } from "../layouts/AttendeeLayout";
import { Icon } from "../components/ui/Icon";
import { ArcMotif } from "../components/brand/Aiteb";
import { useAttendeeLocale } from "../lib/i18n";
import { isStoredAttendeeToken, rejectAttendeeToken } from "../lib/attendeeSession";
import { congressPath } from "../lib/congressContext";
import { signInPath } from "../lib/safeRedirect";
import { LoadingBlock, StatusPanel } from "../components/ui/PortalState";
import { Monogram } from "../components/attendee/Monogram";
import { SectionHeader } from "../components/attendee/SectionHeader";
import { SignInPrompt } from "../components/attendee/SignInPrompt";
import { sectionIndex } from "../components/attendee/congressTime";

type ProfileState =
  | { status: "loading" }
  | { status: "ready"; user: UserOut; privacy: PrivacyPreferenceOut | null }
  | { status: "signed-out" }
  | { status: "error" };

/**
 * Identity fields (name, email, organization, title) are read-only: editing them is an
 * approval-gated backlog item (P03-T57) because they appear on issued badges. The one
 * attendee-controlled setting is peer contact sharing, persisted through its own endpoint.
 */
export default function MyProfile() {
  const { slug = "" } = useParams<{ slug: string }>();
  const localeHook = useAttendeeLocale();
  const { locale, t, isRtl } = localeHook;
  const token = typeof window !== "undefined" ? localStorage.getItem(ATTENDEE_TOKEN_STORAGE) : null;
  const [state, setState] = useState<ProfileState>({ status: "loading" });
  const [saving, setSaving] = useState(false);
  const [privacyMessage, setPrivacyMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    const client = createApiClient({ kind: "user", token });
    Promise.all([client.GET("/api/auth/me"), client.GET("/api/attendees/me/network/privacy")])
      .then(([me, privacy]) => {
        if (!active || !isStoredAttendeeToken(token)) return;
        if (me.response.status === 401) {
          rejectAttendeeToken(token);
          setState({ status: "signed-out" });
        } else if (me.data) {
          setState({ status: "ready", user: me.data, privacy: privacy.data ?? null });
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

  const togglePrivacy = async (current: PrivacyPreferenceOut) => {
    if (!token || saving) return;
    if (!isStoredAttendeeToken(token)) {
      setState({ status: "signed-out" });
      return;
    }
    setSaving(true);
    setPrivacyMessage(null);
    try {
      const { data, response } = await createApiClient({ kind: "user", token }).PATCH("/api/attendees/me/network/privacy", {
        body: { share_contact_with_peers: !current.share_contact_with_peers },
      });
      if (!isStoredAttendeeToken(token)) {
        setState({ status: "signed-out" });
        return;
      }
      if (response.status === 401) {
        rejectAttendeeToken(token);
        setState({ status: "signed-out" });
      } else if (data) {
        // The visible value is the one the server persisted, not the one we asked for.
        setState((prev) => (prev.status === "ready" ? { ...prev, privacy: data } : prev));
        setPrivacyMessage({ tone: "ok", text: t.privacySavedFeedback });
      } else {
        setPrivacyMessage({
          tone: "error",
          text: isRtl ? "تنظیم ذخیره نشد؛ مقدار قبلی حفظ شد. دوباره تلاش کنید." : "Your setting was not saved; the previous value is unchanged. Please try again.",
        });
      }
    } catch {
      setPrivacyMessage({
        tone: "error",
        text: isRtl ? "اتصال برقرار نشد؛ تنظیم تغییری نکرد." : "Connection failed; your setting was not changed.",
      });
    } finally {
      setSaving(false);
    }
  };

  const view = !token ? { status: "signed-out" as const } : state;
  let content;
  if (view.status === "loading") {
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
        <StatusPanel tone="danger" icon="alert" title={isRtl ? "پروفایل بارگذاری نشد" : "Could not load your profile"}>
          <p>{isRtl ? "اتصال را بررسی کنید و صفحه را دوباره باز کنید." : "Check your connection and reopen this page."}</p>
        </StatusPanel>
      </div>
    );
  } else {
    const { user, privacy } = view;
    const rows: [string, string, "user" | "mail" | "congress" | "id-card"][] = [
      [isRtl ? "نام" : "Name", user.full_name, "user"],
      [isRtl ? "ایمیل" : "Email", user.email, "mail"],
      [isRtl ? "سازمان" : "Organization", user.organization || "—", "congress"],
      [isRtl ? "سمت" : "Title", user.title || "—", "id-card"],
    ];
    const shared = privacy?.share_contact_with_peers ?? false;
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
              <p className="flex min-w-0 items-center gap-2 text-sm text-text-secondary">
                <Icon name="mail" size={16} className="text-ink-400" />
                <bdi className="truncate">{user.email}</bdi>
              </p>
            </div>
          </div>
        </div>

        <div className="grid items-start gap-10 lg:grid-cols-12">
          {/* Identity (read-only) */}
          <section aria-labelledby="profile-identity-title" className="space-y-5 lg:col-span-7">
            <SectionHeader
              index={sectionIndex(1, locale)}
              id="profile-identity-title"
              title={isRtl ? "اطلاعات هویتی" : "Identity details"}
              aside={
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border-default bg-surface-panel px-2.5 py-1 text-xs font-semibold text-text-secondary">
                  <Icon name="lock" size={13} />
                  {isRtl ? "فقط خواندنی" : "Read-only"}
                </span>
              }
            />
            <dl className="divide-y divide-border-default border-b border-border-default">
              {rows.map(([label, value, icon]) => (
                <div key={label} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-baseline gap-4 py-4 text-sm">
                  <dt className="flex items-center gap-2 text-text-muted">
                    <Icon name={icon} size={16} className="self-center text-ink-400" />
                    {label}
                  </dt>
                  <dd className="font-medium text-text-primary break-words"><bdi>{value}</bdi></dd>
                </div>
              ))}
            </dl>
            <p className="flex items-start gap-2 text-xs leading-relaxed text-text-muted">
              <Icon name="info" size={15} className="mt-px shrink-0" />
              {isRtl
                ? "این اطلاعات هنگام ثبت‌نام ثبت شده و روی کارت ورود شما درج می‌شود؛ از این صفحه قابل ویرایش نیست."
                : "These details come from your registration and appear on your badge, so they cannot be edited here."}
            </p>
          </section>

          {/* Contact privacy (editable) */}
          <section
            aria-labelledby="profile-privacy-title"
            className="relative overflow-hidden shape-arc border border-border-default bg-surface-panel shadow-soft lg:col-span-5"
          >
            <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-[3px] ${shared ? "bg-status-success-solid" : "bg-[image:var(--grad-aiteb)]"}`} />
            <div className="space-y-5 p-6 sm:p-7">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-ink text-white">
                    <Icon name="shield" size={18} />
                  </span>
                  <h2 id="profile-privacy-title" className="text-base font-semibold tracking-[-0.01em] text-text-primary">
                    {t.privacyHeading}
                  </h2>
                </div>
                <span className="shrink-0 rounded-full bg-action-subtle px-2.5 py-1 text-[11px] font-semibold text-action-primary">
                  {isRtl ? "قابل تغییر" : "Editable"}
                </span>
              </div>
              {privacy ? (
                <>
                  <div className="flex items-start justify-between gap-4 rounded-2xl border border-border-subtle bg-surface-panel-subtle p-4">
                    <div className="min-w-0 space-y-1">
                      <p id="share-email-label" className="text-sm font-semibold text-text-primary">{t.shareEmailToggleLabel}</p>
                      <p id="share-email-desc" className="text-xs leading-relaxed text-text-secondary">{t.shareEmailToggleDesc}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={privacy.share_contact_with_peers}
                      aria-labelledby="share-email-label"
                      aria-describedby="share-email-desc"
                      disabled={saving}
                      onClick={() => void togglePrivacy(privacy)}
                      className={`relative mt-0.5 h-8 w-14 shrink-0 rounded-full border transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-60 cursor-pointer before:absolute before:-inset-2 before:content-[''] ${
                        privacy.share_contact_with_peers ? "border-transparent bg-[image:var(--grad-aiteb-deep)]" : "border-border-strong bg-surface-panel-inset"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`absolute top-1 start-1 grid size-6 place-items-center rounded-full bg-white shadow-soft transition-transform motion-reduce:transition-none ${
                          privacy.share_contact_with_peers ? (isRtl ? "-translate-x-6" : "translate-x-6") : ""
                        }`}
                      >
                        <Icon name={privacy.share_contact_with_peers ? "check" : "minus"} size={12} strokeWidth={2.5} className={privacy.share_contact_with_peers ? "text-aiteb-indigo" : "text-ink-400"} />
                      </span>
                    </button>
                  </div>
                  <p
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                      shared
                        ? "border-status-success-border bg-status-success-bg text-status-success-text"
                        : "border-border-default bg-surface-panel-subtle text-text-secondary"
                    }`}
                  >
                    <Icon name={shared ? "eye" : "eye-off"} size={15} />
                    {shared ? t.emailSharedStatus : t.emailHiddenStatus}
                  </p>
                  {privacyMessage && (
                    <p
                      role={privacyMessage.tone === "error" ? "alert" : "status"}
                      className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${
                        privacyMessage.tone === "error"
                          ? "border-status-danger-border bg-status-danger-bg text-status-danger-text"
                          : "border-action-subtle-border bg-action-subtle text-action-primary"
                      }`}
                    >
                      <Icon name={privacyMessage.tone === "error" ? "alert" : "check-circle"} size={15} className="mt-px shrink-0" />
                      {privacyMessage.text}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-text-secondary">{isRtl ? "وضعیت در دسترس نیست." : "Status unavailable."}</p>
              )}
              <p className="flex items-center gap-2 border-t border-border-subtle pt-4 text-xs text-text-muted">
                <Icon name="globe" size={15} />
                {isRtl ? "این تنظیم برای همه همایش‌ها اعمال می‌شود." : "This setting applies to all congresses."}
              </p>
            </div>
          </section>
        </div>
      </>
    );
  }

  return (
    <AttendeeLayout localeProps={localeHook} eventSlug={slug} destination="my-profile">
      <div className="mx-auto max-w-6xl space-y-10 px-4 pt-5 sm:space-y-14 sm:px-6 sm:pt-8">{content}</div>
    </AttendeeLayout>
  );
}
