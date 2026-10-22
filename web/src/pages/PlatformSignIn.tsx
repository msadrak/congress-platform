import { useState, type FormEvent } from "react";
import { formatApiError, type SignInOut } from "../api/client";
import { asciiDigits } from "../lib/mobile";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { Field, FormAlert, SectionHeader } from "../components/organizer/WorkspaceUi";
import { usePlatform } from "./platformContext";

type RuleField =
  | "otp_length"
  | "otp_ttl_seconds"
  | "otp_resend_cooldown_seconds"
  | "otp_sends_per_mobile_per_hour"
  | "otp_sends_per_ip_per_hour";

const FIELDS: { key: RuleField; min: number; max: number; fa: string; en: string; hintFa: string; hintEn: string }[] = [
  { key: "otp_length", min: 4, max: 8, fa: "تعداد رقم کد", en: "Code digits", hintFa: "۴ تا ۸", hintEn: "4 to 8" },
  { key: "otp_ttl_seconds", min: 60, max: 600, fa: "مدت اعتبار کد (ثانیه)", en: "Code valid for (seconds)", hintFa: "۶۰ تا ۶۰۰", hintEn: "60 to 600" },
  { key: "otp_resend_cooldown_seconds", min: 0, max: 600, fa: "فاصله ارسال دوباره (ثانیه)", en: "Wait before a new code (seconds)", hintFa: "در محیط اصلی دست‌کم ۳۰", hintEn: "at least 30 in production" },
  { key: "otp_sends_per_mobile_per_hour", min: 1, max: 50, fa: "حداکثر کد برای هر شماره در ساعت", en: "Codes per number per hour", hintFa: "۱ تا ۵۰", hintEn: "1 to 50" },
  { key: "otp_sends_per_ip_per_hour", min: 1, max: 100000, fa: "حداکثر کد از هر نشانی شبکه در ساعت", en: "Codes per network address per hour", hintFa: "در محل همایش، شرکت‌کنندگان زیادی پشت یک نشانی هستند", hintEn: "many attendees share one address at a venue" },
];

/** Sign-in code rules (length, validity, send limits), applied immediately to new codes. */
export default function PlatformSignIn() {
  const { client, status, refreshStatus, checkResponse, isRtl } = usePlatform();
  const [rules, setRules] = useState<SignInOut>(status.sign_in);
  const [values, setValues] = useState<Record<RuleField, string>>(() =>
    Object.fromEntries(FIELDS.map((f) => [f.key, String(status.sign_in[f.key])])) as Record<RuleField, string>,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const parsed = (key: RuleField) => {
    const digits = asciiDigits(values[key].trim());
    return /^\d+$/.test(digits) ? Number(digits) : NaN;
  };
  const invalid = FIELDS.filter((f) => {
    const n = parsed(f.key);
    return Number.isNaN(n) || n < f.min || n > f.max;
  }).map((f) => f.key);

  const apply = (data: SignInOut) => {
    setRules(data);
    setValues(Object.fromEntries(FIELDS.map((f) => [f.key, String(data[f.key])])) as Record<RuleField, string>);
    void refreshStatus();
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (saving || invalid.length) return;
    setSaving(true);
    setError(null);
    setSaved(null);
    const changed = Object.fromEntries(FIELDS.filter((f) => parsed(f.key) !== rules[f.key]).map((f) => [f.key, parsed(f.key)]));
    const { data, error: err, response } = await client.PUT("/api/platform/sign-in", { body: { ...changed, reset: [] } });
    checkResponse(response.status);
    setSaving(false);
    if (data) {
      apply(data);
      setSaved(isRtl ? "ذخیره و اعمال شد." : "Saved and applied.");
    } else {
      setError(err ? formatApiError(err) : isRtl ? "ذخیره نشد." : "Not saved.");
    }
  };

  const reset = async (key: RuleField) => {
    if (resetting) return;
    setResetting(true);
    setError(null);
    setSaved(null);
    try {
      const { data, error: err, response } = await client.PUT("/api/platform/sign-in", { body: { reset: [key] } });
      checkResponse(response.status);
      if (data) {
        apply(data);
        const field = FIELDS.find((f) => f.key === key);
        setSaved(isRtl ? `«${field?.fa ?? key}» اکنون از مقدار .env پیروی می‌کند.` : `“${field?.en ?? key}” now follows the .env value.`);
      } else {
        setError(err ? formatApiError(err) : isRtl ? "تغییری اعمال نشد." : "Nothing was changed.");
      }
    } catch {
      setError(isRtl ? "اتصال به سرور برقرار نشد." : "Could not reach the server.");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow={isRtl ? "پنل مدیریت سامانه" : "Platform console"}
        title={isRtl ? "قواعد ورود با پیامک" : "SMS sign-in rules"}
        description={isRtl ? "برای کدهای جدید بلافاصله اعمال می‌شود." : "Applies immediately to new codes."}
      />
      <form onSubmit={save} noValidate className="space-y-5 rounded-2xl border border-border-default bg-surface-panel p-5 shadow-soft sm:p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <Field
              key={f.key}
              label={isRtl ? f.fa : f.en}
              hint={
                <span className="flex flex-wrap items-center gap-2">
                  <span>{isRtl ? f.hintFa : f.hintEn}</span>
                  <span>· {rules.sources[f.key] === "console" ? (isRtl ? "از این پنل" : "set here") : isRtl ? "از فایل .env" : "from .env"}</span>
                  {rules.sources[f.key] === "console" && (
                    <button type="button" disabled={resetting} aria-busy={resetting} onClick={() => void reset(f.key)} className="font-semibold text-action-primary hover:underline cursor-pointer disabled:cursor-wait disabled:opacity-60">
                      {isRtl ? "مقدار .env" : "Use .env"}
                    </button>
                  )}
                </span>
              }
            >
              <input
                type="text"
                dir="ltr"
                inputMode="numeric"
                value={values[f.key]}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                aria-invalid={invalid.includes(f.key)}
                className="ui-input font-mono"
              />
            </Field>
          ))}
        </div>
        {invalid.length > 0 && <FormAlert>{isRtl ? "برخی مقدارها خارج از بازه مجاز است." : "Some values are outside the allowed range."}</FormAlert>}
        {error && <FormAlert>{error}</FormAlert>}
        {saved && <p role="status" className="text-sm font-medium text-status-success-text">{saved}</p>}
        <Button type="submit" variant="primary" size="md" disabled={saving || invalid.length > 0} aria-busy={saving}>
          <Icon name="check" size={16} />
          {saving ? (isRtl ? "در حال ذخیره…" : "Saving…") : isRtl ? "ذخیره قواعد" : "Save rules"}
        </Button>
      </form>
    </div>
  );
}
