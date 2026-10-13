/**
 * The small Markdown subset organizers can use in long texts, parsed to plain data that React renders
 * as text nodes. No HTML ever passes through: `<b>` stays the five characters `<b>`.
 *
 *   blank line   → new paragraph            "- " or "• " → bullet item
 *   **bold**     → strong                   [label](https://…) → link (http/https only)
 */
export type Inline = { kind: "text"; text: string } | { kind: "strong"; text: string } | { kind: "link"; text: string; href: string };
export type Block = { kind: "paragraph"; lines: Inline[][] } | { kind: "list"; items: Inline[][] };

const BULLET = /^\s*(?:[-•*])\s+(.*)$/;
const TOKEN = /\*\*(.+?)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

export function safeHref(raw: string): string | null {
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
    } else {
      const href = safeHref(match[3]);
      if (href) out.push({ kind: "link", text: match[2], href });
      else push(match[0]);
    }
    last = (match.index ?? 0) + match[0].length;
  }
  push(line.slice(last));
  return out;
}

export function parseMarkdownLite(source: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of source.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const lines = chunk.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;
    let paragraph: Inline[][] = [];
    let list: Inline[][] = [];
    const flushParagraph = () => {
      if (paragraph.length) blocks.push({ kind: "paragraph", lines: paragraph });
      paragraph = [];
    };
    const flushList = () => {
      if (list.length) blocks.push({ kind: "list", items: list });
      list = [];
    };
    for (const line of lines) {
      const bullet = BULLET.exec(line);
      if (bullet) {
        flushParagraph();
        list.push(parseInline(bullet[1].trim()));
      } else {
        flushList();
        paragraph.push(parseInline(line.trim()));
      }
    }
    flushParagraph();
    flushList();
  }
  return blocks;
}
