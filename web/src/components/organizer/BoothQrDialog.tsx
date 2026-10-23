import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { Link } from "react-router-dom";
import { localizedApiError, type BoothOut } from "../../api/client";
import { eventWorkspacePath } from "../../lib/organizerWorkspace";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { FormAlert } from "./WorkspaceUi";
import { useEventWorkspace } from "./eventWorkspaceContext";

interface BoothQrDialogProps {
  /** The booth whose standee QR is previewed; null keeps the dialog closed. */
  booth: BoothOut | null;
  eventName: string;
  onClose: () => void;
}

interface Standee {
  boothId: string;
  url: string;
  pagePublished: boolean;
}

/**
 * Printable standee QR of a booth. It encodes the standee address from the API (the public booth page, plus the
 * booth's QR secret so a signed-in attendee bookmarks it in one tap), never the bare booth id, and warns while the
 * congress page is unpublished (the address answers 404 until then).
 */
export function BoothQrDialog({ booth, eventName, onClose }: BoothQrDialogProps) {
  const { eventId, client, locale, t, isRtl } = useEventWorkspace();
  const [standee, setStandee] = useState<Standee | null>(null);
  const [error, setError] = useState<{ boothId: string; text: string } | null>(null);

  useEffect(() => {
    if (!booth || !client || !eventId) return;
    let alive = true;
    // A 401 reaches the layout's key gate through the API client (registerUnauthorizedHandler).
    void client
      .GET("/api/events/{event_id}/booths/{booth_id}/standee", { params: { path: { event_id: eventId, booth_id: booth.id } } })
      .then(({ data, error: err }) => {
        if (!alive) return;
        if (data) setStandee({ boothId: booth.id, url: data.url, pagePublished: data.page_published });
        else setError({ boothId: booth.id, text: localizedApiError(err, locale) });
      });
    return () => {
      alive = false;
    };
  }, [booth, client, eventId, locale]);

  // Only the answer for the booth on screen is shown: a late one for a previous booth never is.
  const shown = booth && standee?.boothId === booth.id ? standee : null;
  const failure = booth && error?.boothId === booth.id ? error.text : null;

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
          {failure && <FormAlert>{failure}</FormAlert>}
          {shown && !shown.pagePublished && (
            <div role="alert" data-testid="standee-unpublished" className="flex items-start gap-2.5 rounded-xl border border-status-warning-border bg-status-warning-bg px-3.5 py-3 text-sm leading-relaxed text-status-warning-text">
              <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
              <span>
                {isRtl
                  ? "صفحهٔ عمومی همایش هنوز منتشر نشده است؛ تا انتشار آن، اسکن این کیوآرکد به صفحهٔ «یافت نشد» می‌رسد. پیش از چاپ، صفحه را منتشر کنید. "
                  : "The congress page is not published yet, so scanning this code opens a “not found” page until it is. Publish the page before printing. "}
                {eventId && (
                  <Link to={eventWorkspacePath(eventId, "/page")} className="font-semibold underline">
                    {isRtl ? "رفتن به صفحهٔ عمومی" : "Open Page Studio"}
                  </Link>
                )}
              </span>
            </div>
          )}
          {!shown && !failure && <div className="skeleton mx-auto h-80 max-w-[18rem] shape-arc" aria-hidden="true" />}
          {shown && (
            <div
              data-testid="booth-standee"
              data-qr-value={shown.url}
              className="print-pass org-standee mx-auto max-w-[18rem] overflow-hidden shape-arc border border-border-default bg-white text-center shadow-lift"
            >
              <div aria-hidden="true" className="h-1.5 bg-[image:var(--grad-aiteb)]" />
              <div className="space-y-4 px-6 pb-6 pt-5">
                <p className="truncate text-[0.6875rem] font-semibold text-text-muted">
                  <bdi>{eventName}</bdi>
                </p>
                <div className="org-plate mx-auto inline-block rounded-xl p-4 ring-1 ring-border-default">
                  <QRCode
                    value={shown.url}
                    size={180}
                    level="M"
                    viewBox="0 0 256 256"
                    fgColor="#0F172A"
                    bgColor="#FFFFFF"
                    className="h-48 w-48 select-none"
                    aria-label={isRtl ? "کیوآرکد صفحهٔ غرفه" : "Booth page QR code"}
                  />
                </div>
                <div className="space-y-1">
                  <h3 className="break-words text-lg font-bold leading-snug text-text-primary">
                    <bdi>{booth.name}</bdi>
                  </h3>
                  {booth.location && <p className="text-xs text-text-secondary">{booth.location}</p>}
                </div>
                <p className="border-t border-border-subtle pt-3 text-[0.6875rem] leading-relaxed text-text-secondary">
                  {isRtl ? "با دوربین گوشی اسکن کنید تا صفحهٔ غرفه باز شود." : "Scan with your phone camera to open the booth page."}
                </p>
                <p className="break-all font-mono text-[0.625rem] text-text-muted" dir="ltr" data-testid="standee-url">
                  {shown.url}
                </p>
              </div>
            </div>
          )}
          <Button type="button" variant="ink" size="md" isFullWidth disabled={!shown} onClick={() => window.print()}>
            <Icon name="print" size={18} />
            {isRtl ? "چاپ کیوآرکد استند" : "Print Standee QR"}
          </Button>
        </div>
      )}
    </Dialog>
  );
}
