import { useId, useState, type ReactNode } from "react";
import {
  dateDraft,
  describeWallValue,
  draftValue,
  GREGORIAN_MONTHS,
  JALALI_MONTHS,
  latinDigits,
  localeDigits,
  parseTimeOfDay,
  type DateDraft,
  type Locale,
} from "../../lib/format";
import { dateFieldCopy } from "../../copy/dateField";

/**
 * Date entry in the reader's calendar (ds §4, T9): a Jalali day, month and year with Persian digits in fa, a
 * Gregorian one in en, plus a 24 h time for `DateTimeField`. The value in and out is the `datetime-local`
 * string the forms already keep ("2026-11-10T08:30"; "2026-11-10" for `DateField`): a reading of the congress's
 * clock, `timeZone`. It is "" while the entry is incomplete or not a real date, as a native input reports.
 * Native selects and text inputs, so it works with the keyboard and screen readers as they are.
 */
export interface DateFieldProps {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  locale: Locale;
  /** The congress's IANA zone: named in the read-out line under the field. */
  timeZone?: string | null;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
/** `.ui-select` has no invalid look of its own yet (`.ui-input` does). */
const SELECT_INVALID = "aria-invalid:border-status-danger-solid";

function CalendarField({ withTime, label, value, onChange, locale, timeZone, hint, error, required, disabled, className = "" }: DateFieldProps & { withTime: boolean }) {
  const id = useId();
  const copy = dateFieldCopy[locale];
  const [draft, setDraft] = useState<DateDraft>(() => dateDraft(value, locale));
  const [synced, setSynced] = useState({ value, locale });
  // An impossible date or time is pointed out once a choice is made or the reader leaves the box, not mid-typing.
  const [checked, setChecked] = useState(false);
  // A new value from the form (a reset, another record) or a language switch replaces what was typed.
  if (synced.value !== value || synced.locale !== locale) {
    setSynced({ value, locale });
    if (synced.locale !== locale || value !== draftValue(draft, locale, withTime)) setDraft(dateDraft(value, locale));
  }

  const update = (patch: Partial<DateDraft>, check: boolean) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    setChecked(check);
    const nextValue = draftValue(next, locale, withTime);
    if (nextValue !== value) onChange(nextValue);
  };

  const complete = draft.year.length === 4 && draft.month > 0 && draft.day > 0 && (!withTime || draft.time !== "");
  const current = draftValue(draft, locale, withTime);
  const timeInvalid = withTime && draft.time !== "" && parseTimeOfDay(draft.time) === null;
  const readout = current ? describeWallValue(current, locale, timeZone) : complete && checked ? (timeInvalid ? copy.invalidTime : copy.invalidDate) : "";
  const describedBy = [`${id}-readout`, hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ");
  const invalid = error ? true : undefined;
  const control = { "aria-describedby": describedBy, "aria-invalid": invalid, "aria-required": required || undefined };
  const months = locale === "fa" ? JALALI_MONTHS : GREGORIAN_MONTHS;

  return (
    <fieldset className={className} disabled={disabled}>
      <legend className="ui-label">
        {label}
        {required && (
          <span aria-hidden="true" className="ms-1 text-status-danger-solid">
            *
          </span>
        )}
      </legend>
      <div className="flex flex-wrap gap-2">
        <select
          {...control}
          aria-label={copy.day}
          className={`ui-select w-20 ${SELECT_INVALID}`}
          value={draft.day || ""}
          onChange={(e) => update({ day: Number(e.target.value) }, true)}
        >
          <option value="">{copy.day}</option>
          {DAYS.map((day) => (
            <option key={day} value={day}>
              {localeDigits(String(day), locale)}
            </option>
          ))}
        </select>
        <select
          {...control}
          aria-label={copy.month}
          className={`ui-select min-w-0 flex-1 basis-32 ${SELECT_INVALID}`}
          value={draft.month || ""}
          onChange={(e) => update({ month: Number(e.target.value) }, true)}
        >
          <option value="">{copy.month}</option>
          {months.map((name, index) => (
            <option key={name} value={index + 1}>
              {name}
            </option>
          ))}
        </select>
        <input
          {...control}
          aria-label={copy.year}
          className="ui-input tabular w-24 text-center"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          placeholder={copy.year}
          value={localeDigits(draft.year, locale)}
          onChange={(e) => update({ year: latinDigits(e.target.value).replace(/\D/g, "").slice(0, 4) }, false)}
          onBlur={() => setChecked(true)}
        />
        {withTime && (
          <input
            {...control}
            aria-label={copy.time}
            className="ui-input tabular w-24 text-center"
            dir="ltr"
            inputMode="numeric"
            autoComplete="off"
            maxLength={5}
            placeholder={localeDigits("08:30", locale)}
            value={localeDigits(draft.time, locale)}
            onChange={(e) => update({ time: latinDigits(e.target.value).replace(/[^\d:]/g, "").slice(0, 5) }, false)}
            onBlur={() => {
              const time = parseTimeOfDay(draft.time);
              if (time && time !== draft.time) update({ time }, true);
              else setChecked(true);
            }}
          />
        )}
      </div>
      <p id={`${id}-readout`} aria-live="polite" className="mt-1.5 min-h-5 text-xs leading-relaxed text-text-secondary">
        {readout}
      </p>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs leading-relaxed text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium leading-relaxed text-status-danger-text">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** A date and a 24 h time on the congress's clock: value "YYYY-MM-DDTHH:MM". */
export function DateTimeField(props: DateFieldProps) {
  return <CalendarField {...props} withTime />;
}

/** A date alone: value "YYYY-MM-DD". */
export function DateField(props: DateFieldProps) {
  return <CalendarField {...props} withTime={false} />;
}
