import { hasPersian } from "./copy";

/**
 * Organizer-written text (congress, booth, tier names) can be in either language regardless of the page
 * language. Isolating it keeps its own direction, punctuation order and typeface while the surrounding
 * line keeps the page alignment.
 */
export function Bidi({ text }: { text: string }) {
  const fa = hasPersian(text);
  return (
    <bdi dir={fa ? "rtl" : "ltr"} lang={fa ? "fa" : "en"}>
      {text}
    </bdi>
  );
}
