import { useEffect, useState } from "react";
import { localizedApiError } from "../api/client";
import type { components } from "../api/schema";
import { commonCopy } from "../copy/common";
import { formatDate, formatNumber } from "../lib/format";
import { Badge, type BadgeVariant } from "../components/ui/Badge";
import { Button, LinkButton } from "../components/ui/Button";
import { MetaList } from "../components/ui/MetaList";
import { Notice } from "../components/ui/Notice";
import { PageHeader, SectionHeader } from "../components/ui/PageHeader";
import { ErrorState, LoadingState } from "../components/ui/StateBlock";
import { SMS_TAB, usePlatform } from "./platformContext";

type SmsOutboxOut = components["schemas"]["SmsOutboxOut"];
const OUTBOX_STATUSES = ["pending", "sending", "sent", "failed", "unknown", "resolved"] as const;
const GATEWAY_TONE: Record<"smsir" | "console" | "unconfigured", BadgeVariant> = { smsir: "success", console: "warning", unconfigured: "danger" };

/** What to watch on a congress day: the SMS gateway state, the outbox counts and the sending caps in use. */
export function PlatformStatus() {
  const { client, status, refreshStatus, locale, copy } = usePlatform();
  const c = copy.status;
  const [outbox, setOutbox] = useState<SmsOutboxOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let active = true;
    client
      .GET("/api/platform/sms/outbox")
      .then(({ data, error: err, response }) => {
        if (!active) return;
        if (data) {
          setOutbox(data);
          setError(null);
        } else setError(localizedApiError(err, locale, response.status));
      })
      .catch(() => active && setError(commonCopy[locale].network));
    return () => {
      active = false;
    };
  }, [client, locale, reloads]);

  const reload = () => {
    setError(null);
    setReloads((n) => n + 1);
    void refreshStatus();
  };
  const number = (n: number) => formatNumber(n, locale);
  const usage = (used: number, cap: number) => (cap > 0 ? c.usage(number(used), number(cap)) : c.noCap(number(used)));
  const effective = status.sms.effective;

  return (
    <div className="space-y-6">
      <PageHeader
        title={c.title}
        meta={
          <span className="inline-flex items-center gap-2" data-testid="gateway-chip">
            {c.gateway}
            <Badge variant={GATEWAY_TONE[effective]} dot={effective === "smsir"}>
              {c.effective[effective]}
            </Badge>
          </span>
        }
        actions={
          <Button type="button" variant="secondary" icon="sync" onClick={reload}>
            {c.refresh}
          </Button>
        }
      />
      {effective === "unconfigured" && (
        <Notice
          tone="danger"
          action={
            <LinkButton to={SMS_TAB} variant="secondary" size="sm">
              {c.setUp}
            </LinkButton>
          }
        >
          {c.unconfigured}
        </Notice>
      )}

      <section aria-labelledby="outbox-title" className="space-y-4 rounded-card border border-border-default bg-surface-panel p-4 shadow-soft sm:p-6">
        <SectionHeader id="outbox-title" title={c.outbox} />
        {error && !outbox ? (
          <ErrorState title={c.outboxFailed} body={error} headingLevel={3} onRetry={reload} />
        ) : !outbox ? (
          <LoadingState />
        ) : (
          <>
            {error && <Notice tone="danger">{error}</Notice>}
            <dl data-testid="outbox-counts" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {OUTBOX_STATUSES.map((key) => {
                const count = outbox.counts[key] ?? 0;
                const alarming = (key === "failed" || key === "unknown") && count > 0;
                return (
                  <div key={key} className="rounded-control border border-border-subtle px-3.5 py-2.5">
                    <dt className="text-caption text-text-muted">{c.counts[key]}</dt>
                    <dd className={`tabular text-title-sm font-bold ${alarming ? "text-status-danger-text" : "text-text-primary"}`}>{number(count)}</dd>
                  </div>
                );
              })}
            </dl>
            <MetaList
              columns={3}
              items={[
                { label: c.lastHour, value: usage(outbox.sent_last_hour, outbox.hourly_cap) },
                { label: c.lastDay, value: usage(outbox.sent_last_day, outbox.daily_cap) },
                { label: c.oldest, value: outbox.oldest_pending_at ? formatDate(outbox.oldest_pending_at, "dayTime", locale) : c.none },
              ]}
            />
          </>
        )}
      </section>
    </div>
  );
}
