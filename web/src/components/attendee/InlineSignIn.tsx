import type { ReactNode } from "react";
import { useAttendeeSession } from "../../hooks/useAttendeeSession";
import type { AttendeeLocale } from "../../lib/i18n";
import { MobileOtpForm } from "../auth/MobileOtpForm";
import { Card } from "../ui/Card";

/**
 * The phone-number sign-in in place of a page's content: a visitor who is not signed in enters the mobile number
 * right here, and the page loads their data as soon as the code is accepted (no trip to the sign-in page).
 */
export function InlineSignIn({ locale, title, body }: { locale: AttendeeLocale; title: ReactNode; body?: ReactNode }) {
  const { signIn } = useAttendeeSession();
  return (
    <Card className="mx-auto w-full max-w-md space-y-4 p-5 sm:p-6">
      <div className="space-y-1">
        <h2 className="text-title-sm font-bold text-text-primary">{title}</h2>
        {body && <p className="text-body-sm text-text-secondary">{body}</p>}
      </div>
      <MobileOtpForm locale={locale} onSignedIn={(auth) => signIn(auth.access_token)} />
    </Card>
  );
}
