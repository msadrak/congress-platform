import QRCode from "react-qr-code";
import { badgeAffiliation } from "../../lib/deskBadge";

export interface BadgeData {
  qr: string;
  name: string;
  title: string;
  organization: string;
  tier: string;
}

interface PrintableBadgeProps {
  badge: BadgeData;
  /** Congress name from the operator context, when known. */
  eventName?: string;
  /** Only one badge is printable at a time, so a print never stacks two badges. */
  printable: boolean;
  isRtl: boolean;
}

/**
 * The badge the desk prints («کارت ورود»): name, title and organization from the registration, tier and the QR
 * code the gates scan. Not shown on screen; it is the only thing `window.print()` outputs, laid out for an A6
 * card or an 80 mm thermal roll (black on white, no backgrounds; styles/reception.css `.rx-badge`).
 */
export function PrintableBadge({ badge, eventName, printable, isRtl }: PrintableBadgeProps) {
  const affiliation = badgeAffiliation(badge.title, badge.organization);
  return (
    <article
      data-testid="badge-print"
      aria-hidden="true"
      dir={isRtl ? "rtl" : "ltr"}
      className={`rx-badge${printable ? " print-pass" : ""}`}
    >
      {eventName && <p className="rx-badge-event">{eventName}</p>}
      <h2 className="rx-badge-name">{badge.name}</h2>
      {affiliation && <p className="rx-badge-affiliation">{affiliation}</p>}
      <div className="rx-badge-qr">
        <QRCode value={badge.qr} size={200} level="M" viewBox="0 0 256 256" fgColor="#000000" bgColor="#FFFFFF" />
      </div>
      <p className="rx-badge-tier">{badge.tier}</p>
    </article>
  );
}
