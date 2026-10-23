/**
 * The web app's build id (vite.config.ts `define`: the commit, or the build time), and the version a scanner
 * reports in its heartbeat. The organizer's device list compares each device's version with its own build, so
 * staff can see on congress day that every gate runs the same build as the console.
 */
declare const __APP_BUILD__: string | undefined;

export const APP_BUILD: string = typeof __APP_BUILD__ === "string" && __APP_BUILD__ ? __APP_BUILD__ : "dev";

/** Scanner protocol (2: admission windows, entry/exit, heartbeat); bump when the scanner's API use changes. */
export const SCANNER_PROTOCOL = "web-scanner/2";

/** What a scanner of this build reports as `app_version` (at most 40 characters, the server's limit). */
export const SCANNER_APP_VERSION = `${SCANNER_PROTOCOL}+${APP_BUILD}`.slice(0, 40);

/** The protocol part of a reported version ("web-scanner/2+abc123" -> "web-scanner/2"). */
export function scannerProtocol(appVersion: string | null | undefined): string | null {
  return appVersion ? (appVersion.split("+")[0] ?? null) : null;
}
