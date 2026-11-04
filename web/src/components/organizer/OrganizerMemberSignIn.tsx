import { useState } from "react";
import { createApiClient, localizedApiError, type MemberLoginOut } from "../../api/client";
import type { AttendeeLocale } from "../../lib/i18n";
import { ROLE_COPY } from "../../lib/organizerConsole";
import { organizerCopy } from "../../copy/organizer";
import { MobileOtpForm } from "../auth/MobileOtpForm";
import { FormAlert } from "./WorkspaceUi";
import { Icon } from "../ui/Icon";

type Choice = MemberLoginOut["organizers"][number];

interface OrganizerMemberSignInProps {
  locale: AttendeeLocale;
  /** Receives the member session token; the layout stores it like an API key. */
  onSession: (token: string) => void;
}

/**
 * Member sign-in for the organizer console (ADR 0016): mobile number, SMS code, and, for a person who belongs
 * to several organizers, the organizer to manage.
 */
export function OrganizerMemberSignIn({ locale, onSession }: OrganizerMemberSignInProps) {
  const copy = organizerCopy[locale].signIn;
  const [selection, setSelection] = useState<{ token: string; choices: Choice[] } | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [choiceError, setChoiceError] = useState<string | null>(null);

  const verifyCode = async (mobile: string, code: string): Promise<string | null> => {
    const { data, error, response } = await createApiClient({ kind: "anonymous" }, { networkErrors: "result" }).POST("/api/organizer/login", {
      body: { mobile, code },
    });
    if (data?.status === "signed_in" && data.access_token) {
      onSession(data.access_token);
      return null;
    }
    if (data?.status === "choose_organizer" && data.selection_token) {
      setSelection({ token: data.selection_token, choices: data.organizers });
      return null;
    }
    if (response.status === 401 || response.status === 422) return copy.codeInvalid;
    if (response.status === 429) return copy.tooMany;
    return localizedApiError(error, locale, response.status);
  };

  const choose = async (organizerId: string) => {
    if (!selection || choosing) return;
    setChoosing(organizerId);
    setChoiceError(null);
    const { data, error, response } = await createApiClient({ kind: "anonymous" }, { networkErrors: "result" }).POST("/api/organizer/session", {
      body: { selection_token: selection.token, organizer_id: organizerId },
    });
    setChoosing(null);
    if (data?.access_token) {
      onSession(data.access_token);
      return;
    }
    setChoiceError(localizedApiError(error, locale, response.status));
  };

  if (selection) {
    return (
      <div className="space-y-4" data-testid="organizer-choice">
        <h2 className="text-title-sm font-semibold text-text-primary">{copy.chooseTitle}</h2>
        {choiceError && <FormAlert>{choiceError}</FormAlert>}
        <ul className="space-y-2">
          {selection.choices.map((choice) => (
            <li key={choice.organizer.id}>
              <button
                type="button"
                onClick={() => void choose(choice.organizer.id)}
                disabled={choosing !== null}
                aria-busy={choosing === choice.organizer.id}
                className="flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 rounded-control border border-border-default bg-surface-panel px-4 py-3 text-start shadow-soft transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-focus-ring disabled:cursor-wait disabled:opacity-70"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-text-primary">
                    <bdi>{choice.organizer.name}</bdi>
                  </span>
                  <span className="block text-xs text-text-muted">{ROLE_COPY[locale][choice.role].label}</span>
                </span>
                <Icon name="arrow-right" size={18} className="text-text-muted" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return <MobileOtpForm locale={locale} purpose="organizer" verifyCode={verifyCode} verifyLabel={copy.submit} />;
}
