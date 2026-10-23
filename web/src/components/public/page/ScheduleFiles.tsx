import type { PublicProgramFile } from "../../../api/client";
import { formatLocalizedNumber, type AttendeeLocale } from "../../../lib/i18n";
import { Icon } from "../../ui/Icon";

interface ScheduleFilesProps {
  files: readonly PublicProgramFile[];
  locale: AttendeeLocale;
  className?: string;
}

/**
 * The congress schedule uploaded as files: images inline (tap to open full size in a new tab), PDFs as a
 * button that opens the file. Files are served anonymously, sandboxed, by `/api/public/program-files/{id}`.
 */
export function ScheduleFiles({ files, locale, className = "" }: ScheduleFilesProps) {
  if (files.length === 0) return null;
  const isRtl = locale === "fa";
  const pdfs = files.filter((f) => f.kind === "pdf");
  const images = files.filter((f) => f.kind === "image");
  return (
    <div data-testid="public-schedule-files" className={`space-y-5 ${className}`}>
      {pdfs.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {pdfs.map((file) => (
            <li key={file.id}>
              <a
                href={file.url}
                target="_blank"
                rel="noopener"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-border-default bg-surface-panel px-4 py-2 text-sm font-semibold text-text-primary shadow-soft transition-colors hover:border-event-accent focus-visible:outline-2 focus-visible:outline-focus-ring"
              >
                <Icon name="file" size={18} className="shrink-0 text-event-accent" />
                <span className="flex flex-col">
                  <span>{isRtl ? "مشاهدهٔ برنامه (PDF)" : "View the program (PDF)"}</span>
                  <span className="text-xs font-normal text-text-muted">
                    <bdi>{file.label}</bdi>
                    {file.page_count ? (isRtl ? ` · ${formatLocalizedNumber(file.page_count, locale)} صفحه` : ` · ${file.page_count} page${file.page_count === 1 ? "" : "s"}`) : ""}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {images.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2">
          {images.map((file) => (
            <li key={file.id}>
              <figure className="space-y-2">
                <a
                  href={file.url}
                  target="_blank"
                  rel="noopener"
                  className="block overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft focus-visible:outline-2 focus-visible:outline-focus-ring"
                  aria-label={isRtl ? `${file.label} — نمایش در اندازهٔ کامل` : `${file.label} — open full size`}
                >
                  <img
                    src={file.url}
                    alt={file.label}
                    width={file.width ?? undefined}
                    height={file.height ?? undefined}
                    loading="lazy"
                    decoding="async"
                    style={file.width && file.height ? { aspectRatio: `${file.width} / ${file.height}` } : undefined}
                    className="block h-auto w-full"
                  />
                </a>
                <figcaption className="text-sm text-text-secondary">
                  <bdi>{file.label}</bdi>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
