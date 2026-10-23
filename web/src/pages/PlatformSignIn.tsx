import { useState, type FormEvent } from "react";
import { localizedApiError, type SignInOut } from "../api/client";
import { codeFontClass } from "../lib/format";
import { asciiDigits } from "../lib/mobile";
import { useMutation } from "../hooks/useMutation";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Field";
import { TextInput, Textarea } from "../components/ui/Input";
import { Notice } from "../components/ui/Notice";
import { PageHeader } from "../components/ui/PageHeader";
import { PlatformSource } from "./PlatformSource";
import { usePlatform } from "./platformContext";

type RuleField =
  | "otp_length"
  | "otp_ttl_seconds"
  | "otp_resend_cooldown_seconds"
  | "otp_sends_per_mobile_per_hour"
  | "otp_sends_per_ip_per_hour"
  | "otp_sends_per_trusted_ip_per_hour";

const FIELDS: readonly { key: RuleField; min: number; max: number }[] = [
  { key: "otp_length", min: 4, max: 8 },
  { key: "otp_ttl_seconds", min: 60, max: 600 },
  { key: "otp_resend_cooldown_seconds", min: 0, max: 600 },
  { key: "otp_sends_per_mobile_per_hour", min: 1, max: 50 },
  { key: "otp_sends_per_ip_per_hour", min: 1, max: 100000 },
  { key: "otp_sends_per_trusted_ip_per_hour", min: 1, max: 100000 },
];

/** "10.0.0.0/8, 192.0.2.7" or one per line → the list the API takes. */
const networkList = (text: string) =>
  text
    .split(/[\s,،]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const valuesOf = (rules: SignInOut) => Object.fromEntries(FIELDS.map((f) => [f.key, String(rules[f.key])])) as Record<RuleField, string>;

/** Sign-in code rules (length, validity, send limits, venue networks), applied immediately to new codes. */
export default function PlatformSignIn() {
  const { client, status, refreshStatus, locale, copy } = usePlatform();
  const c = copy.signIn;
  const [rules, setRules] = useState<SignInOut>(status.sign_in);
  const [values, setValues] = useState<Record<RuleField, string>>(() => valuesOf(status.sign_in));
  const [networks, setNetworks] = useState(() => status.sign_in.otp_trusted_networks.join("\n"));
  // Each request ends its own spinner whatever happens (useMutation).
  const request = useMutation(locale);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const shownError = error ?? request.error;

  const parsed = (key: RuleField) => {
    const digits = asciiDigits(values[key].trim());
    return /^\d+$/.test(digits) ? Number(digits) : NaN;
  };
  const invalid = FIELDS.filter((f) => {
    const n = parsed(f.key);
    return Number.isNaN(n) || n < f.min || n > f.max;
  }).map((f) => f.key);

  const send = async (body: Record<string, unknown> & { reset: (RuleField | "otp_trusted_networks")[] }, message: string) => {
    setError(null);
    setSaved(null);
    const result = await request.run(() => client.PUT("/api/platform/sign-in", { body }));
    if (!result.ok) return;
    const { data, error: err, response } = result.value;
    if (!data) return setError(localizedApiError(err, locale, response.status));
    setRules(data);
    setValues(valuesOf(data));
    setNetworks(data.otp_trusted_networks.join("\n"));
    setSaved(message);
    void refreshStatus();
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (request.busy || invalid.length) return;
    const changed = Object.fromEntries(FIELDS.filter((f) => parsed(f.key) !== rules[f.key]).map((f) => [f.key, parsed(f.key)]));
    const list = networkList(networks);
    const networksChanged = list.join(",") !== rules.otp_trusted_networks.join(",");
    void send({ ...changed, ...(networksChanged ? { otp_trusted_networks: list } : {}), reset: [] }, c.saved);
  };

  const reset = (key: RuleField | "otp_trusted_networks") => {
    if (request.busy) return;
    const name = key === "otp_trusted_networks" ? c.networks : c.fields[key].label;
    void send({ reset: [key] }, copy.source.reset(name));
  };

  return (
    <div className="space-y-6">
      <PageHeader title={c.title} />
      <form onSubmit={save} noValidate className="space-y-5 rounded-card border border-border-default bg-surface-panel p-4 shadow-soft sm:p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1">
              <Field label={c.fields[f.key].label} hint={c.fields[f.key].hint}>
                <TextInput
                  dir="ltr"
                  inputMode="numeric"
                  value={values[f.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  aria-invalid={invalid.includes(f.key)}
                  className={codeFontClass(values[f.key])}
                />
              </Field>
              <PlatformSource source={rules.sources[f.key] as "console" | "environment" | undefined} busy={request.busy} onReset={() => reset(f.key)} />
            </div>
          ))}
        </div>
        <div className="space-y-1">
          <Field label={c.networks} hint={c.networksHint}>
            <Textarea dir="ltr" rows={3} spellCheck={false} value={networks} onChange={(e) => setNetworks(e.target.value)} className="font-mono" data-testid="trusted-networks" />
          </Field>
          <PlatformSource
            source={rules.sources.otp_trusted_networks as "console" | "environment" | undefined}
            busy={request.busy}
            onReset={() => reset("otp_trusted_networks")}
          />
        </div>
        {invalid.length > 0 && <Notice tone="danger">{c.outOfRange}</Notice>}
        {shownError && <Notice tone="danger">{shownError}</Notice>}
        {saved && <Notice tone="success">{saved}</Notice>}
        <Button type="submit" variant="primary" icon="check" loading={request.busy} disabled={invalid.length > 0}>
          {c.save}
        </Button>
      </form>
    </div>
  );
}
