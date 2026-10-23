import QRCode from "react-qr-code";
import type { BoothOut } from "../../api/client";
import type { TranslationDictionary } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";

interface BoothQrDialogProps {
  /** The booth whose standee QR is previewed; null keeps the dialog closed. */
  booth: BoothOut | null;
  eventName: string;
  t: TranslationDictionary;
  isRtl: boolean;
  onClose: () => void;
}

/** Printable standee QR of a booth: attendees scan it to bookmark the booth. */
export function BoothQrDialog({ booth, eventName, t, isRtl, onClose }: BoothQrDialogProps) {
  return (
    <Dialog
      isOpen={Boolean(booth)}
      onClose={onClose}
      title={t.standeeQrModalTitle}
      description={booth ? `${t.standeeQrModalDesc} (${booth.name})` : undefined}
      size="sm"
    >
      {booth && (
        <div className="space-y-5 py-1">
          <div className="mx-auto max-w-[18rem] overflow-hidden shape-arc border border-border-default bg-white text-center shadow-lift">
            <div aria-hidden="true" className="h-1.5 bg-[image:var(--grad-aiteb)]" />
            <div className="space-y-4 px-6 pb-6 pt-5">
              <p className="truncate text-[0.6875rem] font-semibold text-text-muted">
                <bdi>{eventName}</bdi>
              </p>
              <div className="org-plate mx-auto inline-block rounded-xl p-4 ring-1 ring-border-default">
                <QRCode value={booth.id} size={180} level="M" viewBox="0 0 256 256" fgColor="#0F172A" bgColor="#FFFFFF" className="h-48 w-48 select-none" />
              </div>
              <div className="space-y-1">
                <h3 className="break-words text-lg font-bold leading-snug text-text-primary">
                  <bdi>{booth.name}</bdi>
                </h3>
                {booth.location && <p className="text-xs text-text-secondary">{booth.location}</p>}
              </div>
              <p className="border-t border-border-subtle pt-3 font-mono text-[0.625rem] text-text-muted">
                {isRtl ? "شناسه غرفه: " : "Booth ID: "}
                <bdi dir="ltr">{booth.id}</bdi>
              </p>
            </div>
          </div>
          <Button type="button" variant="ink" size="md" isFullWidth onClick={() => window.print()}>
            <Icon name="print" size={18} />
            {isRtl ? "چاپ کد QR استند" : "Print Standee QR"}
          </Button>
        </div>
      )}
    </Dialog>
  );
}
