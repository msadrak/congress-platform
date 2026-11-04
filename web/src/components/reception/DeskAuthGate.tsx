import { MobileOtpForm } from "../auth/MobileOtpForm";
import { OperatorGate } from "../operator/OperatorGate";
import { Button, LinkButton } from "../ui/Button";
import { LanguageToggle } from "../ui/LanguageToggle";
import { Notice } from "../ui/Notice";
import { deskCopy } from "../../copy/desk";
import { setLocale, type AttendeeLocale } from "../../lib/i18n";

/** Organizer mode was chosen but no organizer key is held (organizer administration only). */
export function OrganizerKeyRequired({ locale, onUseOperator }: { locale: AttendeeLocale; onUseOperator: () => void }) {
  const c = deskCopy[locale];
  return (
    <OperatorGate
      locale={locale}
      kind="signIn"
      icon="key"
      title={c.organizerKeyTitle}
      body={null}
      action={
        <LinkButton to="/organizer" variant="primary" size="lg" isFullWidth icon="key">
          {c.useOrganizerKey}
        </LinkButton>
      }
      secondary={
        <Button type="button" variant="secondary" size="lg" isFullWidth icon="user" onClick={onUseOperator}>
          {c.operatorSignIn}
        </Button>
      }
    />
  );
}

interface DeskSignInProps {
  locale: AttendeeLocale;
  /** The independent reception portal: a language switch, no way into the organizer console. */
  standalone: boolean;
  /** Organizer administration with an organizer key: switch the desk to organizer mode instead. */
  onUseOrganizerKey: (() => void) | null;
  /** The previous session was refused (revoked or expired). */
  sessionRejected: boolean;
  hasDraft: boolean;
  /** Verifies the operator's SMS code; resolves to the message to show, or null once signed in. */
  verifyCode: (mobile: string, code: string) => Promise<string | null>;
}

/** The desk entry gate: operator sign-in by mobile number and SMS code. */
export function DeskSignIn({ locale, standalone, onUseOrganizerKey, sessionRejected, hasDraft, verifyCode }: DeskSignInProps) {
  const c = deskCopy[locale];
  let secondary = null;
  if (standalone) secondary = <LanguageToggle locale={locale} onChange={setLocale} className="self-center" />;
  else if (onUseOrganizerKey)
    secondary = (
      <Button type="button" variant="ghost" size="md" icon="key" onClick={onUseOrganizerKey}>
        {c.useOrganizerKey}
      </Button>
    );
  else
    secondary = (
      <LinkButton to="/organizer" variant="ghost" size="md" icon="key">
        {c.useOrganizerKey}
      </LinkButton>
    );
  return (
    <OperatorGate locale={locale} kind="signIn" title={c.signInTitle} body={null} secondary={secondary}>
      {sessionRejected && (
        <Notice tone="danger">
          <p>{c.sessionRejected}</p>
          {hasDraft && <p>{c.draftKept}</p>}
        </Notice>
      )}
      <MobileOtpForm locale={locale} purpose="desk" verifyCode={verifyCode} verifyLabel={c.signInButton} />
    </OperatorGate>
  );
}
