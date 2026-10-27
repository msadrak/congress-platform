import { useState, type ReactNode } from "react";
import type {
  AgendaSection,
  ColumnItem,
  ColumnsSection,
  CtaSection,
  FaqSection,
  GallerySection,
  HighlightsSection,
  ImageTextSection,
  LinkKind,
  LinksSection,
  LocalizedText,
  PageImages,
  RichTextSection,
  SpeakersSection,
  VideoSection,
} from "../../../lib/pageDocument";
import { localized } from "../../../lib/pageDocument";
import { linkDisplay, safeLinkHref, videoEmbedUrl, videoPageUrl } from "../../../lib/pageLinks";
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
  if (section.layout === "columns") {
    // Newspaper columns on wide screens; a heading, quote or list never splits across two columns.
    return <RichText text={body} className="gap-12 md:columns-2 [&>*]:break-inside-avoid [&>*+*]:mt-5" />;
  }
  return <RichText text={body} size={section.layout === "centered" ? "lg" : "md"} className={section.layout === "centered" ? "mx-auto max-w-3xl" : "max-w-3xl"} />;
}

/** An organizer link: a new tab for web addresses, the mail or phone app otherwise. */
function OutLink({ href, className, children, label }: { href: string; className: string; children: ReactNode; label?: string }) {
  const web = href.startsWith("http");
  return (
    <a href={href} target={web ? "_blank" : undefined} rel={web ? "noopener noreferrer nofollow" : undefined} className={className} aria-label={label}>
      {children}
    </a>
  );
}

const hasColumnContent = (item: ColumnItem, locale: PublicLocale) =>
  Boolean(item.image_asset_id || item.icon || localized(item.title, locale) || localized(item.body, locale));

export function ColumnsBlock({ section, locale, images }: { section: ColumnsSection; locale: PublicLocale; images: PageImages }) {
  const c = publicCopy[locale];
  const items = section.items.filter((item) => hasColumnContent(item, locale));
  const weighted = items.length === 2 && section.layout !== "equal";
  const grid = weighted
    ? "md:grid-cols-3"
    : items.length === 2
      ? "md:grid-cols-2"
      : items.length === 3
        ? "md:grid-cols-3"
        : items.length >= 4
          ? "sm:grid-cols-2 lg:grid-cols-4"
          : "";
  const cards = section.surface === "cards";
  return (
    <div className={`grid grid-cols-1 gap-8 ${cards ? "lg:gap-6" : "lg:gap-12"} ${grid}`}>
      {items.map((item, i) => {
        const image = item.image_asset_id ? images[item.image_asset_id] : undefined;
        const title = localized(item.title, locale);
        const body = localized(item.body, locale);
        const href = item.button_url ? safeLinkHref(item.button_url) : null;
        const wide = weighted && ((section.layout === "wide_start" && i === 0) || (section.layout === "wide_end" && i === 1));
        return (
          <div
            key={i}
            className={`flex min-w-0 flex-col gap-5 ${wide ? "md:col-span-2" : ""} ${cards ? "rounded-card border border-border-default bg-surface-panel p-6 shadow-soft sm:p-7" : ""}`}
          >
            {image && <PageImg image={image} alt={localized(item.image_alt, locale) ?? ""} className="w-full rounded-card object-cover" />}
            {item.icon && (
              <span className="grid size-12 place-items-center rounded-control bg-event-accent-soft text-event-accent">
                <Icon name={item.icon as IconName} size={22} />
              </span>
            )}
            {title && (
              <h3 className="text-title-sm font-semibold text-text-primary">
                <Bidi text={title} />
              </h3>
            )}
            {body && <RichText text={body} className="-mt-1" />}
            {href && (
              <OutLink href={href} className={buttonClassName({ variant: "secondary", size: "md", className: "mt-auto self-start" })}>
                <Bidi text={localized(item.button_label, locale) ?? c.ctaOpenLink} />
                <Icon name={href.startsWith("http") ? "arrow-up-right" : "arrow-right"} size={18} />
              </OutLink>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A YouTube or Aparat video behind a poster: nothing loads from the provider until the visitor presses play
 * (fast pages, no third-party requests for visitors who never watch), and a link to the video's own page
 * stays for networks that block the player.
 */
export function VideoBlock({ section, locale, images, heading }: { section: VideoSection; locale: PublicLocale; images: PageImages; heading?: ReactNode }) {
  const c = publicCopy[locale];
  const [playing, setPlaying] = useState(false);
  const poster = section.poster_asset_id ? images[section.poster_asset_id] : undefined;
  const provider = c.videoProviders[section.provider];
  const caption = localized(section.caption, locale);
  const body = localized(section.body, locale);
  const title = localized(section.title, locale) ?? c.sectionVideo;
  const side = section.layout !== "full";
  const player = (
    <figure className="space-y-3">
      <div className="relative aspect-video overflow-hidden rounded-card bg-surface-ink shadow-soft">
        {playing ? (
          <iframe
            src={videoEmbedUrl(section.provider, section.video_id)}
            title={title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
            className="absolute inset-0 size-full border-0"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="group absolute inset-0 grid cursor-pointer place-items-center text-white"
            aria-label={`${c.videoPlay}: ${title}`}
          >
            {poster ? (
              <PageImg image={poster} alt="" className="absolute inset-0 size-full object-cover" />
            ) : (
              <span aria-hidden="true" className="pub-video-poster absolute inset-0" />
            )}
            <span aria-hidden="true" className="absolute inset-0 bg-black/25 transition-colors group-hover:bg-black/35" />
            <span className="relative grid size-20 place-items-center rounded-full bg-white/95 text-surface-ink shadow-lg transition-transform group-hover:scale-105 group-focus-visible:scale-105">
              <Icon name="play" size={30} className="translate-x-0.5" />
            </span>
            <span className="absolute bottom-4 start-4 rounded-full bg-black/55 px-3 py-1 text-caption font-semibold">{provider}</span>
          </button>
        )}
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-body-sm text-text-muted">
        <span>{caption ? <Bidi text={caption} /> : !playing && c.videoLoadsFrom(provider)}</span>
        <OutLink href={videoPageUrl(section.provider, section.video_id)} className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-event-accent hover:underline">
          {c.videoWatchOn(provider)}
          <Icon name="arrow-up-right" size={16} />
          <span className="sr-only">{c.opensNewTab}</span>
        </OutLink>
      </figcaption>
    </figure>
  );
  if (!side) {
    return (
      <div className="space-y-8">
        <div className="mx-auto max-w-5xl">{player}</div>
        {body && <RichText text={body} className="mx-auto max-w-3xl" />}
      </div>
    );
  }
  const end = section.layout === "video_end";
  return (
    <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-16">
      <div className={`lg:col-span-7 ${end ? "lg:order-2" : ""}`}>{player}</div>
      <div className={`space-y-6 lg:col-span-5 ${end ? "lg:order-1" : ""}`}>
        {heading}
        {body && <RichText text={body} />}
      </div>
    </div>
  );
}

const GALLERY_COLUMNS = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "grid-cols-2 lg:grid-cols-4" } as const;
const LOGO_COLUMNS = { 2: "grid-cols-2", 3: "grid-cols-2 sm:grid-cols-3", 4: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" } as const;

export function GalleryBlock({ section, locale, images }: { section: GallerySection; locale: PublicLocale; images: PageImages }) {
  const logos = section.layout === "logos";
  const items = section.items.filter((item) => item.image_asset_id && images[item.image_asset_id]);
  return (
    <ul className={`grid gap-4 ${logos ? LOGO_COLUMNS[section.columns] : `grid-cols-1 sm:gap-5 ${GALLERY_COLUMNS[section.columns]}`}`}>
      {items.map((item, i) => {
        const image = images[item.image_asset_id ?? ""];
        const alt = localized(item.alt, locale) ?? "";
        const caption = localized(item.caption, locale);
        const href = item.url ? safeLinkHref(item.url) : null;
        // Logos sit on white whatever the band: most are drawn for a light background.
        const picture = logos ? (
          <span className="grid h-28 place-items-center rounded-card border border-border-default bg-white p-5 transition-shadow sm:h-32">
            <PageImg image={image} alt={alt} className="max-h-full w-auto max-w-full object-contain" />
          </span>
        ) : (
          <PageImg image={image} alt={alt} className="aspect-[4/3] w-full rounded-card object-cover" />
        );
        return (
          <li key={i}>
            <figure className="space-y-2">
              {href ? (
                <OutLink href={href} className="block rounded-card transition-opacity hover:opacity-85" label={alt || caption || undefined}>
                  {picture}
                </OutLink>
              ) : (
                picture
              )}
              {caption && (
                <figcaption className={`text-body-sm text-text-muted ${logos ? "text-center" : ""}`}>
                  <Bidi text={caption} />
                </figcaption>
              )}
            </figure>
          </li>
        );
      })}
    </ul>
  );
}

const LINK_ICONS: Record<LinkKind, IconName> = {
  website: "web",
  telegram: "send",
  instagram: "instagram",
  whatsapp: "chat",
  eitaa: "message",
  bale: "message",
  rubika: "message",
  linkedin: "linkedin",
  x: "x-brand",
  youtube: "video",
  aparat: "video",
  email: "mail",
  phone: "phone",
};

export function LinksBlock({ section, locale }: { section: LinksSection; locale: PublicLocale }) {
  const c = publicCopy[locale];
  const items = section.items.flatMap((item) => {
    const href = safeLinkHref(item.url);
    return href ? [{ ...item, href, name: localized(item.label, locale) ?? c.linkKinds[item.kind] }] : [];
  });
  if (section.layout === "cards") {
    return (
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, i) => (
          <li key={i}>
            <OutLink
              href={item.href}
              className="group flex min-h-20 items-center gap-4 rounded-card border border-border-default bg-surface-panel p-5 shadow-soft transition-colors hover:border-border-strong"
            >
              <span className="grid size-12 shrink-0 place-items-center rounded-control bg-event-accent-soft text-event-accent">
                <Icon name={LINK_ICONS[item.kind]} size={22} />
              </span>
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="block font-semibold text-text-primary">
                  <Bidi text={item.name} />
                </span>
                <span dir="ltr" className="block truncate text-start text-body-sm text-text-muted">
                  {linkDisplay(item.href)}
                </span>
              </span>
              <Icon name="arrow-up-right" size={18} className="text-text-muted transition-colors group-hover:text-event-accent" />
            </OutLink>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="flex flex-wrap gap-3">
      {items.map((item, i) => (
        <li key={i}>
          <OutLink
            href={item.href}
            className="inline-flex min-h-12 items-center gap-2.5 rounded-full border border-border-default bg-surface-panel px-5 font-semibold text-text-primary shadow-soft transition-colors hover:border-border-strong"
          >
            <Icon name={LINK_ICONS[item.kind]} size={19} className="text-event-accent" />
            <Bidi text={item.name} />
          </OutLink>
        </li>
      ))}
    </ul>
  );
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
  const external = section.target === "url" ? safeLinkHref(section.url) : null;
  const c = publicCopy[locale];
  const title = localized(section.title, locale) ?? c.ctaDefaultTitle;
  const body = localized(section.body, locale);
  const label =
    localized(section.button_label, locale) ?? (section.target === "passes" ? c.ctaReserve : section.target === "url" ? c.ctaOpenLink : c.ctaExhibition);
  const ink = section.layout === "ink";
  const buttonClass = buttonClassName({ variant: "primary", tone: ink ? "ink" : "default", size: "lg", className: "shrink-0" });
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
        {external ? (
          <OutLink href={external} className={buttonClass}>
            <Bidi text={label} />
            <Icon name={external.startsWith("http") ? "arrow-up-right" : "arrow-right"} size={20} />
          </OutLink>
        ) : (
          targetAnchor && (
            <a href={`#${targetAnchor}`} className={buttonClass}>
              <Bidi text={label} />
              <Icon name="arrow-right" size={20} />
            </a>
          )
        )}
      </div>
    </section>
  );
}
