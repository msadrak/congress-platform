import { Badge } from "../components/ui/Badge";
import { TEXT_ACTION, usePlatform } from "./platformContext";

/**
 * Where a platform setting comes from: a «از تنظیمات سرور» tag when the server's environment sets it, or a
 * «بازگشت به تنظیمات سرور» action when it was changed here.
 */
export function PlatformSource({
  source,
  onReset,
  busy = false,
}: {
  source: "console" | "environment" | null | undefined;
  onReset: () => void;
  busy?: boolean;
}) {
  const { copy } = usePlatform();
  if (source === "environment") {
    return (
      <Badge variant="neutral" size="sm">
        {copy.source.server}
      </Badge>
    );
  }
  if (source !== "console") return null;
  return (
    <button type="button" disabled={busy} aria-busy={busy || undefined} onClick={onReset} className={TEXT_ACTION}>
      {copy.source.useServer}
    </button>
  );
}
