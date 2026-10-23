import type { CSSProperties } from "react";
import type { DeskRegistrationOut } from "../../api/client";
import { formatMobile } from "../../lib/mobile";
import { codeFontClass, type AttendeeLocale, type TranslationDictionary } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { ReceptionPass } from "./ReceptionPass";
import { ResendPassSms, type ResendOutcome } from "./ResendPassSms";

interface MintedDialogProps {
  /** The backend-confirmed issuance; null keeps the dialog closed. */
  minted: DeskRegistrationOut | null;
  accentStyle: CSSProperties;
  eventName: string | undefined;
  onPrint: () => void;
  onNext: () => void;
  onResend: (ticketId: string) => Promise<ResendOutcome>;
  locale: AttendeeLocale;
  t: TranslationDictionary;
  isRtl: boolean;
}

/** Shown only after the API confirmed a walk-in issuance: the new pass, ready to print. */
export function MintedDialog({ minted, accentStyle, eventName, onPrint, onNext, onResend, locale, t, isRtl }: MintedDialogProps) {
  return (
    <Dialog isOpen={Boolean(minted)} onClose={onNext} title={t.ticketIssuedSuccess.replace(/^✓\s*/, "")} description={isRtl ? "کارت ورود با موفقیت صادر شد. می‌توانید کارت را چاپ کرده یا به شرکت‌کننده تحویل دهید." : "Pass minted successfully."} size="sm">
      {minted && (
        <div className="space-y-4" style={accentStyle}>
          <p className="flex items-center gap-2.5 text-sm font-semibold text-status-success-text">
            <span aria-hidden="true" className="grid size-7 place-items-center rounded-full bg-status-success-text text-white">
              <Icon name="check" size={15} strokeWidth={2.5} />
            </span>
            <span>{isRtl ? "صادر شد و آماده چاپ است" : "Issued and ready to print"}</span>
          </p>
          <div className="rounded-2xl bg-surface-panel-subtle p-4">
            <ReceptionPass
              pass={{ qr: minted.qr_secret, name: minted.attendee_name, tier: minted.ticket_tier_name, org: minted.organization, ticketId: minted.ticket_id }}
              isRtl={isRtl}
              eventName={eventName}
              printable
            />
          </div>
          {minted.attendee_mobile && (
            <p className="flex items-start gap-2 text-xs leading-relaxed text-text-secondary print:hidden">
              <Icon name="mail" size={15} className="mt-px shrink-0" />
              <span>
                {isRtl ? "لینک کارت به این شماره پیامک می‌شود: " : "The pass link is being sent by SMS to "}
                <bdi dir="ltr" className={codeFontClass(formatMobile(minted.attendee_mobile, locale))}>{formatMobile(minted.attendee_mobile, locale)}</bdi>
              </span>
            </p>
          )}
          <div className="grid gap-2.5 print:hidden">
            <Button type="button" variant="secondary" size="lg" isFullWidth onClick={onPrint}>
              <Icon name="print" size={18} />
              <span>{t.printPassAction}</span>
            </Button>
            {minted.attendee_mobile && (
              <ResendPassSms
                key={minted.ticket_id}
                mobile={minted.attendee_mobile}
                locale={locale}
                isRtl={isRtl}
                onResend={() => onResend(minted.ticket_id)}
              />
            )}
            <Button type="button" variant="primary" size="lg" isFullWidth onClick={onNext} className="whitespace-normal">
              <span>{t.nextAttendeeAction}</span>
              <Icon name="arrow-right" size={18} />
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
