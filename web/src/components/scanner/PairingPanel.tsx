import { useState, type FormEvent } from "react";
import type { ScannerCopy } from "../../copy/scanner";
import { QrCameraInput } from "../QrCameraInput";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { readPairingScan } from "./pairingLink";

interface PairingPanelProps {
  copy: ScannerCopy;
  locale: "fa" | "en";
  pointId: string;
  /** Stores the credential and loads the point. */
  onPair: (token: string) => Promise<void>;
}

/**
 * Pairs this device from inside the app: the camera reads the organizer's pairing QR code (a `/scan/<point>?token=`
 * link, which must name this point). Pasting the code stays as the fallback.
 */
export function PairingPanel({ copy, locale, pointId, onPair }: PairingPanelProps) {
  const [scanning, setScanning] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [token, setToken] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pair = async (value: string) => {
    setBusy(true);
    try {
      await onPair(value);
    } finally {
      setBusy(false);
    }
  };

  const onDecode = (value: string) => {
    const scan = readPairingScan(value, pointId);
    if (scan.kind === "ok") {
      setProblem(null);
      setScanning(false);
      void pair(scan.token);
      return;
    }
    setProblem(scan.kind === "wrongPoint" ? copy.pairWrongPoint : copy.pairNotLink);
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = token.trim();
    if (!value) return;
    setToken("");
    void pair(value);
  };

  return (
    <div className="flex flex-col gap-2.5">
      {scanning ? (
        <div data-testid="scanner-pair-camera">
          <QrCameraInput locale={locale} onDecode={onDecode} autoStart continuous />
        </div>
      ) : (
        <Button type="button" tone="ink" size="lg" icon="qr" isFullWidth loading={busy} onClick={() => setScanning(true)}>
          {copy.scanPairing}
        </Button>
      )}
      {problem && (
        <p role="alert" className="flex items-start gap-2 text-body-sm text-status-warning-bg">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          <span>{problem}</span>
        </p>
      )}
      {pasting ? (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <label htmlFor="scanner-pair-token" className="text-body-sm font-semibold text-ink-100">
            {copy.pasteLabel}
          </label>
          <input
            id="scanner-pair-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={copy.pastePlaceholder}
            autoComplete="off"
            dir="ltr"
            className="scanner-input scanner-input--bidi w-full font-mono"
          />
          <Button type="submit" variant="secondary" tone="ink" isFullWidth disabled={!token.trim() || busy}>
            {copy.pair}
          </Button>
        </form>
      ) : (
        <Button type="button" variant="ghost" tone="ink" icon="key" isFullWidth onClick={() => setPasting(true)}>
          {copy.pasteCode}
        </Button>
      )}
    </div>
  );
}
