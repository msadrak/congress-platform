import React, { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { localizedApiError, type CheckInPointOut, type ScannerDeviceOut, type ScannerTokenOut } from "../../api/client";
import { commonCopy } from "../../copy/common";
import { organizerSetupCopy } from "../../copy/organizerSetup";
import { SCANNER_APP_VERSION } from "../../lib/appBuild";
import { formatDate, formatNumber } from "../../lib/format";
import { isLoopbackHost, scannerPairingUrl } from "../../lib/scannerPairing";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { TextInput } from "../ui/Input";
import { RowActions } from "../ui/RowActions";
import { StatusChip } from "../ui/StatusChip";
import { DialogActions, Field, FormAlert } from "./WorkspaceUi";
import { useEventWorkspace } from "./eventWorkspaceContext";
import { eventTimeZone } from "./sessionTime";

interface ScannerPairingDialogProps {
  /** The check-in point whose devices are shown; null keeps the dialog closed. */
  point: CheckInPointOut | null;
  onClose: () => void;
  /** The point's device list after it was loaded, a device was paired or one lost access. */
  onDevicesChange?: (pointId: string, devices: ScannerDeviceOut[]) => void;
}

/** An active device that runs another scanner build than this console (it updates when reloaded). */
const needsUpdate = (device: ScannerDeviceOut) => !device.is_revoked && Boolean(device.app_version) && device.app_version !== SCANNER_APP_VERSION;

/**
 * The devices of one check-in point: the list first (last seen, scans not sent yet, offline, update needed,
 * remove access), then pairing a new device. Pairing issues a point-scoped device credential and hands it over
 * as a QR pairing link, shown once (the API never returns it again). Staff and up; the server decides.
 */
export function ScannerPairingDialog({ point, onClose, onDevicesChange }: ScannerPairingDialogProps) {
  const { client, locale, event } = useEventWorkspace();
  const copy = organizerSetupCopy[locale].devices;
  const common = commonCopy[locale];
  const zone = event ? eventTimeZone(event) : undefined;
  const [deviceName, setDeviceName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [issued, setIssued] = useState<ScannerTokenOut | null>(null);
  const [copied, setCopied] = useState(false);
  const [devices, setDevices] = useState<ScannerDeviceOut[] | null>(null);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const pointId = point?.id ?? null;

  // Every opening starts clean: no pairing link from a previous point or a previous pairing stays on screen.
  useEffect(() => {
    setDeviceName("");
    setFormError(null);
    setIssued(null);
    setCopied(false);
    setDevices(null);
    setDevicesError(null);
    if (!pointId || !client) return;
    let active = true;
    // The workspace client answers a network failure as a result, so this always ends in a list or an error.
    void client.GET("/api/checkin-points/{point_id}/devices", { params: { path: { point_id: pointId } } }).then(({ data, error, response }) => {
      if (!active) return;
      if (data) {
        setDevices(data);
        onDevicesChange?.(pointId, data);
      } else {
        setDevices([]);
        setDevicesError(localizedApiError(error, locale, response.status));
      }
    });
    return () => {
      active = false;
    };
    // Reload only when the dialog opens for another point; locale or callback identity changes must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointId, client]);

  if (!point) return null;

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const loopback = import.meta.env.DEV && typeof window !== "undefined" && isLoopbackHost(window.location.hostname);
  const pairingUrl = issued ? scannerPairingUrl(origin, point.id, issued.scanner_token) : "";
  const at = (iso: string) => formatDate(iso, "dayTime", locale, zone);

  const updateDevices = (next: ScannerDeviceOut[]) => {
    setDevices(next);
    onDevicesChange?.(point.id, next);
  };

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const name = deviceName.trim();
    if (!name) {
      setFormError(copy.nameRequired);
      return;
    }
    if (!client) return;
    setSubmitting(true);
    const { data, error, response } = await client.POST("/api/checkin-points/{point_id}/token", {
      params: { path: { point_id: point.id } },
      body: { device_name: name },
    });
    setSubmitting(false);
    if (!data) {
      setFormError(localizedApiError(error, locale, response.status));
      return;
    }
    setIssued(data);
    setCopied(false);
    setDeviceName("");
    const now = new Date().toISOString();
    updateDevices([
      { id: data.device_id, checkin_point_id: data.point_id, event_id: data.event_id, device_name: name, is_revoked: false, revoked_at: null, created_at: now, last_seen_at: null, stale: false },
      ...(devices ?? []).filter((d) => d.id !== data.device_id),
    ]);
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
    if (!client) return;
    setRevokingId(device.id);
    const { data, error, response } = await client.POST("/api/checkin-points/{point_id}/devices/{device_id}/revoke", {
      params: { path: { point_id: point.id, device_id: device.id } },
    });
    setRevokingId(null);
    if (!data) {
      setDevicesError(localizedApiError(error, locale, response.status));
      return;
    }
    setDevicesError(null);
    updateDevices((devices ?? []).map((d) => (d.id === data.id ? data : d)));
    // A pairing link still on screen for the removed device no longer works; do not keep offering it.
    if (issued?.device_id === data.id) setIssued(null);
  };

  const num = (n: number) => formatNumber(n, locale);

  return (
    <Dialog isOpen onClose={() => !submitting && onClose()} title={copy.title(point.name)} size="lg">
      <div className="space-y-6">
        <section aria-labelledby="paired-devices-title" className="space-y-3">
          <h3 id="paired-devices-title" className="text-body-sm font-bold text-text-primary">
            {copy.listTitle}
          </h3>
          {devicesError && <FormAlert>{devicesError}</FormAlert>}
          {devices === null ? (
            <p className="text-caption text-text-muted">{common.loading}</p>
          ) : devices.length === 0 ? (
            !devicesError && <p className="text-caption text-text-muted">{copy.none}</p>
          ) : (
            <ul className="divide-y divide-border-subtle rounded-control border border-border-default" data-testid="device-list">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3" data-testid="device-row">
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 text-body-sm font-semibold text-text-primary">
                      <Icon name="smartphone" size={16} className="shrink-0 text-text-muted" />
                      <bdi className="min-w-0 break-words">{d.device_name}</bdi>
                      {d.is_revoked && <StatusChip status="accessRemoved" size="sm" />}
                      {!d.is_revoked && d.stale && (
                        <Badge variant="warning" size="sm" icon={<Icon name="alert" size={12} />} title={copy.staleHint} data-testid="device-stale">
                          {copy.stale}
                        </Badge>
                      )}
                      {needsUpdate(d) && (
                        <Badge variant="warning" size="sm" title={copy.updateHint} data-testid="device-version-mismatch">
                          {copy.updateNeeded}
                        </Badge>
                      )}
                    </p>
                    <p className="text-caption text-text-muted" data-testid="device-report">
                      <bdi>{d.last_seen_at ? copy.lastSeen(at(d.last_seen_at)) : copy.neverSeen}</bdi>
                      {!d.is_revoked && d.unsynced_count ? (
                        <>
                          {" · "}
                          <bdi>{copy.unsynced(num(d.unsynced_count))}</bdi>
                        </>
                      ) : null}
                    </p>
                    {!d.is_revoked && d.stale && <p className="text-caption text-status-warning-text">{copy.staleHint}</p>}
                  </div>
                  {!d.is_revoked && (
                    <RowActions
                      visible={0}
                      menuLabel={copy.moreActions(d.device_name)}
                      actions={[
                        {
                          label: copy.revoke,
                          icon: "x-circle",
                          disabled: revokingId === d.id,
                          onSelect: () => void handleRevoke(d),
                          destructive: { title: copy.revokeTitle(d.device_name), description: copy.revokeBody, confirmLabel: copy.revoke },
                        },
                      ]}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="pair-device-title" className="space-y-4 border-t border-border-subtle pt-5">
          <h3 id="pair-device-title" className="text-body-sm font-bold text-text-primary">
            {copy.pairTitle}
          </h3>
          {loopback && <FormAlert>{copy.loopback}</FormAlert>}
          {issued ? (
            <section aria-labelledby="pairing-ready-title" className="space-y-4" data-testid="pairing-ready">
              <div className="space-y-1">
                <p id="pairing-ready-title" className="flex items-center gap-2 text-body-sm font-bold text-status-success-text">
                  <Icon name="check-circle" size={20} />
                  {copy.ready}
                </p>
                <p className="text-caption text-text-secondary">{copy.readyBody}</p>
              </div>
              <div className="space-y-3 text-center">
                <div className="mx-auto inline-block rounded-control bg-white p-4 ring-1 ring-border-default">
                  <QRCode
                    value={pairingUrl}
                    size={208}
                    level="M"
                    viewBox="0 0 256 256"
                    fgColor="#0F172A"
                    bgColor="#FFFFFF"
                    className="h-52 w-52 select-none"
                    aria-label={copy.qrLabel}
                    role="img"
                  />
                </div>
                <p data-testid="pairing-link" dir="ltr" className="select-all break-all text-start font-mono text-caption leading-relaxed text-text-secondary">
                  {pairingUrl}
                </p>
                <p className="text-start text-caption text-text-secondary" data-testid="pairing-install-hint">
                  {copy.installHint}
                </p>
                <p className="text-start text-caption text-text-muted">
                  <time dateTime={issued.expires_at}>{copy.validUntil(at(issued.expires_at))}</time>
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="ghost" icon="plus" onClick={() => setIssued(null)}>
                  {copy.pairAnother}
                </Button>
                <Button type="button" variant="primary" icon={copied ? "check" : "copy"} onClick={() => void handleCopy()}>
                  {copied ? common.copied : copy.copyLink}
                </Button>
              </div>
              <span role="status" className="sr-only">
                {copied ? copy.copiedStatus : ""}
              </span>
            </section>
          ) : (
            <form onSubmit={handleIssue} className="space-y-4" noValidate>
              <Field label={copy.nameLabel} required hint={copy.nameHint} error={formError}>
                <TextInput required maxLength={120} value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder={copy.namePlaceholder} />
              </Field>
              <DialogActions>
                <Button type="button" variant="ghost" disabled={submitting} onClick={onClose}>
                  {common.close}
                </Button>
                <Button type="submit" variant="primary" icon="qr" loading={submitting}>
                  {copy.create}
                </Button>
              </DialogActions>
            </form>
          )}
        </section>
      </div>
    </Dialog>
  );
}
