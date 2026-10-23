import { useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { SmsTemplateOut, SmsTestOut } from "../../api/client";
import { commonCopy } from "../../copy/common";
import { organizerDataCopy } from "../../copy/organizerData";
import { formatNumber } from "../../lib/format";
import { normalizeIranMobile } from "../../lib/mobile";
import { renderSms, smsSize, unknownPlaceholders } from "../../lib/smsText";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Icon } from "../ui/Icon";
import { TextInput } from "../ui/Input";
import { Notice } from "../ui/Notice";
import { Field, FormAlert } from "../organizer/WorkspaceUi";

type Outcome<T> = { data?: T; error?: string };
type EditorCopy = (typeof organizerDataCopy)["fa" | "en"]["smsEditor"];

/** What a failed test send means for the person running the platform, from the gateway's error code. */
function platformFailure(error: string, copy: EditorCopy["platform"]): string {
  if (error === "NETWORK") return copy.network;
  if (error === "TIMEOUT") return copy.timeout;
  if (error === "NOT_CONFIGURED") return copy.notConfigured;
  if (error === "HTTP_401" || error === "HTTP_403") return copy.keyRejected;
  if (error.startsWith("REJECTED")) return copy.rejected(error);
  return copy.other(error);
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
  /** One line under the test-send field (e.g. who may receive a test); replaces the default line. */
  testHint?: string;
  /**
   * `platform` (default) names the gateway (sms.ir) and its error codes; `organizer` never shows gateway
   * details, because only the platform admin can fix them.
   */
  audience?: "organizer" | "platform";
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
  const { template, sample, locale, title, customLabel, defaultLabel, resetDescription, savedMessage, note, testHint, audience = "platform" } = props;
  const copy = organizerDataCopy[locale].smsEditor;
  const common = commonCopy[locale];
  const fmt = (n: number) => formatNumber(n, locale);
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
    const outcome: Outcome<SmsTemplateOut> = await work().catch(() => ({ error: common.network }));
    setBusy(false);
    if (outcome.data) {
      setSaved(outcome.data);
      setDraft(outcome.data.body);
      setNotice(message);
    } else {
      setError(outcome.error ?? common.generic);
    }
  };

  const sendTest = async (e: FormEvent) => {
    e.preventDefault();
    if (testing) return;
    setTestError(null);
    setTestResult(null);
    const mobile = normalizeIranMobile(testMobile);
    if (!mobile) {
      setTestError(common.mobileInvalid);
      return;
    }
    if (!valid) {
      setTestError(copy.fixTextFirst);
      return;
    }
    setTesting(true);
    const outcome: Outcome<SmsTestOut> = await props.onTest(mobile, draft).catch(() => ({ error: common.network }));
    setTesting(false);
    if (outcome.data) {
      setTestResult(outcome.data);
      props.onTested?.();
    } else {
      setTestError(outcome.error ?? copy.testNotSent);
    }
  };

  const testSucceeded = testResult?.status === "sent";
  const testOutcome = !testResult
    ? null
    : testSucceeded
      ? testResult.test_mode
        ? copy.testModeSent
        : audience === "organizer"
          ? copy.testSent
          : copy.platform.testSent
      : audience === "organizer"
        ? copy.organizerFailure
        : platformFailure(testResult.error ?? testResult.status, copy.platform);

  return (
    <section aria-labelledby={ids.title} className="overflow-hidden rounded-card border border-border-default bg-surface-panel shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-5 py-4 sm:px-6">
        <h2 id={ids.title} className="text-title-sm font-bold text-text-primary">{title}</h2>
        <Badge variant={saved.is_custom ? "brand" : "neutral"} size="sm">{saved.is_custom ? customLabel : defaultLabel}</Badge>
      </div>

      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          {notice && <Notice tone="success">{notice}</Notice>}
          <div>
            <span className="ui-label">{copy.insertPlaceholder}</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label={copy.placeholders}>
              {saved.placeholders.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => insertPlaceholder(name)}
                  className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-control border border-border-default bg-surface-panel-subtle px-3 text-caption font-semibold text-text-secondary hover:border-action-primary hover:text-action-primary focus-visible:outline-2 focus-visible:outline-focus-ring"
                >
                  <Icon name="plus" size={13} />
                  <span>{labelOf(name, copy)}</span>
                  <code dir="ltr" className="font-mono text-caption text-text-muted">{`{${name}}`}</code>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor={ids.body} className="ui-label">{copy.messageText}</label>
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
            <p id={ids.help} className={`mt-1.5 text-caption ${size.parts > 1 ? "font-semibold text-status-warning-text" : "text-text-muted"}`} data-testid="sms-size">
              {copy.size(fmt(size.characters), fmt(size.parts))}
            </p>
            {unknown.length > 0 && (
              <p role="alert" className="mt-1.5 text-caption font-medium text-status-danger-text">
                {copy.unknownPlaceholder}
                <bdi dir="ltr">{unknown.map((u) => `{${u}}`).join(", ")}</bdi>
              </p>
            )}
            {missing.length > 0 && (
              <p role="alert" className="mt-1.5 text-caption font-medium text-status-danger-text">
                {copy.requiredPlaceholder}
                <bdi dir="ltr">{missing.map((u) => `{${u}}`).join(", ")}</bdi>
              </p>
            )}
            {!draft.trim() && (
              <p role="alert" className="mt-1.5 text-caption font-medium text-status-danger-text">
                {copy.emptyBody}
              </p>
            )}
          </div>

          {error && <FormAlert>{error}</FormAlert>}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" icon="check" disabled={!dirty || !valid} loading={busy} onClick={() => void apply(() => props.onSave(draft), savedMessage)}>
              {copy.saveText}
            </Button>
            {dirty && (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setDraft(saved.body)}>
                {copy.discard}
              </Button>
            )}
            {saved.is_custom && (
              <Button type="button" variant="secondary" icon="sync" disabled={busy} onClick={() => setConfirmReset(true)}>
                {copy.useDefault}
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <span className="ui-label">{copy.preview}</span>
          <div className="rounded-card bg-surface-panel-subtle p-4">
            <p dir="auto" data-testid="sms-preview" className="whitespace-pre-wrap break-words rounded-card rounded-ss-sm bg-surface-panel p-3.5 text-body-sm leading-relaxed text-text-primary shadow-soft">
              {preview || "—"}
            </p>
          </div>
          {note && <div className="text-caption leading-relaxed text-text-muted">{note}</div>}
        </div>
      </div>

      <form onSubmit={sendTest} noValidate className="space-y-3 border-t border-border-subtle bg-surface-panel-subtle/60 px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={copy.testTo} className="min-w-0 flex-1 sm:max-w-sm">
            <TextInput type="tel" dir="ltr" inputMode="tel" autoComplete="off" placeholder="09xx xxx xxxx" value={testMobile} onChange={(e) => setTestMobile(e.target.value)} />
          </Field>
          <Button type="submit" variant="secondary" icon="phone" loading={testing}>
            {copy.sendTest}
          </Button>
        </div>
        <p className="text-caption text-text-muted">{testHint ?? copy.testUsesDraft}</p>
        {testError && <FormAlert>{testError}</FormAlert>}
        {testOutcome && <Notice tone={testSucceeded ? "success" : "danger"}>{testOutcome}</Notice>}
      </form>

      <ConfirmDialog
        isOpen={confirmReset}
        title={copy.resetTitle}
        description={resetDescription}
        confirmLabel={copy.resetConfirm}
        cancelLabel={common.cancel}
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          void apply(props.onReset, copy.resetDone);
        }}
      />
    </section>
  );
}

/** A placeholder's name for people; an unknown one shows as itself. */
function labelOf(name: string, copy: EditorCopy): string {
  const labels: Record<string, string> = copy.placeholderLabels;
  return labels[name] ?? name;
}
