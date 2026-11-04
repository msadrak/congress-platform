import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { formatLocalizedNumber, type AttendeeLocale } from "../../lib/i18n";
import {
  canPromptInstall,
  installDismissedKey,
  installOffer,
  isPhone,
  isStandaloneDisplay,
  promptInstall,
  subscribeInstallPrompt,
  subscribePhone,
  type InstallPersona,
} from "../../lib/installPrompt";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { installCopy, installSharedCopy } from "../../copy/install";

function readDismissed(persona: InstallPersona): boolean {
  try {
    return localStorage.getItem(installDismissedKey(persona)) === "1";
  } catch {
    return false;
  }
}

const textButton =
  "press mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-full text-xs font-semibold text-action-primary underline-offset-4 hover:underline cursor-pointer focus-visible:outline-2 focus-visible:outline-focus-ring";

/**
 * The one "add to home screen" row, for the attendee's pass, the gate scanner and the booth panel (`persona`).
 * Where the browser can install the app it offers its own dialog; on iOS Safari it opens a three-step sheet. It
 * shows only where `installOffer` allows (the persona's own pages, on the right devices, never installed, never
 * after "Not now"), so a screen can mount it unconditionally. The iOS row makes no offline promise: an installed
 * iOS app starts with empty storage and must be opened and signed in once.
 */
export function InstallHint({ locale, persona = "attendee" }: { locale: AttendeeLocale; persona?: InstallPersona }) {
  const copy = installCopy[persona][locale];
  const shared = installSharedCopy[locale];
  const { pathname } = useLocation();
  const promptable = useSyncExternalStore(subscribeInstallPrompt, canPromptInstall, () => false);
  const phone = useSyncExternalStore(subscribePhone, isPhone, () => false);
  const [dismissed, setDismissed] = useState(() => readDismissed(persona));
  const [stepsOpen, setStepsOpen] = useState(false);

  const offer = installOffer({
    persona,
    pathname,
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    maxTouchPoints: typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints,
    promptable,
    standalone: isStandaloneDisplay(),
    dismissed,
    phone,
  });
  if (offer === null) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(installDismissedKey(persona), "1");
    } catch {
      // storage unavailable: hidden for this visit only
    }
  };

  const steps: ReactNode[] = [
    shared.share,
    locale === "fa" ? (
      <>
        {shared.addToHome}{" "}
        <bdi lang="en" dir="ltr">
          Add to Home Screen
        </bdi>
      </>
    ) : (
      shared.addToHome
    ),
    copy.lastStep,
  ];
  const body = offer === "prompt" ? copy.body : copy.iosBody;

  return (
    <>
      <aside
        data-testid="install-hint"
        className="at-print-collapse flex items-start gap-3 rounded-2xl border border-border-default bg-surface-panel p-3.5 text-xs leading-relaxed text-text-secondary shadow-soft"
      >
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-action-subtle text-action-primary">
          <Icon name="smartphone" size={18} />
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-sm font-semibold text-text-primary">{copy.title}</p>
          {body && <p>{body}</p>}
          {offer === "prompt" ? (
            <button
              type="button"
              data-testid="install-action"
              onClick={() => {
                void promptInstall().then((accepted) => {
                  if (accepted) dismiss();
                });
              }}
              className={textButton}
            >
              <Icon name="plus" size={16} />
              {copy.action}
            </button>
          ) : (
            <button type="button" data-testid="install-how" onClick={() => setStepsOpen(true)} className={textButton}>
              <Icon name="help" size={16} />
              {shared.how}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={shared.dismiss}
          className="press -m-1 grid size-11 shrink-0 place-items-center rounded-full text-text-muted hover:bg-surface-panel-subtle hover:text-text-primary cursor-pointer focus-visible:outline-2 focus-visible:outline-focus-ring"
        >
          <Icon name="x" size={18} />
        </button>
      </aside>
      {offer === "ios" && (
        <Dialog isOpen={stepsOpen} onClose={() => setStepsOpen(false)} title={copy.title} size="sm">
          <ol data-testid="install-ios-steps" className="space-y-4 text-sm text-text-primary">
            {steps.map((step, index) => (
              <li key={index} data-testid="install-ios-step" className="flex items-start gap-3">
                <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-action-subtle text-xs font-semibold text-action-primary">
                  {formatLocalizedNumber(index + 1, locale)}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </Dialog>
      )}
    </>
  );
}
