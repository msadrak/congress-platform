import { AitebAttribution } from "../brand/Aiteb";
import { Icon } from "../ui/Icon";
import type { ScannerCopy } from "./copy";
import { BiLabel, SystemReadout } from "./ScannerChrome";

type Locale = "fa" | "en";

interface DeviceSettingsProps {
  locale: Locale;
  copy: ScannerCopy;
  pointId: string | undefined;
  unpairNotice: string | null;
  /** The same notice in English for supervisors, shown verbatim under a translated one. */
  unpairDetail: string | null;
  showConfirm: boolean;
  unpairing: boolean;
  pendingCount: number;
  isOnline: boolean;
  onAskUnpair: () => void;
  onConfirmUnpair: () => void;
  onCancelUnpair: () => void;
}

/** Device settings with the unpair danger zone; the only place the AIteb credit appears on the live screen. */
export function DeviceSettings(props: DeviceSettingsProps) {
  const { locale, copy } = props;
  return (
    <section className="pt-1" aria-labelledby="scanner-settings-title">
      <div aria-hidden="true" className="scanner-rule mb-4" />
      <div className="flex items-start justify-between gap-3">
        <h2 id="scanner-settings-title" className="flex items-center gap-2 text-[13px] font-semibold text-ink-200">
          <span aria-hidden="true" className="scanner-index">{copy.sectionIndex(4)}</span>
          {copy.settingsTitle}
        </h2>
        {props.pointId && (
          <span className="max-w-[55%] truncate font-mono text-[11.5px] text-ink-400" dir="ltr" title={props.pointId}>
            {props.pointId}
          </span>
        )}
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-400">{copy.settingsBody}</p>

      {props.unpairNotice && (
        <div className="mt-3 space-y-2">
          <p role="status" dir="auto" className="rounded-xl border border-status-success-solid/40 bg-status-success-solid/10 px-3 py-2.5 text-[13px] leading-relaxed text-[#9AF0CB]">
            {props.unpairNotice}
          </p>
          <SystemReadout label={copy.systemDetail} lines={[props.unpairDetail]} />
        </div>
      )}

      <div className="mt-4 border-t border-dashed border-status-danger-solid/30 pt-4">
        {!props.showConfirm ? (
          <button
            type="button"
            onClick={props.onAskUnpair}
            className="scanner-tool inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-status-danger-solid/50 bg-transparent px-4 text-[14px] font-semibold text-[#FF8BA8] hover:bg-status-danger-solid/10"
          >
            <Icon name="lock" size={17} />
            <BiLabel locale={locale} label={copy.unpair} />
          </button>
        ) : (
          <div className="space-y-3 rounded-xl border border-status-danger-solid/60 bg-status-danger-solid/10 p-3.5">
            <p className="flex items-start gap-2 text-[13px] font-medium leading-relaxed text-[#FFC9D5]">
              <Icon name="alert" size={17} className="mt-0.5 text-[#FF8BA8]" />
              <span>
                {copy.unpairQuestion} {props.pendingCount > 0 ? copy.unpairPending(props.pendingCount) : copy.unpairRetained}{" "}
                {!props.isOnline && copy.unpairOffline}
              </span>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={props.unpairing}
                onClick={props.onConfirmUnpair}
                className="scanner-tool inline-flex min-h-12 flex-1 items-center justify-center rounded-xl bg-status-danger-solid px-4 text-[14px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
              >
                {props.unpairing ? copy.unpairing : <BiLabel locale={locale} label={copy.confirmUnpair} />}
              </button>
              <button
                type="button"
                disabled={props.unpairing}
                onClick={props.onCancelUnpair}
                className="scanner-tool inline-flex min-h-12 flex-1 items-center justify-center rounded-xl border border-white/12 bg-white/[0.05] px-4 text-[14px] font-semibold text-ink-100 hover:bg-white/10 disabled:opacity-50"
              >
                {copy.cancel}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-5 border-t border-white/[0.07] pt-4">
        <AitebAttribution locale={locale} tone="dark" />
      </div>
    </section>
  );
}
