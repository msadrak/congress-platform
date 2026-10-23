import { useState, type FormEvent } from "react";
import { formatApiError, localizedApiError, type SignInOut } from "../api/client";
import { asciiDigits } from "../lib/mobile";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { Field, FormAlert, SectionHeader } from "../components/organizer/WorkspaceUi";
import { useMutation } from "../hooks/useMutation";
import { usePlatform } from "./platformContext";

type RuleField =
  | "otp_length"
  | "otp_ttl_seconds"
  | "otp_resend_cooldown_seconds"
  | "otp_sends_per_mobile_per_hour"
  | "otp_sends_per_ip_per_hour"
  | "otp_sends_per_trusted_ip_per_hour";

const FIELDS: { key: RuleField; min: number; max: number; fa: string; en: string; hintFa: string; hintEn: string }[] = [
  { key: "otp_length", min: 4, max: 8, fa: "تعداد رقم کد", en: "Code digits", hintFa: "۴ تا ۸", hintEn: "4 to 8" },
  { key: "otp_ttl_seconds", min: 60, max: 600, fa: "مدت اعتبار کد (ثانیه)", en: "Code valid for (seconds)", hintFa: "۶۰ تا ۶۰۰", hintEn: "60 to 600" },
  { key: "otp_resend_cooldown_seconds", min: 0, max: 600, fa: "فاصله ارسال دوباره (ثانیه)", en: "Wait before a new code (seconds)", hintFa: "در محیط اصلی دست‌کم ۳۰", hintEn: "at least 30 in production" },
  { key: "otp_sends_per_mobile_per_hour", min: 1, max: 50, fa: "حداکثر کد برای هر شماره در ساعت", en: "Codes per number per hour", hintFa: "۱ تا ۵۰", hintEn: "1 to 50" },
  { key: "otp_sends_per_ip_per_hour", min: 1, max: 100000, fa: "حداکثر کد از هر نشانی شبکه در ساعت", en: "Codes per network address per hour", hintFa: "نشانی‌های IPv6 به‌ازای هر ‎/64‎ شمرده می‌شوند", hintEn: "IPv6 addresses count per /64" },
  { key: "otp_sends_per_trusted_ip_per_hour", min: 1, max: 100000, fa: "حداکثر کد از هر نشانی شبکهٔ محل همایش در ساعت", en: "Codes per venue network address per hour", hintFa: "در محل همایش، شرکت‌کنندگان زیادی پشت یک نشانی هستند", hintEn: "many attendees share one address at a venue" },
];

/** "10.0.0.0/8, 192.0.2.7" or one per line → the list the API takes. */
const networkList = (text: string) =>
  text
    .split(/[\s,،]+/)
    .map((item) => item.trim())
    .filter(Boolean);

/** Sign-in code rules (length, validity, send limits), applied immediately to new codes. */
export default function PlatformSignIn() {
  const { client, status, refreshStatus, checkResponse, locale, isRtl } = usePlatform();
  const [rules, setRules] = useState<SignInOut>(status.sign_in);
  const [values, setValues] = useState<Record<RuleField, string>>(() =>
    Object.fromEntries(FIELDS.map((f) => [f.key, String(status.sign_in[f.key])])) as Record<RuleField, string>,
  );
  const [networks, setNetworks] = useState(() => status.sign_in.otp_trusted_networks.join("\n"));
  // Each request ends its own spinner whatever happens (useMutation); a network failure is its error.
  const saveRequest = useMutation(locale);
  const resetRequest = useMutation(locale);
  const saving = saveRequest.busy;
  const resetting = resetRequest.busy;
  /** An HTTP failure's message; network failures live in the mutations. */
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const shownError = error ?? saveRequest.error ?? resetRequest.error;
  const clearMessages = () => {
    setError(null);
    setSaved(null);
    saveRequest.setError(null);
    resetRequest.setError(null);
  };

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
    setNetworks(data.otp_trusted_networks.join("\n"));
    void refreshStatus();
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (saving || invalid.length) return;
    clearMessages();
    const changed = Object.fromEntries(FIELDS.filter((f) => parsed(f.key) !== rules[f.key]).map((f) => [f.key, parsed(f.key)]));
    const list = networkList(networks);
    const networksChanged = list.join(",") !== rules.otp_trusted_networks.join(",");
    const body = { ...changed, ...(networksChanged ? { otp_trusted_networks: list } : {}), reset: [] };
    const result = await saveRequest.run(() => client.PUT("/api/platform/sign-in", { body }));
    if (!result.ok) return;
    const { data, error: err, response } = result.value;
    checkResponse(response.status);
    if (data) {
      apply(data);
      setSaved(isRtl ? "ذخیره و اعمال شد." : "Saved and applied.");
    } else {
      setError(err ? localizedApiError(err, locale) : isRtl ? "ذخیره نشد." : "Not saved.");
    }
  };

  const reset = async (key: RuleField | "otp_trusted_networks") => {
    if (resetting) return;
    clearMessages();
    const result = await resetRequest.run(() => client.PUT("/api/platform/sign-in", { body: { reset: [key] } }));
    if (!result.ok) return;
    const { data, error: err, response } = result.value;
    checkResponse(response.status);
    if (data) {
      apply(data);
      const field = FIELDS.find((f) => f.key === key);
      const name = key === "otp_trusted_networks" ? (isRtl ? "شبکه‌های محل همایش" : "Venue networks") : isRtl ? field?.fa : field?.en;
      setSaved(isRtl ? `«${name ?? key}» اکنون از مقدار .env پیروی می‌کند.` : `“${name ?? key}” now follows the .env value.`);
    } else {
      setError(err ? formatApiError(err) : isRtl ? "تغییری اعمال نشد." : "Nothing was changed.");
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
        <Field
          label={isRtl ? "شبکه‌های محل همایش (Wi-Fi)" : "Venue networks (Wi-Fi)"}
          hint={
            <span className="flex flex-wrap items-center gap-2">
              <span>
                {isRtl
                  ? "نشانی یا CIDR، هر کدام در یک سطر؛ مثلاً 203.0.113.0/24. این نشانی‌ها سقف جداگانهٔ بالا را دارند."
                  : "Addresses or CIDRs, one per line, e.g. 203.0.113.0/24. These get the venue budget above."}
              </span>
              <span>· {rules.sources.otp_trusted_networks === "console" ? (isRtl ? "از این پنل" : "set here") : isRtl ? "از فایل .env" : "from .env"}</span>
              {rules.sources.otp_trusted_networks === "console" && (
                <button type="button" disabled={resetting} aria-busy={resetting} onClick={() => void reset("otp_trusted_networks")} className="font-semibold text-action-primary hover:underline cursor-pointer disabled:cursor-wait disabled:opacity-60">
                  {isRtl ? "مقدار .env" : "Use .env"}
                </button>
              )}
            </span>
          }
        >
          <textarea
            dir="ltr"
            rows={3}
            spellCheck={false}
            value={networks}
            onChange={(e) => setNetworks(e.target.value)}
            className="ui-input font-mono"
            data-testid="trusted-networks"
          />
        </Field>
        {invalid.length > 0 && <FormAlert>{isRtl ? "برخی مقدارها خارج از بازه مجاز است." : "Some values are outside the allowed range."}</FormAlert>}
        {shownError && <FormAlert>{shownError}</FormAlert>}
        {saved && <p role="status" className="text-sm font-medium text-status-success-text">{saved}</p>}
        <Button type="submit" variant="primary" size="md" disabled={saving || invalid.length > 0} aria-busy={saving}>
          <Icon name="check" size={16} />
          {saving ? (isRtl ? "در حال ذخیره…" : "Saving…") : isRtl ? "ذخیره قواعد" : "Save rules"}
        </Button>
      </form>
    </div>
  );
}
