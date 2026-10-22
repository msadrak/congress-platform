import { useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { SmsTemplateOut, SmsTestOut } from "../../api/client";
import { formatLocalizedNumber } from "../../lib/i18n";
import { normalizeIranMobile } from "../../lib/mobile";
import { renderSms, smsSize, unknownPlaceholders } from "../../lib/smsText";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Icon } from "../ui/Icon";
import { Field, FormAlert } from "../organizer/WorkspaceUi";

const PLACEHOLDER_LABELS: Record<string, { fa: string; en: string }> = {
  code: { fa: "کد ورود", en: "Sign-in code" },
  minutes: { fa: "دقیقه اعتبار", en: "Minutes valid" },
  name: { fa: "نام شرکت‌کننده", en: "Attendee name" },
  event: { fa: "نام همایش", en: "Congress name" },
  tier: { fa: "رده بلیط", en: "Ticket tier" },
  location: { fa: "محل برگزاری", en: "Venue" },
  link: { fa: "لینک کارت ورود", en: "Pass link" },
};

type Outcome<T> = { data?: T; error?: string };

/** What a failed send means for the person running the platform, from the gateway's error code. */
function sendFailure(error: string, isRtl: boolean): string {
  if (error === "NETWORK") return isRtl ? "سرور به sms.ir دسترسی ندارد (شبکه یا فایروال سرور را بررسی کنید)." : "The server cannot reach sms.ir (check the server's network or firewall).";
  if (error === "TIMEOUT") return isRtl ? "sms.ir پاسخ نداد؛ شاید پیامک ارسال شده باشد." : "sms.ir did not answer in time; the message may or may not have been sent.";
  if (error === "NOT_CONFIGURED") return isRtl ? "درگاه پیامک تنظیم نشده است (کلید API یا شماره خط)." : "The SMS gateway is not configured (API key or line number).";
  if (error === "HTTP_401" || error === "HTTP_403") return isRtl ? "sms.ir کلید API را نپذیرفت." : "sms.ir did not accept the API key.";
  if (error.startsWith("REJECTED")) return isRtl ? `sms.ir پیامک را رد کرد (${error}) — شماره خط، اعتبار یا محتوای پیامک را بررسی کنید.` : `sms.ir refused the message (${error}): check the line number, credit or wording.`;
  return isRtl ? `ارسال انجام نشد (${error}).` : `Not sent (${error}).`;
}

export interface SmsTemplateEditorProps {
  template: SmsTemplateOut;
  sample: Record<string, string>;
  locale: "fa" | "en";
  title: string;
  customLabel: string;
  defaultLabel: string;
  resetDescription: string;
  savedMessage: string;
  note?: ReactNode;
  onSave: (body: string) => Promise<Outcome<SmsTemplateOut>>;
  onReset: () => Promise<Outcome<SmsTemplateOut>>;
  onTest: (mobile: string, body: string) => Promise<Outcome<SmsTestOut>>;
  /** Called after a test send so the caller can refresh its message log. */
  onTested?: () => void;
}

/**
 * Edits one SMS template: placeholder chips inserted at the caret, validation as the API does it, a live
 * preview with sample values and the SMS-part count, save / discard / back to default, and a test send of the
 * current (even unsaved) text. Used by the organizer's SMS page and the platform console.
 */
export function SmsTemplateEditor(props: SmsTemplateEditorProps) {
  const { template, sample, locale, title, customLabel, defaultLabel, resetDescription, savedMessage, note } = props;
  const isRtl = locale === "fa";
  const fmt = (n: number) => formatLocalizedNumber(n, locale);
  const ids = { body: useId(), help: useId(), title: useId() };
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Caret position to restore right after an inserted placeholder renders (before the next keystroke).
  const pendingCaret = useRef<number | null>(null);

  const [saved, setSaved] = useState(template);
  const [draft, setDraft] = useState(template.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [testMobile, setTestMobile] = useState("");
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<SmsTestOut | null>(null);

  const unknown = unknownPlaceholders(draft, saved.placeholders);
  const missing = saved.required.filter((p) => !draft.includes(`{${p}}`));
  const preview = renderSms(draft, sample);
  const size = smsSize(preview);
  const dirty = draft.trim() !== saved.body;
  const valid = draft.trim().length > 0 && unknown.length === 0 && missing.length === 0;

  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    const el = textareaRef.current;
    if (caret === null || !el) return;
    pendingCaret.current = null;
    el.focus();
    el.setSelectionRange(caret, caret);
  }, [draft]);

  const insertPlaceholder = (name: string) => {
    const token = `{${name}}`;
    const el = textareaRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    pendingCaret.current = start + token.length;
    setDraft(draft.slice(0, start) + token + draft.slice(end));
  };

  const apply = async (work: () => Promise<Outcome<SmsTemplateOut>>, message: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const outcome: Outcome<SmsTemplateOut> = await work().catch(() => ({ error: isRtl ? "اتصال به سرور برقرار نشد." : "Could not reach the server." }));
    setBusy(false);
    if (outcome.data) {
      setSaved(outcome.data);
      setDraft(outcome.data.body);
      setNotice(message);
    } else {
      setError(outcome.error ?? (isRtl ? "انجام نشد؛ دوباره تلاش کنید." : "That did not work; please try again."));
    }
  };

  const sendTest = async (e: FormEvent) => {
    e.preventDefault();
    if (testing) return;
    setTestError(null);
    setTestResult(null);
    const mobile = normalizeIranMobile(testMobile);
    if (!mobile) {
      setTestError(isRtl ? "یک شماره موبایل معتبر وارد کنید؛ مثلاً ۰۹۱۲ ۳۴۵ ۶۷۸۹." : "Enter a valid Iranian mobile number, e.g. 0912 345 6789.");
      return;
    }
    if (!valid) {
      setTestError(isRtl ? "ابتدا خطای متن پیامک را برطرف کنید." : "Fix the message text first.");
      return;
    }
    setTesting(true);
    const outcome: Outcome<SmsTestOut> = await props.onTest(mobile, draft).catch(() => ({ error: isRtl ? "اتصال به سرور برقرار نشد." : "Could not reach the server." }));
    setTesting(false);
    if (outcome.data) {
      setTestResult(outcome.data);
      props.onTested?.();
    } else {
      setTestError(outcome.error ?? (isRtl ? "ارسال انجام نشد." : "The test could not be sent."));
    }
  };

  return (
    <section aria-labelledby={ids.title} className="overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-5 py-4 sm:px-6">
        <h2 id={ids.title} className="text-base font-bold text-text-primary">{title}</h2>
        <Badge variant={saved.is_custom ? "brand" : "neutral"} size="sm">{saved.is_custom ? customLabel : defaultLabel}</Badge>
      </div>

      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          {notice && (
            <p role="status" className="flex items-start gap-2.5 rounded-xl border border-status-success-border bg-status-success-bg px-3.5 py-3 text-sm text-status-success-text">
              <Icon name="check-circle" size={18} className="mt-0.5 shrink-0" />
              {notice}
            </p>
          )}
          <div>
            <span className="ui-label">{isRtl ? "افزودن متغیر" : "Insert a placeholder"}</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label={isRtl ? "متغیرها" : "Placeholders"}>
              {saved.placeholders.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => insertPlaceholder(name)}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border-default bg-surface-panel-subtle px-2.5 text-xs font-semibold text-text-secondary hover:border-action-primary hover:text-action-primary focus-visible:outline-2 focus-visible:outline-focus-ring cursor-pointer"
                >
                  <Icon name="plus" size={13} />
                  <span>{PLACEHOLDER_LABELS[name]?.[locale] ?? name}</span>
                  <code dir="ltr" className="font-mono text-[11px] text-text-muted">{`{${name}}`}</code>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor={ids.body} className="ui-label">{isRtl ? "متن پیامک" : "Message text"}</label>
            <textarea
              ref={textareaRef}
              id={ids.body}
              dir="auto"
              rows={6}
              maxLength={1000}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-describedby={ids.help}
              aria-invalid={!valid}
              className="ui-input min-h-36 font-sans leading-relaxed"
            />
            <p id={ids.help} className="mt-1.5 text-xs text-text-muted" data-testid="sms-size">
              {isRtl
                ? `${fmt(size.characters)} نویسه · ${fmt(size.parts)} پیامک (${size.encoding === "unicode" ? "فارسی" : "لاتین"}، ${fmt(size.perPart)} نویسه در هر پیامک)`
                : `${size.characters} characters · ${size.parts} SMS (${size.encoding === "unicode" ? "Persian/Unicode" : "Latin"}, ${size.perPart} per SMS)`}
            </p>
            {unknown.length > 0 && (
              <p role="alert" className="mt-1.5 text-xs font-medium text-status-danger-text">
                {isRtl ? "متغیر ناشناخته: " : "Unknown placeholder: "}
                <bdi dir="ltr">{unknown.map((u) => `{${u}}`).join(", ")}</bdi>
              </p>
            )}
            {missing.length > 0 && (
              <p role="alert" className="mt-1.5 text-xs font-medium text-status-danger-text">
                {isRtl ? "این متغیر لازم است: " : "Required placeholder: "}
                <bdi dir="ltr">{missing.map((u) => `{${u}}`).join(", ")}</bdi>
              </p>
            )}
            {!draft.trim() && (
              <p role="alert" className="mt-1.5 text-xs font-medium text-status-danger-text">
                {isRtl ? "متن پیامک نمی‌تواند خالی باشد." : "The message cannot be empty."}
              </p>
            )}
          </div>

          {error && <FormAlert>{error}</FormAlert>}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="primary" size="md" disabled={!dirty || !valid || busy} onClick={() => void apply(() => props.onSave(draft), savedMessage)}>
              <Icon name="check" size={16} />
              {busy ? "..." : isRtl ? "ذخیره متن" : "Save text"}
            </Button>
            {dirty && (
              <Button type="button" variant="ghost" size="md" disabled={busy} onClick={() => setDraft(saved.body)}>
                {isRtl ? "لغو تغییرات" : "Discard changes"}
              </Button>
            )}
            {saved.is_custom && (
              <Button type="button" variant="secondary" size="md" disabled={busy} onClick={() => setConfirmReset(true)}>
                <Icon name="sync" size={16} />
                {isRtl ? "بازگشت به متن پیش‌فرض" : "Use the default text"}
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <span className="ui-label">{isRtl ? "پیش‌نمایش با نمونه" : "Preview with sample values"}</span>
          <div className="rounded-2xl bg-surface-panel-subtle p-4">
            <p dir="auto" data-testid="sms-preview" className="whitespace-pre-wrap break-words rounded-2xl rounded-ss-sm bg-surface-panel p-3.5 text-sm leading-relaxed text-text-primary shadow-soft">
              {preview || "—"}
            </p>
          </div>
          {note && <div className="text-xs leading-relaxed text-text-muted">{note}</div>}
        </div>
      </div>

      <form onSubmit={sendTest} noValidate className="space-y-3 border-t border-border-subtle bg-surface-panel-subtle/60 px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={isRtl ? "ارسال آزمایشی به شماره" : "Send a test to"} className="min-w-0 flex-1 sm:max-w-xs">
            <input
              type="tel"
              dir="ltr"
              inputMode="tel"
              autoComplete="off"
              placeholder="09xx xxx xxxx"
              value={testMobile}
              onChange={(e) => setTestMobile(e.target.value)}
              className="ui-input font-mono"
            />
          </Field>
          <Button type="submit" variant="secondary" size="md" disabled={testing}>
            <Icon name="phone" size={16} />
            {testing ? "..." : isRtl ? "ارسال پیامک آزمایشی" : "Send test SMS"}
          </Button>
        </div>
        <p className="text-xs text-text-muted">
          {isRtl ? "متن فعلی (حتی ذخیره‌نشده) با مقادیر نمونه ارسال می‌شود." : "Sends the current text (even unsaved) with the sample values."}
        </p>
        {testError && <FormAlert>{testError}</FormAlert>}
        {testResult && (
          <p
            role="status"
            className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm ${
              testResult.status === "sent"
                ? "border-status-success-border bg-status-success-bg text-status-success-text"
                : "border-status-danger-border bg-status-danger-bg text-status-danger-text"
            }`}
          >
            <Icon name={testResult.status === "sent" ? "check-circle" : "alert"} size={18} className="mt-0.5 shrink-0" />
            <span>
              {testResult.status === "sent"
                ? testResult.test_mode
                  ? isRtl ? "حالت آزمایشی: پیامک فقط ثبت شد و به گوشی ارسال نشد." : "Test mode: the message was only recorded; nothing was sent to the phone."
                  : isRtl ? "پیامک آزمایشی از طریق sms.ir ارسال شد." : "Test message sent through sms.ir."
                : sendFailure(testResult.error ?? testResult.status, isRtl)}
            </span>
          </p>
        )}
      </form>

      <ConfirmDialog
        isOpen={confirmReset}
        title={isRtl ? "بازگشت به متن پیش‌فرض؟" : "Use the default text?"}
        description={resetDescription}
        confirmLabel={isRtl ? "بازگشت به پیش‌فرض" : "Use default"}
        cancelLabel={isRtl ? "انصراف" : "Cancel"}
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          void apply(props.onReset, isRtl ? "متن پیش‌فرض بازگردانده شد." : "Back to the default text.");
        }}
      />
    </section>
  );
}
