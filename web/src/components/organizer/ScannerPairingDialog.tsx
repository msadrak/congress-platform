import React, { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import {
  createApiClient,
  formatApiError,
  type CheckInPointOut,
  type ScannerDeviceOut,
  type ScannerTokenOut,
} from "../../api/client";
import { isLoopbackHost, scannerPairingUrl } from "../../lib/scannerPairing";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { DialogActions, Field, FormAlert } from "./WorkspaceUi";

interface ScannerPairingDialogProps {
  /** The check-in point being paired; null keeps the dialog closed. */
  point: CheckInPointOut | null;
  apiKey: string;
  locale: "fa" | "en";
  isRtl: boolean;
  onKeyRejected: (sentKey: string) => void;
  onClose: () => void;
}

const formatDateTime = (iso: string, locale: "fa" | "en") => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(d);
};

/**
 * Pair a phone or tablet with one check-in point: issue a point-scoped device token, hand it over as a
 * QR pairing link (shown once; the API never returns it again), and list or revoke the point's devices.
 */
export function ScannerPairingDialog({ point, apiKey, locale, isRtl, onKeyRejected, onClose }: ScannerPairingDialogProps) {
  const [deviceName, setDeviceName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [issued, setIssued] = useState<ScannerTokenOut | null>(null);
  const [copied, setCopied] = useState(false);
  const [devices, setDevices] = useState<ScannerDeviceOut[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ScannerDeviceOut | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const pointId = point?.id ?? null;

  // Every opening starts clean: no token from a previous point or a previous pairing stays on screen.
  useEffect(() => {
    setDeviceName("");
    setFormError(null);
    setIssued(null);
    setCopied(false);
    setDevices([]);
    setDevicesError(null);
    setRevokeTarget(null);
    if (!pointId || !apiKey) return;
    let active = true;
    setDevicesLoading(true);
    const client = createApiClient({ kind: "organizer", token: apiKey });
    client
      .GET("/api/checkin-points/{point_id}/devices", { params: { path: { point_id: pointId } } })
      .then(({ data, error, response }) => {
        if (!active) return;
        if (response.status === 401) onKeyRejected(apiKey);
        if (error) setDevicesError(formatApiError(error));
        else setDevices(data ?? []);
      })
      .catch(() => {
        if (active) setDevicesError(isRtl ? "فهرست دستگاه‌ها بارگذاری نشد." : "Could not load the device list.");
      })
      .finally(() => {
        if (active) setDevicesLoading(false);
      });
    return () => {
      active = false;
    };
    // Reload only when the dialog opens for another point; locale or callback identity changes must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointId, apiKey]);

  if (!point) return null;

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const loopback = typeof window !== "undefined" && isLoopbackHost(window.location.hostname);
  const pairingUrl = issued ? scannerPairingUrl(origin, point.id, issued.scanner_token) : "";
  const activeCount = devices.filter((d) => !d.is_revoked).length;

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const name = deviceName.trim();
    if (!name) {
      setFormError(isRtl ? "یک نام برای دستگاه وارد کنید تا بعداً بتوانید آن را بشناسید." : "Give the device a name so you can recognise it later.");
      return;
    }
    setSubmitting(true);
    const client = createApiClient({ kind: "organizer", token: apiKey });
    try {
      const { data, error, response } = await client.POST("/api/checkin-points/{point_id}/token", {
        params: { path: { point_id: point.id } },
        body: { device_name: name },
      });
      if (response.status === 401) onKeyRejected(apiKey);
      if (error) {
        setFormError(formatApiError(error));
      } else if (data) {
        setIssued(data);
        setCopied(false);
        setDeviceName("");
        const now = new Date().toISOString();
        setDevices((prev) => [
          { id: data.device_id, checkin_point_id: data.point_id, event_id: data.event_id, device_name: name, is_revoked: false, revoked_at: null, created_at: now, last_seen_at: null },
          ...prev.filter((d) => d.id !== data.device_id),
        ]);
      }
    } catch {
      setFormError(isRtl ? "ارتباط با سرور برقرار نشد؛ دوباره تلاش کنید." : "Could not reach the server; try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(pairingUrl);
      setCopied(true);
    } catch {
      // Clipboard access needs a secure, focused document; the link stays selectable for a manual copy.
      setCopied(false);
    }
  };

  const handleRevoke = async (device: ScannerDeviceOut) => {
    setRevokingId(device.id);
    const client = createApiClient({ kind: "organizer", token: apiKey });
    try {
      const { data, error, response } = await client.POST("/api/checkin-points/{point_id}/devices/{device_id}/revoke", {
        params: { path: { point_id: point.id, device_id: device.id } },
      });
      if (response.status === 401) onKeyRejected(apiKey);
      if (error) {
        setDevicesError(isRtl ? `لغو دستگاه انجام نشد: ${formatApiError(error)}` : `Could not revoke the device: ${formatApiError(error)}`);
      } else if (data) {
        setDevicesError(null);
        setDevices((prev) => prev.map((d) => (d.id === data.id ? data : d)));
        // A token still on screen for the revoked device no longer works; do not keep offering it.
        if (issued?.device_id === data.id) setIssued(null);
      }
    } catch {
      setDevicesError(isRtl ? "ارتباط با سرور برقرار نشد؛ دوباره تلاش کنید." : "Could not reach the server; try again.");
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <>
      <Dialog
        isOpen
        onClose={() => {
          // The confirmation shares the window Escape listener; closing it must not also close this dialog.
          if (!submitting && !revokeTarget) onClose();
        }}
        title={isRtl ? "اتصال دستگاه اسکنر" : "Pair a scanner device"}
        description={
          isRtl
            ? `یک تلفن یا تبلت را به گیت «${point.name}» متصل کنید. هر دستگاه کلید جداگانه‌ای دارد که می‌توانید هر زمان لغو کنید.`
            : `Connect a phone or tablet to “${point.name}”. Each device gets its own key, which you can revoke at any time.`
        }
        size="lg"
      >
        <div className="space-y-6">
          {loopback && (
            <p role="note" className="flex items-start gap-2 rounded-xl border border-status-warning-border bg-status-warning-bg px-3.5 py-3 text-xs leading-relaxed text-status-warning-text">
              <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
              {isRtl
                ? "این کنسول از آدرس localhost باز شده است؛ لینک اتصال در تلفن کار نمی‌کند. کنسول را با آدرس شبکه این رایانه (مثلاً https://192.168.x.x:8443) باز کنید."
                : "This console is open on localhost, so the pairing link will not work on a phone. Open the console through this computer's network address (e.g. https://192.168.x.x:8443)."}
            </p>
          )}

          {issued ? (
            <section aria-labelledby="pairing-ready-title" className="space-y-4">
              <div className="overflow-hidden shape-arc border border-status-success-border bg-status-success-bg">
                <div className="space-y-2 p-5 text-status-success-text">
                  <p id="pairing-ready-title" className="flex items-center gap-2 text-sm font-bold">
                    <Icon name="check-circle" size={20} />
                    {isRtl ? "دستگاه آماده اتصال است." : "Device ready to pair."}
                  </p>
                  <p className="text-xs leading-relaxed">
                    {isRtl
                      ? "با دوربین تلفن این کیوآرکد را اسکن کنید یا لینک را برای آن بفرستید. این لینک فقط یک‌بار نمایش داده می‌شود؛ مانند رمز عبور با آن رفتار کنید."
                      : "Scan this QR code with the phone's camera, or send it the link. It is shown only once; treat it like a password."}
                  </p>
                </div>
                <div className="space-y-4 border-t border-status-success-border bg-white px-5 py-5 text-center">
                  <div className="org-plate mx-auto inline-block rounded-xl p-4 ring-1 ring-border-default">
                    <QRCode
                      value={pairingUrl}
                      size={208}
                      level="M"
                      viewBox="0 0 256 256"
                      fgColor="#0F172A"
                      bgColor="#FFFFFF"
                      className="h-52 w-52 select-none"
                      aria-label={isRtl ? "کیوآرکد لینک اتصال اسکنر" : "Scanner pairing link QR code"}
                      role="img"
                    />
                  </div>
                  <p data-testid="pairing-link" dir="ltr" className="select-all break-all text-start font-mono text-[0.6875rem] leading-relaxed text-text-secondary">
                    {pairingUrl}
                  </p>
                  <p className="text-xs text-text-muted">
                    {isRtl ? "اعتبار تا " : "Valid until "}
                    <time dateTime={issued.expires_at}>{formatDateTime(issued.expires_at, locale)}</time>
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="secondary" size="md" onClick={() => setIssued(null)}>
                  <Icon name="plus" size={16} />
                  {isRtl ? "اتصال دستگاه دیگر" : "Pair another device"}
                </Button>
                <Button type="button" variant="ink" size="md" onClick={() => void handleCopy()}>
                  <Icon name={copied ? "check" : "copy"} size={16} />
                  {copied ? (isRtl ? "کپی شد" : "Copied") : isRtl ? "کپی لینک" : "Copy link"}
                </Button>
              </div>
              <span role="status" className="sr-only">
                {copied ? (isRtl ? "لینک اتصال کپی شد." : "Pairing link copied.") : ""}
              </span>
            </section>
          ) : (
            <form onSubmit={handleIssue} className="space-y-4">
              <Field
                label={isRtl ? "نام دستگاه" : "Device name"}
                required
                hint={isRtl ? "کلید ۷ روز معتبر است. پس از آن یک کلید تازه صادر کنید." : "The key is valid for 7 days; issue a new one after that."}
              >
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  placeholder={isRtl ? "مثال: گیت اصلی - تلفن ۱" : "e.g. Main gate - phone 1"}
                  className="ui-input"
                />
              </Field>
              {formError && <FormAlert>{formError}</FormAlert>}
              <DialogActions>
                <Button type="button" variant="ghost" size="md" disabled={submitting} onClick={onClose}>
                  {isRtl ? "انصراف" : "Cancel"}
                </Button>
                <Button type="submit" variant="primary" size="md" disabled={submitting}>
                  <Icon name="qr" size={16} />
                  {submitting ? "..." : isRtl ? "صدور لینک اتصال" : "Create pairing link"}
                </Button>
              </DialogActions>
            </form>
          )}

          <section aria-labelledby="paired-devices-title" className="space-y-3 border-t border-border-subtle pt-5">
            <div className="flex items-center justify-between gap-3">
              <h3 id="paired-devices-title" className="text-sm font-bold text-text-primary">
                {isRtl ? "دستگاه‌های متصل" : "Paired devices"}
              </h3>
              <Badge variant={activeCount > 0 ? "success" : "neutral"} size="sm">
                {isRtl ? `${activeCount} فعال` : `${activeCount} active`}
              </Badge>
            </div>
            {devicesError && <FormAlert>{devicesError}</FormAlert>}
            {devicesLoading ? (
              <p className="text-xs text-text-muted">{isRtl ? "در حال بارگذاری…" : "Loading…"}</p>
            ) : devices.length === 0 ? (
              <p className="text-xs text-text-muted">{isRtl ? "هنوز دستگاهی به این گیت متصل نشده است." : "No device has been paired with this gate yet."}</p>
            ) : (
              <ul className="divide-y divide-border-subtle rounded-xl border border-border-default">
                {devices.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0 space-y-0.5">
                      <p className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                        <Icon name="smartphone" size={16} className="shrink-0 text-text-muted" />
                        <bdi className="min-w-0 break-words">{d.device_name}</bdi>
                      </p>
                      <p className="text-[0.6875rem] text-text-muted">
                        {isRtl ? "صدور: " : "Issued "}
                        {formatDateTime(d.created_at, locale)}
                        {d.last_seen_at ? ` · ${isRtl ? "آخرین فعالیت: " : "last seen "}${formatDateTime(d.last_seen_at, locale)}` : ""}
                      </p>
                    </div>
                    {d.is_revoked ? (
                      <Badge variant="neutral" size="sm">
                        {isRtl ? "لغو شده" : "Revoked"}
                      </Badge>
                    ) : (
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        disabled={revokingId === d.id}
                        onClick={() => setRevokeTarget(d)}
                        aria-label={isRtl ? `لغو ${d.device_name}` : `Revoke ${d.device_name}`}
                      >
                        <Icon name="x-circle" size={15} />
                        {revokingId === d.id ? "..." : isRtl ? "لغو" : "Revoke"}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </Dialog>

      <ConfirmDialog
        isOpen={revokeTarget !== null}
        tone="danger"
        title={isRtl ? "لغو دسترسی دستگاه؟" : "Revoke this device?"}
        description={
          revokeTarget
            ? isRtl
              ? `${revokeTarget.device_name} دیگر نمی‌تواند فهرست شرکت‌کنندگان را دریافت کند یا اسکن ثبت کند.`
              : `${revokeTarget.device_name} will no longer be able to load attendees or record scans.`
            : ""
        }
        confirmLabel={isRtl ? "لغو دستگاه" : "Revoke device"}
        cancelLabel={isRtl ? "انصراف" : "Cancel"}
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => {
          const target = revokeTarget;
          setRevokeTarget(null);
          if (target) void handleRevoke(target);
        }}
      />
    </>
  );
}
