import { useState, type FormEvent } from "react";
import { organizerCopy } from "../../copy/organizer";
import { commonCopy } from "../../copy/common";
import { OrganizerMemberSignIn } from "./OrganizerMemberSignIn";
import { AitebLogo } from "../brand/Aiteb";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { CodeInput } from "../ui/Input";
import { LanguageToggle } from "../ui/LanguageToggle";
import { Notice } from "../ui/Notice";

type GateMode = "mobile" | "key";

interface OrganizerKeyGateProps {
  locale: "fa" | "en";
  /** The previous key or member session was refused by the API (401). */
  keyRejected: boolean;
  /** Which sign-in method the gate opens on: the one that was just refused, else mobile sign-in. */
  initialMode?: GateMode;
  /** A member signed in by SMS code (ADR 0016), or an organizer key was entered: the credential to store. */
  onSession: (token: string) => void;
  onToggleLocale: () => void;
}

/**
 * Organizer sign-in: one short form. Members sign in with their mobile number and an SMS code; the organizer
 * key (integrations, acts as owner) sits behind a secondary link. Storing the credential stays in the layout.
 */
export function OrganizerKeyGate({ locale, keyRejected, initialMode = "mobile", onSession, onToggleLocale }: OrganizerKeyGateProps) {
  const copy = organizerCopy[locale];
  const [mode, setMode] = useState<GateMode>(initialMode);
  const [key, setKey] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);

  const submitKey = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) {
      setKeyError(copy.signIn.keyRequired);
      return;
    }
    onSession(trimmed);
  };

  const rejected = keyRejected ? (mode === "key" ? copy.signIn.keyRejected : commonCopy[locale].sessionEnded) : null;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[28rem] flex-col px-4 pb-8 sm:px-6">
      <div className="flex min-h-14 items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2.5 text-body-sm font-semibold text-text-primary">
          <AitebLogo variant="mark" alt="" className="size-7" />
          {copy.shell.consoleName}
        </span>
        <LanguageToggle locale={locale} onChange={onToggleLocale} />
      </div>

      <div className="flex flex-1 flex-col pt-6 sm:justify-center sm:pt-0 sm:pb-16">
        <h1 className="text-title font-bold leading-tight text-text-primary">{mode === "mobile" ? copy.signIn.title : copy.signIn.useKey}</h1>

        <div className="mt-6 space-y-5">
          {rejected && <Notice tone="danger">{rejected}</Notice>}
          {mode === "mobile" ? (
            <OrganizerMemberSignIn locale={locale} onSession={onSession} />
          ) : (
            <form onSubmit={submitKey} className="space-y-5" noValidate>
              <Field label={copy.signIn.keyLabel} hint={copy.signIn.keyHint} error={keyError ?? undefined} required>
                <CodeInput
                  id="apiKeyInput"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={key}
                  onChange={(e) => {
                    setKey(e.target.value);
                    setKeyError(null);
                  }}
                />
              </Field>
              <Button type="submit" variant="primary" size="lg" isFullWidth>
                {copy.signIn.submit}
              </Button>
            </form>
          )}
          <Button
            type="button"
            variant="ghost"
            size="md"
            isFullWidth
            icon={mode === "mobile" ? "key" : "smartphone"}
            onClick={() => setMode(mode === "mobile" ? "key" : "mobile")}
          >
            {mode === "mobile" ? copy.signIn.useKey : copy.signIn.useMobile}
          </Button>
        </div>
      </div>
    </div>
  );
}
