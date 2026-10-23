import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { localizedApiError, type SmsCheckOut, type SmsSettingsOut, type SmsTemplateOut } from "../api/client";
import { commonCopy } from "../copy/common";
import { asciiDigits } from "../lib/mobile";
import { codeFontClass, formatNumber } from "../lib/format";
import { useMutation } from "../hooks/useMutation";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Field } from "../components/ui/Field";
import { CodeInput, TextInput } from "../components/ui/Input";
import { Notice } from "../components/ui/Notice";
import { PageHeader, SectionHeader } from "../components/ui/PageHeader";
import { ErrorState, LoadingState } from "../components/ui/StateBlock";
import { SmsTemplateEditor } from "../components/sms/SmsTemplateEditor";
import { PlatformSource } from "./PlatformSource";
import { PlatformStatus } from "./PlatformStatus";
import { TEXT_ACTION, usePlatform } from "./platformContext";

type ResetField = "mode" | "api_key" | "line_number" | "hourly_cap" | "daily_cap";
type CapField = "hourly_cap" | "daily_cap";
const CAPS: readonly CapField[] = ["hourly_cap", "daily_cap"];

/** The index route: Status first, the SMS settings on `?tab=sms` (both tabs share the route in App.tsx). */
export default function PlatformIndex() {
  const [params] = useSearchParams();
  return params.get("tab") === "sms" ? <PlatformSmsSettings /> : <PlatformStatus />;
}

/** "2000" / "۲۰۰۰" → 2000; null when it is not a whole number. */
function wholeNumber(text: string): number | null {
  const digits = asciiDigits(text.trim());
  return /^\d+$/.test(digits) ? Number(digits) : null;
}

/** SMS gateway (sms.ir key, service line, live or test mode), the platform-wide caps, and the message wording. */
function PlatformSmsSettings() {
  const { client, status, refreshStatus, locale, copy } = usePlatform();
  const c = copy.sms;
  const [sms, setSms] = useState<SmsSettingsOut>(status.sms);
  const [mode, setMode] = useState(status.sms.mode);
  const [apiKey, setApiKey] = useState("");
  const [line, setLine] = useState(status.sms.line_number ? String(status.sms.line_number) : "");
  const [caps, setCaps] = useState<Record<CapField, string>>({ hourly_cap: String(status.sms.hourly_cap), daily_cap: String(status.sms.daily_cap) });
  // Each request ends its own spinner whatever happens (useMutation).
  const saveRequest = useMutation(locale);
  const checkRequest = useMutation(locale);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmKeyReset, setConfirmKeyReset] = useState(false);
  const [check, setCheck] = useState<SmsCheckOut | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  const lineNumber = wholeNumber(line);
  const lineInvalid = line.trim() !== "" && lineNumber === null;
  const capInvalid = (field: CapField) => wholeNumber(caps[field]) === null;
  const invalid = lineInvalid || CAPS.some(capInvalid);

  const apply = (data: SmsSettingsOut, message: string) => {
    setSms(data);
    setMode(data.mode);
    setApiKey("");
    setLine(data.line_number ? String(data.line_number) : "");
    setCaps({ hourly_cap: String(data.hourly_cap), daily_cap: String(data.daily_cap) });
    setSaved(message);
    void refreshStatus();
  };

  const send = async (body: { mode?: "smsir" | "console"; api_key?: string; line_number?: number; hourly_cap?: number; daily_cap?: number; reset: ResetField[] }, message: string) => {
    setError(null);
    setSaved(null);
    const result = await saveRequest.run(() => client.PUT("/api/platform/sms", { body }));
    if (!result.ok) return;
    const { data, error: err, response } = result.value;
    if (data) apply(data, message);
    else setError(localizedApiError(err, locale, response.status));
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (saveRequest.busy || invalid) return;
    const body: Parameters<typeof send>[0] = { reset: [] };
    if (mode !== sms.mode) body.mode = mode;
    if (apiKey.trim()) body.api_key = apiKey.trim();
    if (lineNumber !== null && lineNumber !== sms.line_number) body.line_number = lineNumber;
    for (const field of CAPS) {
      const value = wholeNumber(caps[field]);
      if (value !== null && value !== sms[field]) body[field] = value;
    }
    void send(body, c.saved);
  };

  const label: Record<ResetField, string> = { mode: c.delivery, api_key: c.apiKey, line_number: c.line, hourly_cap: c.hourlyCap, daily_cap: c.dailyCap };
  const reset = (field: ResetField) => {
    if (saveRequest.busy) return;
    void send({ reset: [field] }, field === "api_key" ? c.keyRemoved : copy.source.reset(label[field]));
  };

  const runCheck = async () => {
    setCheck(null);
    setCheckError(null);
    const result = await checkRequest.run(() =>
      client.POST("/api/platform/sms/check", { body: { api_key: apiKey.trim() || null, line_number: lineNumber } }),
    );
    if (!result.ok) return;
    const { data, error: err, response } = result.value;
    if (data) setCheck(data);
    else setCheckError(localizedApiError(err, locale, response.status));
  };

  const shownError = error ?? saveRequest.error;
  const effectiveTone = { smsir: "success", console: "warning", unconfigured: "danger" } as const;

  return (
    <div className="space-y-8">
      <PageHeader title={c.title} />

      <section aria-labelledby="gateway-title" className="rounded-card border border-border-default bg-surface-panel p-4 shadow-soft sm:p-6">
        <form onSubmit={save} className="space-y-6" noValidate>
          <SectionHeader id="gateway-title" title={c.gateway} />
          <div data-testid="gateway-state">
            <Notice tone={effectiveTone[sms.effective]}>
              {sms.effective === "unconfigured" ? copy.status.unconfigured : copy.status.effective[sms.effective]}
            </Notice>
          </div>

          <fieldset className="space-y-2">
            <legend className="ui-label">{c.delivery}</legend>
            <div className="flex flex-wrap gap-3">
              {(["smsir", "console"] as const).map((value) => (
                <label
                  key={value}
                  className={`flex min-h-11 items-center gap-2 rounded-control border px-3.5 text-body-sm ${mode === value ? "border-action-primary" : "border-border-default"} ${value === "console" && !sms.console_allowed ? "opacity-50" : "cursor-pointer"}`}
                >
                  <input type="radio" name="mode" value={value} checked={mode === value} disabled={value === "console" && !sms.console_allowed} onChange={() => setMode(value)} />
                  {value === "smsir" ? c.live : c.test}
                </label>
              ))}
            </div>
            <PlatformSource source={sms.mode_source} busy={saveRequest.busy} onReset={() => reset("mode")} />
          </fieldset>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1">
              <Field label={c.apiKey} hint={sms.api_key_unreadable ? c.keyUnreadable : sms.api_key_set ? c.keySaved(sms.api_key_hint ?? "") : undefined}>
                <CodeInput type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={sms.api_key_set ? "••••••••" : ""} />
              </Field>
              {sms.api_key_source === "console" ? (
                <button type="button" disabled={saveRequest.busy} onClick={() => setConfirmKeyReset(true)} className={`text-body-sm ${TEXT_ACTION}`}>
                  {c.removeKey}
                </button>
              ) : (
                <PlatformSource source={sms.api_key_source} onReset={() => reset("api_key")} />
              )}
            </div>
            <div className="space-y-1">
              <Field label={c.line} error={lineInvalid ? c.digitsOnly : undefined}>
                <TextInput dir="ltr" inputMode="numeric" autoComplete="off" value={line} onChange={(e) => setLine(e.target.value)} className={codeFontClass(line)} />
              </Field>
              <PlatformSource source={sms.line_number_source} busy={saveRequest.busy} onReset={() => reset("line_number")} />
            </div>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-body font-bold text-text-primary">{c.limits}</legend>
            <div className="grid gap-5 sm:grid-cols-2">
              {CAPS.map((field) => (
                <div key={field} className="space-y-1">
                  <Field label={field === "hourly_cap" ? c.hourlyCap : c.dailyCap} hint={c.capHint} error={capInvalid(field) ? c.capInvalid : undefined}>
                    <TextInput
                      dir="ltr"
                      inputMode="numeric"
                      autoComplete="off"
                      value={caps[field]}
                      onChange={(e) => setCaps((current) => ({ ...current, [field]: e.target.value }))}
                      className={codeFontClass(caps[field])}
                    />
                  </Field>
                  <PlatformSource source={sms.caps_source[field] as "console" | "environment" | undefined} busy={saveRequest.busy} onReset={() => reset(field)} />
                </div>
              ))}
            </div>
            <p className="text-caption text-text-muted">{c.capsNote}</p>
          </fieldset>

          {shownError && <Notice tone="danger">{shownError}</Notice>}
          {saved && <Notice tone="success">{saved}</Notice>}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" icon="check" loading={saveRequest.busy} disabled={invalid}>
              {c.save}
            </Button>
            <Button type="button" variant="secondary" icon="activity" loading={checkRequest.busy} onClick={() => void runCheck()}>
              {c.check}
            </Button>
          </div>

          {(checkError ?? checkRequest.error) && <Notice tone="danger">{checkError ?? checkRequest.error}</Notice>}
          {check && (
            <div data-testid="gateway-check">
              <Notice tone={check.ok ? "success" : "danger"} title={check.ok ? c.connected : c.notConnected}>
                {check.ok ? (
                  <>
                    {check.credit !== null && check.credit !== undefined && <p>{c.credit(formatNumber(check.credit, locale))}</p>}
                    {check.lines.length > 0 && (
                      <p>
                        {c.lines}{" "}
                        <bdi dir="ltr" className="font-mono">
                          {check.lines.join(", ")}
                        </bdi>
                      </p>
                    )}
                    {check.line_ok === false && <p className="font-semibold">{c.lineNotOwned}</p>}
                  </>
                ) : check.error === "NO_API_KEY" ? (
                  <p>{c.noKey}</p>
                ) : (
                  check.error && (
                    <p>
                      <bdi dir="ltr" className="font-mono text-caption">
                        {check.error}
                      </bdi>
                    </p>
                  )
                )}
              </Notice>
            </div>
          )}
        </form>
      </section>

      <PlatformTemplates />

      <ConfirmDialog
        isOpen={confirmKeyReset}
        title={c.confirmKeyTitle}
        description={c.confirmKeyBody}
        confirmLabel={c.confirmKeyAction}
        tone="danger"
        onCancel={() => setConfirmKeyReset(false)}
        onConfirm={() => {
          setConfirmKeyReset(false);
          reset("api_key");
        }}
      />
    </div>
  );
}

/** The platform-wide message texts (sign-in code, invitations, default confirmations). */
function PlatformTemplates() {
  const { client, status, locale, copy } = usePlatform();
  const c = copy.sms;
  const [templates, setTemplates] = useState<SmsTemplateOut[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let active = true;
    client
      .GET("/api/platform/sms-templates")
      .then(({ data, error: err, response }) => {
        if (!active) return;
        if (data) setTemplates(data);
        else setError(localizedApiError(err, locale, response.status));
      })
      .catch(() => active && setError(commonCopy[locale].network));
    return () => {
      active = false;
    };
  }, [client, locale, reloads]);

  // SMS pass links are short links (ADR 0015); "sample2345" can never be a real code.
  const sampleOrigin = (status.short_link_origin ?? status.public_origin ?? window.location.origin).replace(/\/$/, "");
  const consoleOrigin = (status.public_origin ?? window.location.origin).replace(/\/$/, "");
  const s = c.sample;
  const samples: Record<string, Record<string, string>> = {
    otp: { code: "1".repeat(status.sign_in.otp_length), minutes: String(Math.max(1, Math.floor(status.sign_in.otp_ttl_seconds / 60))) },
    ticket_confirmation: { name: s.attendee, event: s.event, tier: s.tier, location: s.location, link: `${sampleOrigin}/t/sample2345` },
    // Invitations link to pages on the public origin, not to short links.
    staff_invite: { name: s.staff, booth: s.booth, event: s.event, link: `${consoleOrigin}/booth/sample` },
    member_invite: { name: s.member, role: s.role, organizer: s.organizer, link: `${consoleOrigin}/organizer` },
    operator_invite: { name: s.operator, event: s.event, link: `${consoleOrigin}/reception/sample` },
  };
  const outcome = <T,>({ data, error: err, response }: { data?: T; error?: unknown; response: Response }) => ({
    data,
    error: data ? undefined : localizedApiError(err, locale, response.status),
  });

  return (
    <section aria-labelledby="templates-title" className="space-y-4">
      <SectionHeader id="templates-title" title={c.templates} />
      {error && !templates ? (
        <ErrorState
          title={c.templatesFailed}
          body={error}
          headingLevel={3}
          onRetry={() => {
            setError(null);
            setReloads((n) => n + 1);
          }}
        />
      ) : !templates ? (
        <LoadingState />
      ) : (
        templates.map((template) => (
          <SmsTemplateEditor
            key={template.kind}
            template={template}
            sample={samples[template.kind] ?? samples.ticket_confirmation}
            locale={locale}
            title={c.templateTitles[template.kind] ?? template.kind}
            customLabel={c.customLabel}
            defaultLabel={c.defaultLabel}
            resetDescription={c.resetDescription}
            savedMessage={c.templateSaved}
            note={c.templateNotes[template.kind] ?? c.eventDefaultNote}
            onSave={async (body) =>
              outcome(await client.PUT("/api/platform/sms-templates/{kind}", { params: { path: { kind: template.kind } }, body: { body } }))
            }
            onReset={async () => outcome(await client.DELETE("/api/platform/sms-templates/{kind}", { params: { path: { kind: template.kind } } }))}
            onTest={async (mobile, body) => outcome(await client.POST("/api/platform/sms/test", { body: { mobile, kind: template.kind, body } }))}
          />
        ))
      )}
    </section>
  );
}
