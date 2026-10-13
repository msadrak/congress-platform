import { Icon } from "../ui/Icon";
import type { ScannerCopy } from "./copy";
import { LanguageSwitch, ProductMark } from "./ScannerChrome";

type Locale = "fa" | "en";

interface ScannerHeaderProps {
  locale: Locale;
  copy: ScannerCopy;
  languageLabel: string;
  onToggleLocale: () => void;
  pointName: string;
  policyType: string;
  location: string | null | undefined;
  cachedTickets: number;
  conflictCount: number;
  conflictsHeading: string;
  onOpenConflicts: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  syncFailCount: number;
  /** Shown only while the manifest is usable (no auth block, offline window valid). */
  manifest: { synced: boolean; at: string; windowLeft: string | null } | null;
}

const policyTone: Record<string, string> = {
  SINGLE_USE: "scanner-policy--single",
  TIER_RESTRICTED: "scanner-policy--tier",
  CAPACITY_CAPPED: "scanner-policy--capacity",
  MULTI_ENTRY: "scanner-policy--multi",
};

export function ScannerHeader(props: ScannerHeaderProps) {
  const { locale, copy, isOnline, pendingCount, syncFailCount, manifest } = props;
  return (
    <header className="scanner-header relative z-20 border-b border-white/10 bg-ink-950/95 pt-safe backdrop-blur-sm lg:sticky lg:top-0">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        {/* Tools */}
        <div className="flex items-center justify-between gap-2 pt-2.5">
          <ProductMark text={copy.product} compact={props.conflictCount > 0} />
          <div className="flex items-center gap-1.5">
            {props.conflictCount > 0 && (
              <button
                type="button"
                onClick={props.onOpenConflicts}
                title={props.conflictsHeading}
                className="scanner-tool inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border border-status-danger-solid/70 bg-status-danger-solid/20 px-3 text-[13px] font-bold text-[#FFB3C4] hover:bg-status-danger-solid/30"
              >
                <span aria-hidden="true" className="relative grid size-2 place-items-center">
                  <span className="absolute inset-0 rounded-full bg-status-danger-solid motion-safe:animate-pulse-ring" />
                  <span className="size-2 rounded-full bg-[#FF6B8E]" />
                </span>
                <span>{props.conflictCount} {locale === "fa" ? "تداخل" : "Conflicts"}</span>
              </button>
            )}
            <button
              type="button"
              onClick={props.onToggleSound}
              aria-pressed={props.soundEnabled}
              aria-label={props.soundEnabled ? copy.soundOn : copy.soundOff}
              title={props.soundEnabled ? "Mute audio chimes" : "Enable audio chimes"}
              className={`scanner-tool grid size-11 place-items-center rounded-[10px] border ${
                props.soundEnabled
                  ? "border-white/12 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                  : "border-status-warning-solid/60 bg-status-warning-solid/15 text-[#FFC266]"
              }`}
            >
              <Icon name={props.soundEnabled ? "bell" : "bell-off"} size={19} />
            </button>
            <LanguageSwitch locale={locale} label={props.languageLabel} onToggle={props.onToggleLocale} />
          </div>
        </div>

        <div className="flex flex-col gap-3 pb-3 pt-3 lg:flex-row lg:items-end lg:justify-between lg:gap-8">
          {/* Gate identity */}
          <div className="min-w-0">
            <h1 className="scanner-gate-name break-words font-display text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.03em] text-white sm:text-[2.125rem]">
              {props.pointName}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-ink-300">
              <span className={`scanner-policy ${policyTone[props.policyType] ?? ""}`}>
                <span className="font-mono text-[11.5px] font-semibold" dir="ltr">
                  {props.policyType}
                </span>
              </span>
              {copy.policy[props.policyType] && <span className="text-ink-200">{copy.policy[props.policyType]}</span>}
              <span className="inline-flex min-w-0 items-center gap-1">
                <Icon name="pin" size={14} className="text-ink-400" />
                <span className="truncate">{props.location || copy.defaultLocation}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <Icon name="layers" size={14} className="text-ink-400" />
                <span className="font-mono tabular text-ink-100">{props.cachedTickets}</span> {copy.inCache}
              </span>
            </div>
          </div>

          {/* Device status rail */}
          <dl className="scanner-rail grid shrink-0 grid-cols-3 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] lg:min-w-[27rem]">
            <div className="scanner-rail-cell">
              <dt>{copy.link}</dt>
              <dd className={isOnline ? "text-[#5BE3AE]" : "text-[#FFC266]"}>
                <Icon name={isOnline ? "wifi" : "wifi-off"} size={16} />
                <span>{isOnline ? copy.online : copy.offline}</span>
              </dd>
              {props.isSyncing && (
                <p className="scanner-rail-note text-ink-300">
                  <Icon name="sync" size={12} className="motion-safe:animate-spin" />
                  {copy.syncing}
                </p>
              )}
            </div>
            <div className="scanner-rail-cell">
              {manifest ? (
                <>
                  <dt>{manifest.synced ? copy.manifestSynced : copy.manifestCached}</dt>
                  <dd className="font-mono tabular text-white" dir="ltr">
                    {manifest.at}
                  </dd>
                  {manifest.windowLeft && (
                    <p className="scanner-rail-note flex-wrap text-[#FFC266]">
                      {copy.windowLeadLabel}{" "}
                      <span className="ltr-isolate whitespace-nowrap font-mono">{manifest.windowLeft}</span> {copy.windowLeftTail}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <dt>{copy.manifest}</dt>
                  <dd className="font-mono text-ink-400">—</dd>
                </>
              )}
            </div>
            <div className="scanner-rail-cell">
              <dt>{copy.queue}</dt>
              <dd className={pendingCount > 0 ? "text-[#FFC266]" : "text-white"}>
                <span className="font-mono tabular text-[1.125rem] leading-none">{pendingCount}</span>
                <span className="text-[12px] font-medium text-ink-300">{copy.queued}</span>
              </dd>
              {syncFailCount > 0 && (
                <p className="scanner-rail-note text-[#FF8BA8]" title={copy.syncFailures(syncFailCount)}>
                  <Icon name="alert" size={12} />
                  <span className="font-mono tabular">{syncFailCount}</span>
                  <span className="sr-only">{copy.syncFailures(syncFailCount)}</span>
                </p>
              )}
            </div>
          </dl>
        </div>
      </div>
    </header>
  );
}
