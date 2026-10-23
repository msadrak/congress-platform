import type { ReactNode } from "react";
import type {
  AgendaSection,
  CtaSection,
  FaqSection,
  HighlightsSection,
  ImageTextSection,
  LocalizedText,
  PageImages,
  RichTextSection,
  SpeakersSection,
} from "../../../lib/pageDocument";
import { localized } from "../../../lib/pageDocument";
import { codeFontClass } from "../../../lib/format";
import { buttonClassName } from "../../ui/buttonStyles";
import { Icon, type IconName } from "../../ui/Icon";
import { Bidi } from "../Bidi";
import { proseDir, publicCopy, type PublicLocale } from "../copy";
import { PageImg } from "./PageImg";
import { RichText } from "./RichText";

/** Organizer text in the page language (else the other language, isolated), or nothing. */
export function L({ value, locale }: { value: LocalizedText; locale: PublicLocale }) {
  const text = localized(value, locale);
  return text ? <Bidi text={text} /> : null;
}

/** Shown only in the Page Studio preview where a visitor would see nothing. */
export function EmptyBlock({ locale }: { locale: PublicLocale }) {
  return (
    <div className="flex items-center gap-3 rounded-card border border-dashed border-border-strong bg-surface-panel px-5 py-6 text-body-sm text-text-muted">
      <Icon name="note" size={18} />
      {publicCopy[locale].previewEmptyBlock}
    </div>
  );
}

export function HighlightsBlock({ section, locale }: { section: HighlightsSection; locale: PublicLocale }) {
  const items = section.items.filter((i) => localized(i.title, locale) || localized(i.body, locale));
  if (section.layout === "cards") {
    return (
      <ul className="grid gap-4 sm:grid-cols-2">
        {items.map((item, i) => (
          <li
            key={i}
            className="rounded-card border border-border-default bg-surface-panel p-6 shadow-soft sm:p-7"
          >
            <span className="grid size-12 place-items-center rounded-control bg-event-accent-soft text-event-accent">
              <Icon name={item.icon as IconName} size={22} />
            </span>
            <h3 className="mt-5 text-title-sm font-semibold text-text-primary">
              <L value={item.title} locale={locale} />
            </h3>
            <p className="mt-2 text-body-sm leading-relaxed text-text-secondary">
              <L value={item.body} locale={locale} />
            </p>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="grid border-t border-border-default sm:grid-cols-2">
      {items.map((item, i) => (
        <li key={i} className={`flex gap-4 border-b border-border-default py-6 sm:py-8 ${i % 2 === 0 ? "sm:pe-8" : "sm:border-s sm:ps-8"}`}>
          <span className="grid size-11 shrink-0 place-items-center rounded-control bg-event-accent-soft text-event-accent">
            <Icon name={item.icon as IconName} size={22} />
          </span>
          <div className="space-y-1.5">
            <h3 className="text-base font-semibold text-text-primary">
              <L value={item.title} locale={locale} />
            </h3>
            <p className="text-sm leading-relaxed text-text-secondary">
              <L value={item.body} locale={locale} />
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function RichTextBlock({ section, locale }: { section: RichTextSection; locale: PublicLocale }) {
  const body = localized(section.body, locale);
  if (!body) return null;
  return <RichText text={body} size={section.layout === "centered" ? "lg" : "md"} className={section.layout === "centered" ? "mx-auto max-w-3xl" : "max-w-3xl"} />;
}

export function ImageTextBlock({
  section,
  locale,
  images,
  heading,
}: {
  section: ImageTextSection;
  locale: PublicLocale;
  images: PageImages;
  heading: ReactNode;
}) {
  const image = section.image_asset_id ? images[section.image_asset_id] : undefined;
  const body = localized(section.body, locale);
  const alt = localized(section.image_alt, locale) ?? "";
  const imageEnd = section.layout === "image_end";
  return (
    <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-16">
      {image && (
        <figure className={`lg:col-span-6 ${imageEnd ? "lg:order-2" : ""}`}>
          <PageImg image={image} alt={alt} className="w-full rounded-card object-cover shadow-soft" />
        </figure>
      )}
      <div className={`space-y-6 ${image ? "lg:col-span-6" : "lg:col-span-12 max-w-3xl"} ${imageEnd ? "lg:order-1" : ""}`}>
        {heading}
        {body && <RichText text={body} />}
      </div>
    </div>
  );
}

export function FaqBlock({ section, locale }: { section: FaqSection; locale: PublicLocale }) {
  const items = section.items.filter((i) => localized(i.question, locale));
  return (
    <div className="max-w-4xl divide-y divide-border-default border-y border-border-default">
      {items.map((item, i) => {
        const answer = localized(item.answer, locale);
        return (
          <details key={i} className="group py-1">
            <summary className="flex min-h-[64px] cursor-pointer list-none items-center justify-between gap-6 py-4 text-start text-base font-semibold text-text-primary sm:text-lg [&::-webkit-details-marker]:hidden">
              <L value={item.question} locale={locale} />
              <span className="grid size-9 shrink-0 place-items-center rounded-full border border-border-default text-event-accent transition-transform duration-300 group-open:rotate-45">
                <Icon name="plus" size={16} />
              </span>
            </summary>
            {answer && <RichText text={answer} className="pb-6 pe-12" />}
          </details>
        );
      })}
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
}

export function SpeakersBlock({ section, locale, images }: { section: SpeakersSection; locale: PublicLocale; images: PageImages }) {
  const items = section.items.filter((i) => localized(i.name, locale));
  return (
    <ul className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((speaker, i) => {
        const name = localized(speaker.name, locale) ?? "";
        const photo = speaker.photo_asset_id ? images[speaker.photo_asset_id] : undefined;
        return (
          <li key={i} className="space-y-4">
            <div className="relative aspect-[4/5] overflow-hidden rounded-card bg-surface-ink">
              {photo ? (
                <PageImg image={photo} alt="" className="absolute inset-0 size-full object-cover" />
              ) : (
                <span {...proseDir(name)} aria-hidden="true" className="absolute inset-0 grid place-items-center text-display font-bold text-white">
                  {initials(name)}
                </span>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-base font-semibold leading-snug text-text-primary">
                <Bidi text={name} />
              </p>
              {localized(speaker.role, locale) && (
                <p className="text-sm text-event-accent">
                  <L value={speaker.role} locale={locale} />
                </p>
              )}
              {localized(speaker.affiliation, locale) && (
                <p className="text-sm text-text-muted">
                  <L value={speaker.affiliation} locale={locale} />
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function AgendaBlock({ section, locale }: { section: AgendaSection; locale: PublicLocale }) {
  const items = section.items.filter((i) => localized(i.title, locale));
  return (
    <ol className="relative max-w-4xl border-s border-border-default">
      {items.map((item, i) => (
        <li key={i} className="relative grid gap-1 py-5 ps-8 sm:grid-cols-[9rem_1fr] sm:gap-8 sm:py-6">
          <span aria-hidden="true" className="absolute -start-[5px] top-7 size-2.5 rounded-full bg-event-accent ring-4 ring-surface-page sm:top-8" />
          <p className={`${codeFontClass(item.time)} text-body-sm font-medium text-event-accent`}>
            <Bidi text={item.time} />
          </p>
          <div className="space-y-1.5">
            <p className="text-base font-semibold text-text-primary sm:text-lg">
              <L value={item.title} locale={locale} />
            </p>
            {localized(item.detail, locale) && (
              <p className="text-sm leading-relaxed text-text-secondary">
                <L value={item.detail} locale={locale} />
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function CtaBlock({
  section,
  locale,
  targetAnchor,
}: {
  section: CtaSection;
  locale: PublicLocale;
  /** In-page anchor of the target section, or null when that section is hidden or has nothing to act on. */
  targetAnchor: string | null;
}) {
  const c = publicCopy[locale];
  const title = localized(section.title, locale) ?? c.ctaDefaultTitle;
  const body = localized(section.body, locale);
  const label = localized(section.button_label, locale) ?? (section.target === "passes" ? c.ctaReserve : c.ctaExhibition);
  const ink = section.layout === "ink";
  return (
    <section
      id={`section-${section.id}`}
      aria-label={title}
      className={`rounded-card px-6 py-10 sm:px-12 sm:py-14 ${ink ? "surface-ink bg-surface-ink text-white" : "bg-event-accent-soft text-text-primary"}`}
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl space-y-3">
          <h2 className={`text-title font-bold sm:text-title-lg ${ink ? "text-white" : "text-text-primary"}`}>
            <Bidi text={title} />
          </h2>
          {body && (
            <p {...proseDir(body)} className={`text-body leading-relaxed ${ink ? "text-ink-200" : "text-text-secondary"}`}>
              {body}
            </p>
          )}
        </div>
        {targetAnchor && (
          <a
            href={`#${targetAnchor}`}
            className={buttonClassName({ variant: "primary", tone: ink ? "ink" : "default", size: "lg", className: "shrink-0" })}
          >
            <Bidi text={label} />
            <Icon name="arrow-right" size={20} />
          </a>
        )}
      </div>
    </section>
  );
}
