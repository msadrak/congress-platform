import { useState, useSyncExternalStore } from "react";
import { applyAppUpdate, isAppUpdateWaiting, subscribeToAppUpdate } from "../lib/pwaRegistration";
import { useAttendeeLocale } from "../lib/i18n";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";

/**
 * Offers a newly deployed version once its service worker is installed. Without it the waiting
 * version never activates while any tab (or the installed app) stays open, so people keep the old
 * screens after a release. The user chooses the moment: nothing reloads on its own.
 */
export function AppUpdatePrompt() {
  const waiting = useSyncExternalStore(subscribeToAppUpdate, isAppUpdateWaiting);
  const [dismissed, setDismissed] = useState(false);
  const { isRtl, dir } = useAttendeeLocale();
  if (!waiting || dismissed) return null;

  return (
    <div
      role="status"
      dir={dir}
      className="fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[100] mx-auto flex max-w-md flex-wrap items-center gap-3 rounded-2xl border border-border-default bg-surface-panel p-3 ps-4 shadow-pop"
    >
      <Icon name="sync" size={18} className="shrink-0 text-event-accent" />
      <p className="min-w-0 flex-1 basis-48 text-sm font-semibold text-text-primary">
        {isRtl ? "نسخهٔ تازهٔ سامانه آماده است." : "A new version of the app is ready."}
      </p>
      <div className="ms-auto flex gap-2">
        <Button type="button" variant="ghost" size="md" onClick={() => setDismissed(true)}>
          {isRtl ? "بعداً" : "Later"}
        </Button>
        <Button type="button" variant="primary" size="md" onClick={applyAppUpdate}>
          {isRtl ? "بارگذاری دوباره" : "Reload to update"}
        </Button>
      </div>
    </div>
  );
}
