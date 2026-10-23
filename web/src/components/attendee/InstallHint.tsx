import { useState, useSyncExternalStore } from "react";
import type { AttendeeLocale } from "../../lib/i18n";
import {
  INSTALL_HINT_DISMISSED_KEY,
  canPromptInstall,
  isIosDevice,
  isStandaloneDisplay,
  promptInstall,
  subscribeInstallPrompt,
} from "../../lib/installPrompt";
import { Icon } from "../ui/Icon";

const COPY = {
  fa: {
    title: "کارت ورود را روی صفحه اصلی گوشی داشته باشید",
    body: "روز همایش با یک لمس و حتی بدون اینترنت باز می‌شود.",
    install: "افزودن به صفحه اصلی",
    ios: "در Safari دکمه اشتراک‌گذاری را بزنید و «افزودن به صفحهٔ اصلی» را انتخاب کنید.",
    dismiss: "بستن راهنما",
  },
  en: {
    title: "Keep your pass on your home screen",
    body: "On the day it opens with one tap, even without internet.",
    install: "Add to home screen",
    ios: "In Safari, tap the Share button and choose “Add to Home Screen”.",
    dismiss: "Dismiss hint",
  },
} as const;

function readDismissed(): boolean {
  try {
    return localStorage.getItem(INSTALL_HINT_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Dismissible "add to home screen" hint: the browser's install prompt where offered, instructions on iOS. */
export function InstallHint({ locale }: { locale: AttendeeLocale }) {
  const copy = COPY[locale];
  const promptable = useSyncExternalStore(subscribeInstallPrompt, canPromptInstall, () => false);
  const [dismissed, setDismissed] = useState(readDismissed);
  const ios = typeof navigator !== "undefined" && isIosDevice(navigator.userAgent, navigator.maxTouchPoints);
  if (dismissed || isStandaloneDisplay() || (!promptable && !ios)) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(INSTALL_HINT_DISMISSED_KEY, "1");
    } catch {
      // storage unavailable: hidden for this visit only
    }
  };

  return (
    <aside
      data-testid="install-hint"
      className="at-print-collapse flex items-start gap-3 rounded-2xl border border-border-default bg-surface-panel p-3.5 text-xs leading-relaxed text-text-secondary shadow-soft"
    >
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-action-subtle text-action-primary">
        <Icon name="smartphone" size={18} />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-semibold text-text-primary">{copy.title}</p>
        <p>{promptable ? copy.body : copy.ios}</p>
        {promptable && (
          <button
            type="button"
            onClick={() => {
              void promptInstall().then((accepted) => {
                if (accepted) dismiss();
              });
            }}
            className="press mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-full text-xs font-semibold text-action-primary underline-offset-4 hover:underline cursor-pointer focus-visible:outline-2 focus-visible:outline-focus-ring"
          >
            <Icon name="plus" size={16} />
            {copy.install}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={copy.dismiss}
        className="press -m-1 grid size-11 shrink-0 place-items-center rounded-full text-text-muted hover:bg-surface-panel-subtle hover:text-text-primary cursor-pointer focus-visible:outline-2 focus-visible:outline-focus-ring"
      >
        <Icon name="x" size={18} />
      </button>
    </aside>
  );
}
