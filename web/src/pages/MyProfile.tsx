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
import { LoadingBlock, StatusPanel } from "../components/ui/PortalState";

type ProfileState =
  | { status: "loading" }
  | { status: "ready"; user: UserOut; privacy: PrivacyPreferenceOut | null }
  | { status: "signed-out" }
  | { status: "error" };

/** Read-only: profile editing is not part of this portal yet, so no edit controls are shown. */
export default function MyProfile() {
  const { slug = "" } = useParams<{ slug: string }>();
  const localeHook = useAttendeeLocale();
  const { t, isRtl } = localeHook;
  const token = typeof window !== "undefined" ? localStorage.getItem(ATTENDEE_TOKEN_STORAGE) : null;
  const [state, setState] = useState<ProfileState>({ status: "loading" });

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

  const view = !token ? { status: "signed-out" as const } : state;
  let content;
  if (view.status === "loading") {
    content = <LoadingBlock label={t.navMyProfile} />;
  } else if (view.status === "signed-out") {
    content = (
      <StatusPanel icon="🔐" title={t.unauthenticatedTitle}>
        <LinkButton to={`/e/${slug}`} variant="primary" size="md">{t.loginAction} →</LinkButton>
      </StatusPanel>
    );
  } else if (view.status === "error") {
    content = (
      <StatusPanel tone="danger" icon="⚠️" title={isRtl ? "پروفایل بارگذاری نشد" : "Could not load your profile"}>
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
            <span aria-hidden="true" className="w-12 h-12 rounded-full bg-action-subtle text-action-primary flex items-center justify-center text-xl font-bold">
              {user.full_name.trim().charAt(0).toUpperCase() || "?"}
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-text-primary truncate">{user.full_name}</h1>
              <p className="text-sm text-text-secondary truncate"><bdi>{user.email}</bdi></p>
            </div>
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
            {isRtl ? "ویرایش پروفایل هنوز در این پورتال فعال نیست." : "Profile editing is not available in this portal yet."}
          </p>
        </Card>

        <Card className="p-6 border-border-default space-y-3">
          <h2 className="text-sm font-bold text-text-primary">🔒 {t.privacyHeading}</h2>
          {privacy ? (
            <Badge variant={privacy.share_contact_with_peers ? "success" : "neutral"} size="sm">
              {privacy.share_contact_with_peers ? t.emailSharedStatus : t.emailHiddenStatus}
            </Badge>
          ) : (
            <p className="text-sm text-text-secondary">{isRtl ? "وضعیت در دسترس نیست." : "Status unavailable."}</p>
          )}
          <p className="text-xs text-text-muted">
            {isRtl ? "این تنظیم برای همه همایش‌ها اعمال می‌شود و در «شبکه من» قابل تغییر است." : "This setting applies to all congresses and can be changed in My Network."}
          </p>
          <LinkButton to={congressPath(slug, "my-network")} variant="secondary" size="sm">{t.navMyNetwork} →</LinkButton>
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
