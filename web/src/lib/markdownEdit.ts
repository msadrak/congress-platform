/**
 * The Page Studio text toolbar: each action turns the textarea's value and selection into the next value and
 * selection, writing the Markdown-lite syntax of `markdownLite.ts`. Pure, so it is tested without a DOM.
 * Applying an inline style or a line prefix a second time removes it again (a toggle, like a word processor).
 */
export type FormatAction = "bold" | "italic" | "highlight" | "heading" | "subheading" | "bullets" | "numbered" | "quote" | "divider" | "link";

export interface TextEdit {
  value: string;
  start: number;
  end: number;
}

const WRAP: Partial<Record<FormatAction, string>> = { bold: "**", italic: "*", highlight: "==" };
const PREFIX: Partial<Record<FormatAction, RegExp>> = {
  heading: /^## /,
  subheading: /^### /,
  bullets: /^- /,
  numbered: /^[0-9۰-۹]+[.)] /,
  quote: /^> /,
};
/** Any block prefix, so switching a bullet line to a heading replaces the bullet instead of stacking. */
const ANY_PREFIX = /^(?:#{1,3} |[-•*] |[0-9۰-۹]+[.)] |> )/;

function wrap(edit: TextEdit, marker: string, placeholder: string): TextEdit {
  const { value, start, end } = edit;
  const before = value.slice(0, start);
  const after = value.slice(end);
  if (before.endsWith(marker) && after.startsWith(marker) && !(marker === "*" && before.endsWith("**") && after.startsWith("**"))) {
    return { value: before.slice(0, -marker.length) + value.slice(start, end) + after.slice(marker.length), start: start - marker.length, end: end - marker.length };
  }
  const selected = value.slice(start, end);
  // Keep surrounding spaces outside the markers: "**word **" would not parse.
  const lead = selected.match(/^\s*/)?.[0] ?? "";
  const trail = selected.match(/\s*$/)?.[0] ?? "";
  const core = selected.trim() || placeholder;
  const inner = `${marker}${core}${marker}`;
  const at = start + lead.length + marker.length;
  return { value: `${before}${lead}${inner}${selected.trim() ? trail : ""}${after}`, start: at, end: at + core.length };
}

function prefixLines(edit: TextEdit, action: FormatAction): TextEdit {
  const { value, start, end } = edit;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = value.indexOf("\n", end > start && value[end - 1] === "\n" ? end - 1 : end);
  const lineEnd = nextBreak < 0 ? value.length : nextBreak;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const own = PREFIX[action] as RegExp;
  const filled = lines.filter((line) => line.trim());
  const remove = filled.length > 0 && filled.every((line) => own.test(line));
  let n = 0;
  const next = lines.map((line) => {
    if (!line.trim()) return line;
    const bare = line.replace(ANY_PREFIX, "");
    if (remove) return bare;
    n += 1;
    const prefix = action === "heading" ? "## " : action === "subheading" ? "### " : action === "bullets" ? "- " : action === "numbered" ? `${n}. ` : "> ";
    return prefix + bare;
  });
  const block = next.join("\n");
  return { value: value.slice(0, lineStart) + block + value.slice(lineEnd), start: lineStart, end: lineStart + block.length };
}

export function applyFormat(edit: TextEdit, action: FormatAction, placeholder: string): TextEdit {
  const marker = WRAP[action];
  if (marker) return wrap(edit, marker, placeholder);
  if (PREFIX[action]) return prefixLines(edit, action);
  const { value, start, end } = edit;
  const before = value.slice(0, start);
  const after = value.slice(end);
  if (action === "divider") {
    // A divider is its own paragraph: blank lines around it, without piling up existing ones.
    const lead = before.length === 0 ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const trail = after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
    const inserted = `${lead}---${trail}`;
    const caret = start + inserted.length;
    return { value: before + inserted + after, start: caret, end: caret };
  }
  // link: [text](https://) with the address part selected, ready to paste over.
  const text = value.slice(start, end).trim() || placeholder;
  const link = `[${text}](https://)`;
  const urlAt = start + text.length + 3;
  return { value: before + link + after, start: urlAt, end: urlAt + "https://".length };
}
