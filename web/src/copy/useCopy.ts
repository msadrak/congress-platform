import { useLocale, type AttendeeLocale } from "../lib/i18n";

/**
 * The shape every locale of a copy module must have: the Persian module with each string widened to `string`
 * and each function kept with its signature. Typing `en` with it makes a missing or extra key a build error.
 */
export type CopyShape<T> = {
  readonly [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends (...args: infer A) => infer R
      ? (...args: A) => R
      : CopyShape<T[K]>;
};

/** A copy module (`src/copy/<area>.ts`): `{ fa, en }`, written Persian first. */
export interface Copy<T extends CopyShape<T>> {
  readonly fa: T;
  readonly en: CopyShape<T>;
}

/**
 * The strings of a copy module in the app's locale: `const c = useCopy(commonCopy)`. Pass `locale` when the
 * component already has one (a prop, or a page's own language); outside React read `commonCopy[locale]`.
 */
export function useCopy<T extends CopyShape<T>>(copy: Copy<T>, locale?: AttendeeLocale): CopyShape<T> {
  const app = useLocale().locale;
  return copy[locale ?? app];
}
