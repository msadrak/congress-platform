import { Fragment } from "react";
import { blockText, parseMarkdownLite, type Block, type Inline } from "../../../lib/markdownLite";
import { num } from "../copy";
import { textDirection, useSectionFormat } from "./sectionFormat";

function Inlines({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, i) =>
        part.kind === "strong" ? (
          <strong key={i} className="font-semibold text-text-primary">
            {part.text}
          </strong>
        ) : part.kind === "em" ? (
          // Persian has no true italic: the emphasis is weight there.
          <em key={i} className="italic text-text-primary rtl:font-semibold rtl:not-italic">
            {part.text}
          </em>
        ) : part.kind === "mark" ? (
          <mark key={i} className="rounded bg-event-accent-soft px-1 font-semibold text-event-accent [box-decoration-break:clone]">
            {part.text}
          </mark>
        ) : part.kind === "link" ? (
          <a
            key={i}
            href={part.href}
            target={part.href.startsWith("http") ? "_blank" : undefined}
            rel="noopener noreferrer nofollow"
            className="font-semibold text-event-accent underline decoration-event-accent/30 underline-offset-4 hover:decoration-event-accent"
          >
            {part.text}
          </a>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}

function Lines({ lines }: { lines: Inline[][] }) {
  return lines.map((line, j) => (
    <Fragment key={j}>
      {j > 0 && <br />}
      <Inlines parts={line} />
    </Fragment>
  ));
}

const SIZES = [
  "text-body-sm leading-[1.7] rtl:leading-[1.95]",
  "text-body leading-[1.75] rtl:leading-[2]",
  "text-title-sm leading-[1.7] rtl:leading-[1.95]",
  "text-title leading-[1.6] rtl:leading-[1.85]",
] as const;
const STEP = { sm: -1, md: 0, lg: 1 } as const;

function BlockView({ block, dir }: { block: Block; dir: ReturnType<typeof textDirection> }) {
  switch (block.kind) {
    case "paragraph":
      return (
        <p {...dir}>
          <Lines lines={block.lines} />
        </p>
      );
    case "heading":
      return block.level === 3 ? (
        <h3 {...dir} className="pt-2 text-title-sm font-bold leading-snug text-text-primary">
          <Inlines parts={block.text} />
        </h3>
      ) : (
        <h4 {...dir} className="text-body font-semibold text-text-primary">
          <Inlines parts={block.text} />
        </h4>
      );
    case "quote":
      return (
        <blockquote {...dir} className="border-s-4 border-event-accent ps-5 text-text-primary">
          <Lines lines={block.lines} />
        </blockquote>
      );
    case "divider":
      return <hr className="border-border-default" />;
    case "list":
      return (
        <ul {...dir} className="space-y-2.5">
          {block.items.map((item, j) => (
            <li key={j} className="flex gap-3">
              <span aria-hidden="true" className="mt-[0.7em] size-1.5 shrink-0 rounded-full bg-event-accent" />
              <span>
                <Inlines parts={item} />
              </span>
            </li>
          ))}
        </ul>
      );
    case "ordered":
      // Numbers drawn like the bullets (accent, body font), in the block's own digits.
      return (
        <ol {...dir} start={block.start} className="space-y-2.5">
          {block.items.map((item, j) => (
            <li key={j} className="flex gap-3">
              <span aria-hidden="true" className="min-w-5 shrink-0 font-semibold text-event-accent tabular-nums">
                {num(block.start + j, dir.lang)}.
              </span>
              <span>
                <Inlines parts={item} />
              </span>
            </li>
          ))}
        </ol>
      );
  }
}

/**
 * Organizer prose (Markdown-lite) rendered as React text: paragraphs, headings, lists, quotes, dividers,
 * bold, italic, highlight and safe links. Each block reads in its own script's direction unless the
 * section forces one; the section's text size moves the whole scale one step up or down.
 */
export function RichText({ text, size = "md", className = "" }: { text: string; size?: "md" | "lg"; className?: string }) {
  const format = useSectionFormat();
  const scale = Math.min(SIZES.length - 1, Math.max(0, (size === "lg" ? 2 : 1) + STEP[format.textSize]));
  return (
    <div {...textDirection(text, format.direction)} className={`space-y-5 text-text-secondary ${SIZES[scale]} ${className}`}>
      {parseMarkdownLite(text).map((block, i) => (
        <BlockView key={i} block={block} dir={textDirection(blockText(block) || text, format.direction)} />
      ))}
    </div>
  );
}
