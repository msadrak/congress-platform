/**
 * The small Markdown subset organizers can use in long texts, parsed to plain data that React renders
 * as text nodes. No HTML ever passes through: `<b>` stays the five characters `<b>`.
 *
 *   blank line   → new paragraph            "- " or "• " → bullet item       "1. " → numbered item
 *   "## " / "### " → heading / subheading    "> " → quote                     "---" → divider
 *   **bold**     → strong                   *italic* → emphasis              ==marked== → accent highlight
 *   [label](https://… | mailto:… | tel:…) → link
 *
 * The Page Studio toolbar writes exactly this syntax, so organizers never have to learn it.
 */
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "mark"; text: string }
  | { kind: "link"; text: string; href: string };
export type Block =
  | { kind: "paragraph"; lines: Inline[][] }
  | { kind: "list"; items: Inline[][] }
  | { kind: "ordered"; start: number; items: Inline[][] }
  | { kind: "heading"; level: 3 | 4; text: Inline[] }
  | { kind: "quote"; lines: Inline[][] }
  | { kind: "divider" };

const BULLET = /^\s*(?:[-•*])\s+(.*)$/;
const ORDERED = /^\s*([0-9۰-۹]{1,3})[.)]\s+(.*)$/;
const HEADING = /^\s*(#{1,3})\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const DIVIDER = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const TOKEN = /\*\*(.+?)\*\*|==(.+?)==|\*([^*\s](?:[^*\n]*?[^*\s])?)\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

/** http(s) with a host, or a mailto:/tel: address; anything else (javascript:, data: …) is refused. */
export function safeHref(raw: string): string | null {
  if (/^mailto:[^@\s/?#]+@[^@\s/?#]+\.[^@\s/?#]+$/i.test(raw)) return raw;
  if (/^tel:\+?[0-9][0-9()-]{2,30}$/i.test(raw)) return raw;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const push = (text: string) => {
    if (!text) return;
    const prev = out[out.length - 1];
    if (prev?.kind === "text") prev.text += text;
    else out.push({ kind: "text", text });
  };
  for (const match of line.matchAll(TOKEN)) {
    push(line.slice(last, match.index));
    if (match[1] !== undefined) {
      out.push({ kind: "strong", text: match[1] });
    } else if (match[2] !== undefined) {
      out.push({ kind: "mark", text: match[2] });
    } else if (match[3] !== undefined) {
      out.push({ kind: "em", text: match[3] });
    } else {
      const href = safeHref(match[5]);
      if (href) out.push({ kind: "link", text: match[4], href });
      else push(match[0]);
    }
    last = (match.index ?? 0) + match[0].length;
  }
  push(line.slice(last));
  return out;
}

const latinNumber = (digits: string) => Number(digits.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)));

type Collecting = Exclude<Block, { kind: "heading" } | { kind: "divider" }>;

export function parseMarkdownLite(source: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of source.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const lines = chunk.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;
    // The block being collected: consecutive lines of one kind belong together. (Typed through the
    // initialiser so the compiler does not narrow it to null: `flush` resets it from a closure.)
    let open = null as Collecting | null;
    const flush = () => {
      if (open) blocks.push(open);
      open = null;
    };
    for (const line of lines) {
      let m: RegExpExecArray | null;
      if (DIVIDER.test(line)) {
        flush();
        blocks.push({ kind: "divider" });
      } else if ((m = HEADING.exec(line))) {
        flush();
        blocks.push({ kind: "heading", level: m[1].length === 3 ? 4 : 3, text: parseInline(m[2].trim()) });
      } else if ((m = QUOTE.exec(line))) {
        if (open?.kind !== "quote") flush();
        open ??= { kind: "quote", lines: [] };
        if (open.kind === "quote") open.lines.push(parseInline(m[1].trim()));
      } else if ((m = ORDERED.exec(line))) {
        if (open?.kind !== "ordered") flush();
        open ??= { kind: "ordered", start: latinNumber(m[1]), items: [] };
        if (open.kind === "ordered") open.items.push(parseInline(m[2].trim()));
      } else if ((m = BULLET.exec(line))) {
        if (open?.kind !== "list") flush();
        open ??= { kind: "list", items: [] };
        if (open.kind === "list") open.items.push(parseInline(m[1].trim()));
      } else {
        if (open?.kind !== "paragraph") flush();
        open ??= { kind: "paragraph", lines: [] };
        if (open.kind === "paragraph") open.lines.push(parseInline(line.trim()));
      }
    }
    flush();
  }
  return blocks;
}

/** The plain text of a block, for choosing its reading direction. */
export function blockText(block: Block): string {
  const inline = (parts: Inline[]) => parts.map((p) => p.text).join("");
  switch (block.kind) {
    case "paragraph":
    case "quote":
      return block.lines.map(inline).join(" ");
    case "list":
    case "ordered":
      return block.items.map(inline).join(" ");
    case "heading":
      return inline(block.text);
    case "divider":
      return "";
  }
}
