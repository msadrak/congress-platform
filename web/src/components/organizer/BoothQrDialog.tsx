import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { Link } from "react-router-dom";
import { localizedApiError, type BoothOut } from "../../api/client";
import { organizerSetupCopy } from "../../copy/organizerSetup";
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
  const { eventId, client, locale } = useEventWorkspace();
  const copy = organizerSetupCopy[locale].boothQr;
  const [standee, setStandee] = useState<Standee | null>(null);
  const [error, setError] = useState<{ boothId: string; text: string } | null>(null);

  useEffect(() => {
    if (!booth || !client || !eventId) return;
    let alive = true;
    // A 401 reaches the layout's key gate through the API client (registerUnauthorizedHandler).
    void client
      .GET("/api/events/{event_id}/booths/{booth_id}/standee", { params: { path: { event_id: eventId, booth_id: booth.id } } })
      .then(({ data, error: err, response }) => {
        if (!alive) return;
        if (data) setStandee({ boothId: booth.id, url: data.url, pagePublished: data.page_published });
        else setError({ boothId: booth.id, text: localizedApiError(err, locale, response.status) });
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
      title={copy.title}
      description={copy.description}
      size="sm"
    >
      {booth && (
        <div className="space-y-5 py-1">
          {failure && <FormAlert>{failure}</FormAlert>}
          {shown && !shown.pagePublished && (
            <div role="alert" data-testid="standee-unpublished" className="flex items-start gap-2.5 rounded-xl border border-status-warning-border bg-status-warning-bg px-3.5 py-3 text-sm leading-relaxed text-status-warning-text">
              <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
              <span>
                {copy.unpublished}{" "}
                {eventId && (
                  <Link to={eventWorkspacePath(eventId, "/page")} className="font-semibold underline">
                    {copy.openStudio}
                  </Link>
                )}
              </span>
            </div>
          )}
          {!shown && !failure && <div className="skeleton mx-auto h-80 max-w-[18rem] rounded-card" aria-hidden="true" />}
          {shown && (
            <div
              data-testid="booth-standee"
              data-qr-value={shown.url}
              className="print-pass org-standee mx-auto max-w-[18rem] overflow-hidden rounded-card border border-border-default bg-white text-center shadow-lift"
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
                    aria-label={copy.qrLabel}
                  />
                </div>
                <div className="space-y-1">
                  <h3 className="break-words text-lg font-bold leading-snug text-text-primary">
                    <bdi>{booth.name}</bdi>
                  </h3>
                  {booth.location && (
                    <p className="text-xs text-text-secondary">
                      <bdi>{booth.location}</bdi>
                    </p>
                  )}
                </div>
                <p className="border-t border-border-subtle pt-3 text-[0.6875rem] leading-relaxed text-text-secondary">
                  {copy.scanHint}
                </p>
                <p className="break-all font-mono text-[0.625rem] text-text-muted" dir="ltr" data-testid="standee-url">
                  {shown.url}
                </p>
              </div>
            </div>
          )}
          <Button type="button" variant="primary" icon="print" isFullWidth disabled={!shown} onClick={() => window.print()}>
            {copy.print}
          </Button>
        </div>
      )}
    </Dialog>
  );
}
