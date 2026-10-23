import { useState } from "react";
import { useLocation } from "react-router-dom";
import { useAppUpdate } from "../hooks/useAppUpdate";
import { useAttendeeLocale } from "../lib/i18n";
import { isOperatorRoute } from "../lib/launchTarget";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";

const COPY = {
  fa: { message: "نسخهٔ تازه آماده است.", update: "به‌روزرسانی", later: "بعداً" },
  en: { message: "A new version is ready.", update: "Update", later: "Later" },
} as const;

/**
 * Offers a newly deployed version once its service worker is installed. Without it the waiting
 * version never activates while any tab (or the installed app) stays open, so people keep the old
 * screens after a release. The user chooses the moment: nothing reloads on its own. Not shown on the scanner,
 * booth and desk screens: an operator mid-shift gets the same offer from the screen's own status pill and menu
 * (`useAppUpdate`), never a banner over a verdict or a capture.
 */
export function AppUpdatePrompt() {
  const { waiting, apply } = useAppUpdate();
  const [dismissed, setDismissed] = useState(false);
  const { locale, dir } = useAttendeeLocale();
  const { pathname } = useLocation();
  if (!waiting || dismissed || isOperatorRoute(pathname)) return null;
  const copy = COPY[locale];

  return (
    <div
      role="status"
      dir={dir}
      className="fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[100] mx-auto flex max-w-md flex-wrap items-center gap-3 rounded-2xl border border-border-default bg-surface-panel p-3 ps-4 shadow-pop"
    >
      <Icon name="sync" size={18} className="shrink-0 text-event-accent" />
      <p className="min-w-0 flex-1 basis-48 text-sm font-semibold text-text-primary">{copy.message}</p>
      <div className="ms-auto flex gap-2">
        <Button type="button" variant="ghost" size="md" onClick={() => setDismissed(true)}>
          {copy.later}
        </Button>
        <Button type="button" variant="primary" size="md" onClick={apply}>
          {copy.update}
        </Button>
      </div>
    </div>
  );
}
