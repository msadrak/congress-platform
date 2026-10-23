import { useState } from "react";
import QRCode from "react-qr-code";
import type { DeskRegistrationOut } from "../../api/client";
import { deskCopy } from "../../copy/desk";
import { formatMobile } from "../../lib/format";
import type { AttendeeLocale } from "../../lib/i18n";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Notice } from "../ui/Notice";
import { PrintableBadge } from "./PrintableBadge";

interface MintedDialogProps {
  /** The backend-confirmed issuance; null keeps the dialog closed. */
  minted: DeskRegistrationOut | null;
  eventName: string | undefined;
  onPrint: () => void;
  onNext: () => void;
  locale: AttendeeLocale;
}

/** Shown only after the API confirmed a desk registration: who, which pass type, and Print as the one primary action. */
export function MintedDialog({ minted, eventName, onPrint, onNext, locale }: MintedDialogProps) {
  const c = deskCopy[locale];
  const [showQr, setShowQr] = useState(false);
  const close = () => {
    setShowQr(false);
    onNext();
  };
  return (
    <Dialog
      isOpen={Boolean(minted)}
      onClose={close}
      title={c.issuedTitle}
      size="sm"
      footer={
        <>
          <Button type="button" variant="secondary" size="lg" iconEnd="arrow-right" onClick={close}>
            {c.next}
          </Button>
          <Button type="button" variant="primary" size="lg" icon="print" onClick={onPrint}>
            {c.print}
          </Button>
        </>
      }
    >
      {minted && (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-title-sm font-bold break-words">{minted.attendee_name}</p>
            <Badge variant="accent">{minted.ticket_tier_name}</Badge>
          </div>
          {minted.reactivated && <Notice tone="info">{c.reactivated}</Notice>}
          {minted.attendee_mobile && <p className="text-body-sm text-text-secondary print:hidden">{c.smsWillSend(formatMobile(minted.attendee_mobile, locale))}</p>}
          <Button type="button" variant="ghost" size="sm" icon="qr" onClick={() => setShowQr((shown) => !shown)} aria-expanded={showQr}>
            {showQr ? c.hideQr : c.showQr}
          </Button>
          {showQr && (
            <div className="mx-auto w-fit rounded-card bg-white p-3 ring-1 ring-border-default">
              <QRCode value={minted.qr_secret} size={176} level="M" viewBox="0 0 256 256" fgColor="#000000" bgColor="#FFFFFF" className="size-44" />
            </div>
          )}
          <PrintableBadge
            badge={{ qr: minted.qr_secret, name: minted.attendee_name, title: minted.title, organization: minted.organization, tier: minted.ticket_tier_name }}
            eventName={eventName}
            printable
            locale={locale}
          />
        </div>
      )}
    </Dialog>
  );
}
