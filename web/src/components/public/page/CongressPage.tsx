import { Fragment, type ReactNode } from "react";
import type { PublicBoothSummary, PublicProgramFile, PublicSession, PublicVenuePlace } from "../../../api/client";
import {
  isSectionVisible,
  localized,
  sectionAnchor,
  type PageDoc,
  type PageImages,
  type PageSection,
} from "../../../lib/pageDocument";
import { Bidi } from "../Bidi";
import { BoothIndex } from "../BoothIndex";
import { CongressHero, type HeroAction, type HeroEvent } from "../CongressHero";
import { proseDir, publicCopy, type PublicLocale } from "../copy";
import { EditorialSection } from "../EditorialSection";
import { EventActions } from "../EventActions";
import { PublicProgram } from "../PublicProgram";
import { PublicVenue } from "../PublicVenue";
import {
  AgendaBlock,
  CtaBlock,
  EmptyBlock,
  FaqBlock,
  HighlightsBlock,
  ImageTextBlock,
  RichTextBlock,
  SpeakersBlock,
} from "./PageSections";
import { RichText } from "./RichText";
import { ScheduleFiles } from "./ScheduleFiles";

export interface CongressPageEvent extends HeroEvent {
  id: string;
  description: string;
  /** Program and venue directory (optional: older payloads and fixtures have neither). */
  sessions?: PublicSession[];
  venue?: PublicVenuePlace[];
}

interface CongressPageProps {
  event: CongressPageEvent;
  doc: PageDoc;
  images: PageImages;
  locale: PublicLocale;
  /** The live passes panel (tiers + reservation dock), rendered inside the passes section. */
  passes: ReactNode;
  /** Booth directory already loaded by the caller (preview); otherwise read from the public API. */
  booths?: PublicBoothSummary[];
  /** "preview" shows empty blocks as placeholders so the organizer can see where they sit. */
  mode?: "public" | "preview";
  /** Visible schedule files (PDFs and images), shown after the sections. */
  programFiles?: readonly PublicProgramFile[];
  /** The page's ticking clock (ms): registration states change on their own when a window opens or closes. */
  now?: number;
  /** The hero's one action (a held pass, a one-tap reservation, the passes section, or none). */
  heroAction?: HeroAction;
}

function hasContent(section: PageSection, locale: PublicLocale): boolean {
  switch (section.type) {
    case "rich_text":
      return Boolean(localized(section.body, locale));
    case "image_text":
      return Boolean(section.image_asset_id || localized(section.body, locale) || localized(section.title, locale));
    case "highlights":
      return section.items.some((i) => localized(i.title, locale) || localized(i.body, locale));
    case "faq":
      return section.items.some((i) => localized(i.question, locale));
    case "speakers":
      return section.items.some((i) => localized(i.name, locale));
    case "agenda":
      return section.items.some((i) => localized(i.title, locale));
    default:
      return true;
  }
}

/**
 * The public congress page, composed from the organizer's page document: hero, then the visible
 * sections in their saved order, each drawn by a curated AIteb component. The same component renders
 * `/e/:slug` and the Page Studio preview, so the preview is the page.
 */
export function CongressPage({ event, doc, images, locale, passes, booths, mode = "public", programFiles = [], now, heroAction }: CongressPageProps) {
  const c = publicCopy[locale];
  const preview = mode === "preview";
  const logo = doc.branding.logo_asset_id ? images[doc.branding.logo_asset_id] ?? null : null;
  const passesVisible = isSectionVisible(doc, "passes");
  const exhibitionVisible = isSectionVisible(doc, "exhibitors");
  const exhibitorsTitle = doc.sections.find((section) => section.type === "exhibitors")?.title;
  // Program, schedule files and venue (operational data) sit right before the passes, or at the end without them.
  const passesSectionId = doc.sections.find((section) => section.visible && section.type === "passes")?.id;
  const programAndVenue = (): ReactNode => {
    const sessions = event.sessions ?? [];
    const venue = event.venue ?? [];
    return (
      <>
        {sessions.length > 0 && (
          <EditorialSection id="program" headingId="program-heading" title={c.sectionProgram}>
            <PublicProgram sessions={sessions} locale={locale} timeZone={event.timezone} hallIds={new Set(venue.map((p) => p.id))} />
          </EditorialSection>
        )}
        {programFiles.length > 0 && (
          <section id="schedule-files" aria-label={c.sectionProgram} className="scroll-mt-24">
            <ScheduleFiles files={programFiles} locale={locale} />
          </section>
        )}
        {venue.length > 0 && (
          <EditorialSection id="venue" headingId="venue-heading" title={c.sectionVenue}>
            <PublicVenue address={event.location} venue={venue} sessions={sessions} locale={locale} />
          </EditorialSection>
        )}
      </>
    );
  };

  const text = (value: PageSection["title"], fallback: string): ReactNode => {
    const own = localized(value, locale);
    return own ? <Bidi text={own} /> : fallback;
  };
  /** Organizer-written text only (eyebrows, leads): nothing when the organizer wrote none. */
  const own = (value: PageSection["title"] | undefined): ReactNode => {
    const written = value ? localized(value, locale) : undefined;
    return written ? <Bidi text={written} /> : undefined;
  };
  // The closing call to action points at the passes only while a pass can be reserved there.
  const reservable = heroAction ? heroAction.kind === "reserve" || heroAction.kind === "passes" : true;

  const render = (section: PageSection): ReactNode => {
    const anchor = sectionAnchor(section);
    const headingId = `${anchor}-heading`;
    if (!hasContent(section, locale)) return preview ? <EmptyBlock locale={locale} /> : null;

    switch (section.type) {
      case "about": {
        const body = localized(section.body, locale);
        if (!body && !event.description) return preview ? <EmptyBlock locale={locale} /> : null;
        return (
          <EditorialSection id={anchor} headingId={headingId} eyebrow={own(section.eyebrow)} title={text(section.title, c.sectionAbout)}>
            {body ? (
              <RichText text={body} size="lg" className="max-w-3xl [&_p]:text-text-primary" />
            ) : (
              <p {...proseDir(event.description)} className="max-w-3xl whitespace-pre-line text-title-sm leading-relaxed text-text-primary">
                {event.description}
              </p>
            )}
          </EditorialSection>
        );
      }
      case "highlights": {
        // Both layouts stack under the heading; `list` and `cards` differ only in the block itself.
        const title = own(section.title);
        if (!title) {
          return (
            <section id={anchor} aria-label={c.sectionInformation} className="scroll-mt-24">
              <HighlightsBlock section={section} locale={locale} />
            </section>
          );
        }
        return (
          <EditorialSection id={anchor} headingId={headingId} eyebrow={own(section.eyebrow)} title={title}>
            <HighlightsBlock section={section} locale={locale} />
          </EditorialSection>
        );
      }
      case "passes":
        return (
          <EditorialSection id={anchor} headingId={headingId} eyebrow={own(section.eyebrow)} title={text(section.title, c.sectionPasses)} lead={own(section.lead)}>
            {passes}
          </EditorialSection>
        );
      case "exhibitors":
        return (
          <EditorialSection id={anchor} headingId={headingId} eyebrow={own(section.eyebrow)} title={text(section.title, c.sectionExhibition)} lead={own(section.lead)}>
            <BoothIndex key={event.slug} slug={event.slug} locale={locale} booths={booths} />
          </EditorialSection>
        );
      case "rich_text": {
        const title = localized(section.title, locale);
        if (!title) {
          return (
            <section id={anchor} aria-label={c.sectionInformation} className="scroll-mt-24">
              <RichTextBlock section={section} locale={locale} />
            </section>
          );
        }
        return (
          <EditorialSection
            id={anchor}
            headingId={headingId}
            align={section.layout === "centered" ? "center" : "start"}
            eyebrow={own(section.eyebrow)}
            title={<Bidi text={title} />}
          >
            <RichTextBlock section={section} locale={locale} />
          </EditorialSection>
        );
      }
      case "image_text": {
        const title = localized(section.title, locale);
        const eyebrow = localized(section.eyebrow, locale);
        const heading = title ? (
          <div className="space-y-2">
            {eyebrow && <p className="text-meta font-semibold text-text-muted"><Bidi text={eyebrow} /></p>}
            <h2 id={headingId} className="text-title font-bold text-text-primary sm:text-title-lg">
              <Bidi text={title} />
            </h2>
          </div>
        ) : null;
        return (
          <section id={anchor} aria-labelledby={title ? headingId : undefined} aria-label={title ? undefined : c.sectionInformation} className="scroll-mt-24">
            <ImageTextBlock section={section} locale={locale} images={images} heading={heading} />
          </section>
        );
      }
      case "faq":
        return (
          <EditorialSection id={anchor} headingId={headingId} eyebrow={own(section.eyebrow)} title={text(section.title, c.sectionFaq)}>
            <FaqBlock section={section} locale={locale} />
          </EditorialSection>
        );
      case "speakers":
        return (
          <EditorialSection id={anchor} headingId={headingId} eyebrow={own(section.eyebrow)} title={text(section.title, c.sectionSpeakers)} lead={own(section.lead)}>
            <SpeakersBlock section={section} locale={locale} images={images} />
          </EditorialSection>
        );
      case "agenda":
        return (
          <EditorialSection id={anchor} headingId={headingId} eyebrow={own(section.eyebrow)} title={text(section.title, c.sectionAgenda)} lead={own(section.lead)}>
            <AgendaBlock section={section} locale={locale} />
          </EditorialSection>
        );
      case "cta": {
        const target = section.target === "passes" ? (passesVisible && reservable ? "passes" : null) : exhibitionVisible ? "exhibition" : null;
        return <CtaBlock section={section} locale={locale} targetAnchor={target} />;
      }
    }
  };

  return (
    <>
      <CongressHero
        event={event}
        now={now}
        locale={locale}
        hero={doc.hero}
        accent={doc.branding.accent}
        images={images}
        logo={logo}
        showPasses={passesVisible}
        action={heroAction}
        exhibitionLabel={exhibitionVisible ? text(exhibitorsTitle, c.ctaExhibition) : null}
      />
      <div className="pub-sheet">
        <EventActions event={event} locale={locale} />
        <div className="mx-auto max-w-7xl space-y-16 px-4 pt-10 pb-16 sm:space-y-20 sm:px-6 sm:pt-14 sm:pb-20 lg:px-10">
          {doc.sections
            .filter((section) => section.visible)
            .map((section) => (
              <Fragment key={section.id}>
                {section.id === passesSectionId && programAndVenue()}
                {render(section)}
              </Fragment>
            ))}
          {!passesSectionId && programAndVenue()}
        </div>
      </div>
    </>
  );
}
