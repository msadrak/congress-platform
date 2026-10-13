import { Fragment } from "react";
import { parseMarkdownLite, type Inline } from "../../../lib/markdownLite";
import { proseDir } from "../copy";

function Inlines({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, i) =>
        part.kind === "strong" ? (
          <strong key={i} className="font-semibold text-text-primary">
            {part.text}
          </strong>
        ) : part.kind === "link" ? (
          <a
            key={i}
            href={part.href}
            target="_blank"
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

/** Organizer prose (Markdown-lite) rendered as React text: paragraphs, bullet lists, bold, safe links. */
export function RichText({ text, size = "md", className = "" }: { text: string; size?: "md" | "lg"; className?: string }) {
  const body = size === "lg" ? "text-lg leading-[1.7] sm:text-xl rtl:leading-[1.95]" : "text-base leading-[1.75] sm:text-[1.0625rem] rtl:leading-[2]";
  return (
    <div {...proseDir(text)} className={`space-y-5 text-text-secondary ${body} ${className}`}>
      {parseMarkdownLite(text).map((block, i) =>
        block.kind === "paragraph" ? (
          <p key={i}>
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Inlines parts={line} />
              </Fragment>
            ))}
          </p>
        ) : (
          <ul key={i} className="space-y-2.5">
            {block.items.map((item, j) => (
              <li key={j} className="flex gap-3">
                <span aria-hidden="true" className="mt-[0.7em] size-1.5 shrink-0 rounded-full bg-event-accent" />
                <span>
                  <Inlines parts={item} />
                </span>
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
