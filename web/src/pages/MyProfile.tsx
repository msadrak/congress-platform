import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ATTENDEE_TOKEN_STORAGE, createApiClient, type PrivacyPreferenceOut, type UserOut } from "../api/client";
import { AttendeeLayout } from "../layouts/AttendeeLayout";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { LinkButton } from "../components/ui/Button";
import { useAttendeeLocale } from "../lib/i18n";
import { isStoredAttendeeToken, rejectAttendeeToken } from "../lib/attendeeSession";
import { congressPath } from "../lib/congressContext";
import { signInPath } from "../lib/safeRedirect";
import { LoadingBlock, StatusPanel } from "../components/ui/PortalState";

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
  const { t, isRtl } = localeHook;
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
      <StatusPanel icon="lock" title={t.unauthenticatedTitle}>
        <LinkButton to={signInPath(slug, congressPath(slug, "my-profile"))} variant="primary" size="md">{t.loginAction} →</LinkButton>
      </StatusPanel>
    );
  } else if (view.status === "error") {
    content = (
      <StatusPanel tone="danger" icon="alert" title={isRtl ? "پروفایل بارگذاری نشد" : "Could not load your profile"}>
        <p>{isRtl ? "اتصال را بررسی کنید و صفحه را دوباره باز کنید." : "Check your connection and reopen this page."}</p>
      </StatusPanel>
    );
  } else {
    const { user, privacy } = view;
    const rows: [string, string][] = [
      [isRtl ? "نام" : "Name", user.full_name],
      [isRtl ? "ایمیل" : "Email", user.email],
      [isRtl ? "سازمان" : "Organization", user.organization || "—"],
      [isRtl ? "سمت" : "Title", user.title || "—"],
    ];
    content = (
      <>
        <Card className="p-6 border-border-default space-y-4">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="w-12 h-12 rounded-full bg-action-subtle text-action-primary flex items-center justify-center text-xl font-bold shrink-0">
              {user.full_name.trim().charAt(0).toUpperCase() || "?"}
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-text-primary truncate">{user.full_name}</h1>
              <p className="text-sm text-text-secondary truncate"><bdi>{user.email}</bdi></p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-text-primary">{isRtl ? "اطلاعات هویتی" : "Identity details"}</h2>
            <Badge variant="neutral" size="sm">🔒 {isRtl ? "فقط خواندنی" : "Read-only"}</Badge>
          </div>
          <dl className="divide-y divide-border-subtle">
            {rows.map(([label, value]) => (
              <div key={label} className="py-2.5 grid grid-cols-3 gap-3 text-sm">
                <dt className="text-text-muted">{label}</dt>
                <dd className="col-span-2 text-text-primary break-words"><bdi>{value}</bdi></dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-text-muted">
            {isRtl
              ? "این اطلاعات هنگام ثبت‌نام ثبت شده و روی کارت ورود شما درج می‌شود؛ از این صفحه قابل ویرایش نیست."
              : "These details come from your registration and appear on your badge, so they cannot be edited here."}
          </p>
        </Card>

        <Card className="p-6 border-border-default space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-text-primary">🔒 {t.privacyHeading}</h2>
            <Badge variant="brand" size="sm">{isRtl ? "قابل تغییر" : "Editable"}</Badge>
          </div>
          {privacy ? (
            <>
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <p id="share-email-label" className="text-sm font-semibold text-text-primary">{t.shareEmailToggleLabel}</p>
                  <p id="share-email-desc" className="text-xs text-text-secondary leading-relaxed">{t.shareEmailToggleDesc}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={privacy.share_contact_with_peers}
                  aria-labelledby="share-email-label"
                  aria-describedby="share-email-desc"
                  disabled={saving}
                  onClick={() => void togglePrivacy(privacy)}
                  className={`relative shrink-0 w-14 h-8 mt-0.5 rounded-full border transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-60 cursor-pointer ${
                    privacy.share_contact_with_peers ? "bg-action-primary border-transparent" : "bg-surface-panel-subtle border-border-strong"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`absolute top-1 start-1 w-6 h-6 rounded-full bg-white shadow-xs transition-transform motion-reduce:transition-none ${
                      privacy.share_contact_with_peers ? (isRtl ? "-translate-x-6" : "translate-x-6") : ""
                    }`}
                  />
                </button>
              </div>
              <Badge variant={privacy.share_contact_with_peers ? "success" : "neutral"} size="sm">
                {privacy.share_contact_with_peers ? t.emailSharedStatus : t.emailHiddenStatus}
              </Badge>
              {privacyMessage && (
                <p
                  role={privacyMessage.tone === "error" ? "alert" : "status"}
                  className={`text-xs rounded-lg border p-3 ${
                    privacyMessage.tone === "error"
                      ? "bg-status-danger-bg text-status-danger-text border-status-danger-border"
                      : "bg-action-subtle text-action-primary border-action-subtle-border"
                  }`}
                >
                  {privacyMessage.text}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-text-secondary">{isRtl ? "وضعیت در دسترس نیست." : "Status unavailable."}</p>
          )}
          <p className="text-xs text-text-muted">
            {isRtl ? "این تنظیم برای همه همایش‌ها اعمال می‌شود." : "This setting applies to all congresses."}
          </p>
        </Card>
      </>
    );
  }

  return (
    <AttendeeLayout localeProps={localeHook} eventSlug={slug} destination="my-profile">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-6">{content}</div>
    </AttendeeLayout>
  );
}
