const HONORIFICS: Record<string, true> = { "دکتر": true, "مهندس": true, "استاد": true, "پروفسور": true };

/** Up to two initials, skipping honorifics such as "Dr." / «دکتر». Persian initials are kept unjoined. */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => w && !w.endsWith(".") && !Object.hasOwn(HONORIFICS, w));
  const source = words.length > 0 ? words : name.trim().split(/\s+/).filter(Boolean);
  const letters = source.slice(0, 2).map((w) => Array.from(w)[0]?.toLocaleUpperCase() ?? "");
  if (letters.length === 0 || !letters[0]) return "?";
  // ZWNJ stops two Arabic-script letters from joining into a ligature.
  return letters.join(/[؀-ۿ]/.test(letters.join("")) ? "‌" : "");
}
