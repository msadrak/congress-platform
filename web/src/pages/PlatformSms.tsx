import { useEffect, useState, type FormEvent } from "react";
import { formatApiError, type SmsCheckOut, type SmsSettingsOut, type SmsTemplateOut } from "../api/client";
import { asciiDigits } from "../lib/mobile";
import { formatLocalizedNumber } from "../lib/i18n";
import { networkErrorMessage } from "../lib/errorMessages";
import { useMutation } from "../hooks/useMutation";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Icon } from "../components/ui/Icon";
import { Field, FormAlert, SectionHeader } from "../components/organizer/WorkspaceUi";
import { SmsTemplateEditor } from "../components/sms/SmsTemplateEditor";
import { usePlatform } from "./platformContext";

/** SMS gateway (sms.ir key, service line, live or test mode) and the platform-wide message wording. */
export default function PlatformSms() {
  const { client, status, refreshStatus, checkResponse, locale, isRtl } = usePlatform();
  const [sms, setSms] = useState<SmsSettingsOut>(status.sms);
  const [mode, setMode] = useState(status.sms.mode);
  const [apiKey, setApiKey] = useState("");
  const [line, setLine] = useState(status.sms.line_number ? String(status.sms.line_number) : "");
  // Each request ends its own spinner whatever happens (useMutation); a network failure is its error.
  const saveRequest = useMutation(locale);
  const resetRequest = useMutation(locale);
  const checkRequest = useMutation(locale);
  const saving = saveRequest.busy;
  const resetting = resetRequest.busy;
  const checking = checkRequest.busy;
  /** An HTTP failure's message for save or reset; network failures live in the mutations. */
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmKeyReset, setConfirmKeyReset] = useState(false);
  const [check, setCheck] = useState<SmsCheckOut | null>(null);
  const [templates, setTemplates] = useState<SmsTemplateOut[] | null>(null);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templatesOffline, setTemplatesOffline] = useState(false);
  const shownSaveError = saveError ?? saveRequest.error ?? resetRequest.error;

  useEffect(() => {
    let active = true;
    client
      .GET("/api/platform/sms-templates")
      .then(({ data, error, response }) => {
        checkResponse(response.status);
        if (!active) return;
        if (data) setTemplates(data);
        else setTemplatesError(error ? formatApiError(error) : "—");
      })
      .catch(() => {
        if (active) setTemplatesOffline(true);
      });
    return () => {
      active = false;
    };
  }, [client, checkResponse]);

  const clearSaveMessages = () => {
    setSaveError(null);
    setSaved(null);
    saveRequest.setError(null);
    resetRequest.setError(null);
  };

  const lineNumber = (() => {
    const digits = asciiDigits(line.trim());
    return /^\d+$/.test(digits) ? Number(digits) : null;
  })();
  const lineInvalid = line.trim() !== "" && lineNumber === null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (saving || lineInvalid) return;
    clearSaveMessages();
    const body: { mode?: "smsir" | "console"; api_key?: string; line_number?: number; reset: [] } = { reset: [] };
    if (mode !== sms.mode || sms.mode_source === "environment") body.mode = mode;
    if (apiKey.trim()) body.api_key = apiKey.trim();
    if (lineNumber !== null && lineNumber !== sms.line_number) body.line_number = lineNumber;
    const result = await saveRequest.run(() => client.PUT("/api/platform/sms", { body }));
    if (!result.ok) return;
    const { data, error, response } = result.value;
    checkResponse(response.status);
    if (data) {
      setSms(data);
      setMode(data.mode);
      setApiKey("");
      setSaved(isRtl ? "تنظیمات پیامک ذخیره و بلافاصله اعمال شد." : "SMS settings saved and applied immediately.");
      void refreshStatus();
    } else {
      setSaveError(error ? formatApiError(error) : isRtl ? "ذخیره نشد." : "Not saved.");
    }
  };

  const resetToEnvironment = async (field: "mode" | "api_key" | "line_number") => {
    if (resetting) return;
    clearSaveMessages();
    const result = await resetRequest.run(() => client.PUT("/api/platform/sms", { body: { reset: [field] } }));
    if (!result.ok) return;
    const { data, error, response } = result.value;
    checkResponse(response.status);
    if (data) {
      setSms(data);
      setMode(data.mode);
      setLine(data.line_number ? String(data.line_number) : "");
      setSaved(
        {
          mode: isRtl ? "حالت ارسال اکنون از مقدار .env پیروی می‌کند." : "Delivery now follows the .env value.",
          api_key: isRtl ? "کلید ذخیره‌شده در پنل حذف شد؛ در صورت وجود، کلید .env استفاده می‌شود." : "The key saved here was removed; the .env key is used if there is one.",
          line_number: isRtl ? "شماره خط اکنون از مقدار .env پیروی می‌کند." : "The line number now follows the .env value.",
        }[field],
      );
      void refreshStatus();
    } else {
      setSaveError(error ? formatApiError(error) : isRtl ? "تغییری اعمال نشد." : "Nothing was changed.");
    }
  };

  const runCheck = async () => {
    setCheck(null);
    const result = await checkRequest.run(() =>
      client.POST("/api/platform/sms/check", { body: { api_key: apiKey.trim() || null, line_number: lineNumber } }),
    );
    if (!result.ok) return;
    const { data, response } = result.value;
    checkResponse(response.status);
    setCheck(data ?? { ok: false, credit: null, lines: [], line_ok: null, error: `HTTP_${response.status}` });
  };

  const effective = {
    smsir: { tone: "success", text: isRtl ? "فعال: پیامک‌ها واقعاً از خط خدماتی ارسال می‌شوند." : "Live: messages are really sent from the service line." },
    console: { tone: "warning", text: isRtl ? "حالت آزمایشی: هیچ پیامکی ارسال نمی‌شود؛ پیامک‌ها فقط ثبت می‌شوند." : "Test mode: nothing is sent; messages are only recorded." },
    unconfigured: { tone: "danger", text: isRtl ? "پیکربندی نشده: کلید API یا شماره خط وارد نشده است؛ ورود و پیامک‌ها کار نمی‌کنند." : "Not configured: the API key or line number is missing; sign-in codes and confirmations cannot be sent." },
  }[sms.effective];
  const toneClass = {
    success: "border-status-success-border bg-status-success-bg text-status-success-text",
    warning: "border-status-warning-border bg-status-warning-bg text-status-warning-text",
    danger: "border-status-danger-border bg-status-danger-bg text-status-danger-text",
  }[effective.tone as "success" | "warning" | "danger"];
  const source = (s: "console" | "environment" | null | undefined) =>
    s === "environment" ? (isRtl ? "از فایل .env" : "from .env") : s === "console" ? (isRtl ? "از این پنل" : "set here") : null;
  // SMS pass links are short links (ADR 0015); "sample2345" can never be a real code.
  const sampleOrigin = (status.short_link_origin ?? status.public_origin ?? window.location.origin).replace(/\/$/, "");
  const samples: Record<string, Record<string, string>> = {
    otp: { code: "1".repeat(status.sign_in.otp_length), minutes: String(Math.max(1, Math.floor(status.sign_in.otp_ttl_seconds / 60))) },
    ticket_confirmation: { name: "نام شرکت‌کننده", event: "همایش نمونه", tier: "عمومی", location: "تهران", link: `${sampleOrigin}/t/sample2345` },
  };

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow={isRtl ? "پنل مدیریت سامانه" : "Platform console"}
        title={isRtl ? "پیامک" : "SMS"}
        description={
          isRtl
            ? "اتصال به sms.ir و متن پیامک‌هایی که برای همه همایش‌ها یکسان است."
            : "The sms.ir connection and the wording shared by every congress."
        }
      />

      <section aria-labelledby="gateway-title" className="overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft">
        <div className="border-b border-border-subtle px-5 py-4 sm:px-6">
          <h2 id="gateway-title" className="text-base font-bold">{isRtl ? "درگاه پیامک (sms.ir)" : "SMS gateway (sms.ir)"}</h2>
        </div>
        <form onSubmit={save} className="space-y-5 p-5 sm:p-6" noValidate>
          <p role="status" data-testid="gateway-state" className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm ${toneClass}`}>
            <Icon name={sms.effective === "smsir" ? "check-circle" : "alert"} size={18} className="mt-0.5 shrink-0" />
            {effective.text}
          </p>

          <fieldset className="space-y-2">
            <legend className="ui-label">{isRtl ? "حالت ارسال" : "Delivery"}</legend>
            <div className="flex flex-wrap gap-3">
              {(["smsir", "console"] as const).map((value) => (
                <label key={value} className={`flex min-h-11 items-center gap-2 rounded-xl border px-3.5 text-sm ${mode === value ? "border-action-primary" : "border-border-default"} ${value === "console" && !sms.console_allowed ? "opacity-50" : "cursor-pointer"}`}>
                  <input type="radio" name="mode" value={value} checked={mode === value} disabled={value === "console" && !sms.console_allowed} onChange={() => setMode(value)} />
                  {value === "smsir" ? (isRtl ? "ارسال واقعی از sms.ir" : "Live delivery through sms.ir") : isRtl ? "حالت آزمایشی (ارسال نمی‌شود)" : "Test mode (nothing is sent)"}
                </label>
              ))}
            </div>
            <p className="text-xs text-text-muted">
              {source(sms.mode_source)}
              {sms.mode_source === "console" && (
                <button type="button" disabled={resetting} aria-busy={resetting} onClick={() => void resetToEnvironment("mode")} className="ms-2 font-semibold text-action-primary hover:underline cursor-pointer disabled:cursor-wait disabled:opacity-60">
                  {isRtl ? "استفاده از مقدار .env" : "Use the .env value"}
                </button>
              )}
            </p>
          </fieldset>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label={isRtl ? "کلید API در sms.ir" : "sms.ir API key"}
              hint={
                sms.api_key_unreadable
                  ? isRtl ? "کلید ذخیره‌شده قابل خواندن نیست (کلید JWT سرور تغییر کرده)؛ دوباره وارد کنید." : "The saved key cannot be read (the server's JWT secret changed); enter it again."
                  : sms.api_key_set
                    ? `${isRtl ? "ذخیره شده" : "Saved"} ${sms.api_key_hint ?? ""} · ${source(sms.api_key_source) ?? ""} · ${isRtl ? "برای حفظ، خالی بگذارید" : "leave empty to keep it"}`
                    : isRtl ? "پنل sms.ir ← برنامه‌نویسان ← کلیدهای API" : "sms.ir panel → Developers → API keys"
              }
            >
              <input type="password" dir="ltr" autoComplete="off" spellCheck={false} value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="ui-input font-mono" placeholder={sms.api_key_set ? "••••••••" : ""} />
            </Field>
            <Field
              label={isRtl ? "شماره خط خدماتی" : "Service line number"}
              hint={lineInvalid ? (isRtl ? "فقط رقم وارد کنید." : "Digits only.") : source(sms.line_number_source) ?? (isRtl ? "شماره خطی که پیامک‌ها از آن ارسال می‌شوند." : "The line messages are sent from.")}
            >
              <input type="text" dir="ltr" inputMode="numeric" autoComplete="off" value={line} onChange={(e) => setLine(e.target.value)} aria-invalid={lineInvalid} className="ui-input font-mono" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-3 text-xs">
            {sms.api_key_source === "console" && (
              <button type="button" disabled={resetting} onClick={() => setConfirmKeyReset(true)} className="font-semibold text-action-primary hover:underline cursor-pointer disabled:cursor-wait disabled:opacity-60">
                {isRtl ? "حذف کلید ذخیره‌شده در پنل" : "Remove the key saved here"}
              </button>
            )}
            {sms.line_number_source === "console" && (
              <button type="button" disabled={resetting} aria-busy={resetting} onClick={() => void resetToEnvironment("line_number")} className="font-semibold text-action-primary hover:underline cursor-pointer disabled:cursor-wait disabled:opacity-60">
                {isRtl ? "استفاده از شماره خط .env" : "Use the .env line number"}
              </button>
            )}
          </div>

          {shownSaveError && <FormAlert>{shownSaveError}</FormAlert>}
          {saved && <p role="status" className="text-sm font-medium text-status-success-text">{saved}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" size="md" disabled={saving || lineInvalid} aria-busy={saving}>
              <Icon name="check" size={16} />
              {saving ? (isRtl ? "در حال ذخیره…" : "Saving…") : isRtl ? "ذخیره تنظیمات" : "Save settings"}
            </Button>
            <Button type="button" variant="secondary" size="md" disabled={checking} aria-busy={checking} onClick={() => void runCheck()}>
              <Icon name="activity" size={16} />
              {checking ? (isRtl ? "در حال بررسی…" : "Checking…") : isRtl ? "بررسی اتصال و اعتبار" : "Check connection & credit"}
            </Button>
          </div>

          {checkRequest.error && <FormAlert>{checkRequest.error}</FormAlert>}
          {check && (
            <div role="status" data-testid="gateway-check" className={`space-y-1 rounded-xl border px-4 py-3 text-sm ${check.ok ? "border-status-success-border bg-status-success-bg text-status-success-text" : "border-status-danger-border bg-status-danger-bg text-status-danger-text"}`}>
              {check.ok ? (
                <>
                  <p className="font-semibold">{isRtl ? "اتصال برقرار است." : "Connected."}</p>
                  {check.credit !== null && <p>{isRtl ? "اعتبار حساب: " : "Account credit: "}{formatLocalizedNumber(check.credit, locale)}</p>}
                  {check.lines.length > 0 && (
                    <p>
                      {isRtl ? "خطوط حساب: " : "Account lines: "}
                      <bdi dir="ltr" className="font-mono">{check.lines.join(", ")}</bdi>
                    </p>
                  )}
                  {check.line_ok === false && <p className="font-semibold">{isRtl ? "شماره خط واردشده جزو خطوط این حساب نیست." : "The line number is not one of this account's lines."}</p>}
                </>
              ) : (
                <p>
                  {isRtl ? "اتصال برقرار نشد: " : "Not connected: "}
                  <bdi dir="ltr">{check.error === "NO_API_KEY" ? (isRtl ? "کلید API وارد نشده" : "no API key") : check.error}</bdi>
                </p>
              )}
            </div>
          )}
        </form>
      </section>

      {templatesError && <FormAlert>{templatesError}</FormAlert>}
      {templatesOffline && <FormAlert>{networkErrorMessage[locale]}</FormAlert>}
      {templates?.map((template) => (
        // TODO(gen:api): drop the `as string` casts once schema.d.ts lists the ticket_cancelled/ticket_reissued kinds.
        <SmsTemplateEditor
          key={template.kind}
          template={template}
          sample={samples[template.kind] ?? samples.ticket_confirmation}
          locale={locale}
          title={template.kind === "otp" ? (isRtl ? "پیامک کد ورود (همه همایش‌ها)" : "Sign-in code SMS (every congress)") : (template.kind as string) === "ticket_cancelled" ? (isRtl ? "پیامک پیش‌فرض لغو بلیت" : "Default ticket cancellation SMS") : (template.kind as string) === "ticket_reissued" ? (isRtl ? "پیامک پیش‌فرض صدور دوبارهٔ کارت ورود" : "Default pass reissue SMS") : isRtl ? "پیامک پیش‌فرض تأیید ثبت‌نام" : "Default ticket confirmation SMS"}
          customLabel={isRtl ? "متن سفارشی" : "Custom text"}
          defaultLabel={isRtl ? "متن داخلی سامانه" : "Built-in text"}
          resetDescription={isRtl ? "متن سفارشی حذف و متن داخلی سامانه استفاده می‌شود." : "The custom text is removed and the built-in text is used."}
          savedMessage={isRtl ? "ذخیره شد و بلافاصله اعمال می‌شود." : "Saved; it applies immediately."}
          note={
            template.kind === "otp"
              ? isRtl ? "{code} لازم است. این متن برای ورود همه شرکت‌کنندگان، نمایندگان غرفه و اپراتورها ارسال می‌شود." : "{code} is required. Sent to every attendee, booth representative and desk operator who signs in."
              : isRtl ? "برای همایش‌هایی که برگزارکننده متن اختصاصی تعیین نکرده است." : "Used for congresses whose organizer has not set their own text."
          }
          onSave={async (body) => {
            const { data, error, response } = await client.PUT("/api/platform/sms-templates/{kind}", { params: { path: { kind: template.kind } }, body: { body } });
            checkResponse(response.status);
            return { data, error: error ? formatApiError(error) : undefined };
          }}
          onReset={async () => {
            const { data, error, response } = await client.DELETE("/api/platform/sms-templates/{kind}", { params: { path: { kind: template.kind } } });
            checkResponse(response.status);
            return { data, error: error ? formatApiError(error) : undefined };
          }}
          onTest={async (mobile, body) => {
            const { data, error, response } = await client.POST("/api/platform/sms/test", { body: { mobile, kind: template.kind, body } });
            checkResponse(response.status);
            if (response.status === 429) return { error: isRtl ? "پیامک آزمایشی زیادی ارسال شد." : "Too many test messages; try again later." };
            return { data, error: error ? formatApiError(error) : undefined };
          }}
        />
      ))}

      <ConfirmDialog
        isOpen={confirmKeyReset}
        title={isRtl ? "کلید API ذخیره‌شده حذف شود؟" : "Remove the saved API key?"}
        description={
          isRtl
            ? "اگر فایل .env سرور کلیدی نداشته باشد، ارسال کد ورود و پیامک‌های تأیید برای همهٔ همایش‌ها تا وارد کردن دوبارهٔ کلید متوقف می‌شود."
            : "If the server's .env has no key, sign-in codes and confirmations stop for every congress until a key is entered again."
        }
        confirmLabel={isRtl ? "حذف کلید" : "Remove key"}
        cancelLabel={isRtl ? "انصراف" : "Cancel"}
        tone="danger"
        onCancel={() => setConfirmKeyReset(false)}
        onConfirm={() => {
          setConfirmKeyReset(false);
          void resetToEnvironment("api_key");
        }}
      />
    </div>
  );
}
