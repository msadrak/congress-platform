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
import { Badge } from "../../ui/Badge";
import { Icon } from "../../ui/Icon";
import { Bidi } from "../Bidi";
import { BoothIndex } from "../BoothIndex";
import { CongressHero, type HeroEvent } from "../CongressHero";
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
export function CongressPage({ event, doc, images, locale, passes, booths, mode = "public", programFiles = [] }: CongressPageProps) {
  const c = publicCopy[locale];
  const preview = mode === "preview";
  const logo = doc.branding.logo_asset_id ? images[doc.branding.logo_asset_id] ?? null : null;
  const passesVisible = isSectionVisible(doc, "passes");
  const exhibitionVisible = isSectionVisible(doc, "exhibitors");
  const exhibitorsTitle = doc.sections.find((section) => section.type === "exhibitors")?.title;
  let index = 0;
  // Program, schedule files and venue (operational data) sit right before the passes, or at the end without them.
  const passesSectionId = doc.sections.find((section) => section.visible && section.type === "passes")?.id;
  const programAndVenue = (): ReactNode => {
    const sessions = event.sessions ?? [];
    const venue = event.venue ?? [];
    return (
      <>
        {sessions.length > 0 && (
          <EditorialSection id="program" headingId="program-heading" index={++index} eyebrow={c.sectionProgramEyebrow} title={c.sectionProgram} lead={c.programLead} locale={locale}>
            <PublicProgram sessions={sessions} locale={locale} hallIds={new Set(venue.map((p) => p.id))} />
          </EditorialSection>
        )}
        {programFiles.length > 0 && (
          <section id="schedule-files" aria-label={c.sectionProgram} className="reveal scroll-mt-24">
            <ScheduleFiles files={programFiles} locale={locale} />
          </section>
        )}
        {venue.length > 0 && (
          <EditorialSection id="venue" headingId="venue-heading" index={++index} eyebrow={c.sectionVenueEyebrow} title={c.sectionVenue} locale={locale}>
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

  const render = (section: PageSection): ReactNode => {
    const anchor = sectionAnchor(section);
    const headingId = `${anchor}-heading`;
    if (!hasContent(section, locale)) return preview ? <EmptyBlock locale={locale} /> : null;

    switch (section.type) {
      case "about": {
        const body = localized(section.body, locale);
        return (
          <EditorialSection id={anchor} headingId={headingId} index={++index} eyebrow={text(section.eyebrow, c.sectionAboutEyebrow)} title={text(section.title, c.sectionAbout)} locale={locale}>
            {body ? (
              <RichText text={body} size="lg" className="max-w-3xl [&_p]:text-text-primary" />
            ) : event.description ? (
              <p {...proseDir(event.description)} className="max-w-3xl whitespace-pre-line text-xl leading-[1.6] tracking-[-0.01em] text-text-primary sm:text-2xl sm:leading-[1.55] rtl:leading-[1.95]">
                {event.description}
              </p>
            ) : (
              <p className="text-base text-text-muted">{c.noDescription}</p>
            )}
          </EditorialSection>
        );
      }
      case "highlights":
        // Both layouts stack under the heading; `list` and `cards` differ only in the block itself.
        return (
          <EditorialSection
            id={anchor}
            headingId={headingId}
            index={++index}
            eyebrow={text(section.eyebrow, c.sectionIncludesEyebrow)}
            title={text(section.title, c.sectionIncludes)}
            locale={locale}
          >
            <HighlightsBlock section={section} locale={locale} />
          </EditorialSection>
        );
      case "passes":
        return (
          <EditorialSection
            id={anchor}
            headingId={headingId}
            index={++index}
            eyebrow={text(section.eyebrow, c.sectionPassesEyebrow)}
            title={text(section.title, c.sectionPasses)}
            lead={text(section.lead, c.passesLead)}
            locale={locale}
            aside={
              <Badge variant="accent" size="md" icon={<Icon name="ticket" size={14} />} className="self-start lg:self-auto">
                {c.freeAdmission}
              </Badge>
            }
          >
            {passes}
          </EditorialSection>
        );
      case "exhibitors":
        return (
          <EditorialSection
            id={anchor}
            headingId={headingId}
            index={++index}
            eyebrow={text(section.eyebrow, c.sectionExhibitionEyebrow)}
            title={text(section.title, c.sectionExhibition)}
            lead={text(section.lead, c.exhibitionLead)}
            locale={locale}
          >
            <BoothIndex key={event.slug} slug={event.slug} locale={locale} booths={booths} />
          </EditorialSection>
        );
      case "rich_text": {
        const title = localized(section.title, locale);
        if (!title) {
          return (
            <section id={anchor} aria-label={c.sectionInformation} className="reveal scroll-mt-24">
              <RichTextBlock section={section} locale={locale} />
            </section>
          );
        }
        return (
          <EditorialSection
            id={anchor}
            headingId={headingId}
            index={++index}
            align={section.layout === "centered" ? "center" : "start"}
            eyebrow={text(section.eyebrow, "")}
            title={<Bidi text={title} />}
            locale={locale}
          >
            <RichTextBlock section={section} locale={locale} />
          </EditorialSection>
        );
      }
      case "image_text": {
        const title = localized(section.title, locale);
        const eyebrow = localized(section.eyebrow, locale);
        const heading = title ? (
          <div className="space-y-4">
            {eyebrow && <p className="text-xs font-semibold text-text-muted"><Bidi text={eyebrow} /></p>}
            <h2 id={headingId} className="text-3xl font-bold leading-[1.08] tracking-[-0.03em] text-text-primary sm:text-4xl rtl:leading-[1.4]">
              <Bidi text={title} />
            </h2>
          </div>
        ) : null;
        return (
          <section id={anchor} aria-labelledby={title ? headingId : undefined} aria-label={title ? undefined : c.sectionInformation} className="reveal scroll-mt-24">
            <ImageTextBlock section={section} locale={locale} images={images} heading={heading} />
          </section>
        );
      }
      case "faq":
        return (
          <EditorialSection id={anchor} headingId={headingId} index={++index} eyebrow={text(section.eyebrow, c.sectionFaqEyebrow)} title={text(section.title, c.sectionFaq)} locale={locale}>
            <FaqBlock section={section} locale={locale} />
          </EditorialSection>
        );
      case "speakers":
        return (
          <EditorialSection
            id={anchor}
            headingId={headingId}
            index={++index}
            eyebrow={text(section.eyebrow, c.sectionSpeakersEyebrow)}
            title={text(section.title, c.sectionSpeakers)}
            lead={localized(section.lead, locale) ? <Bidi text={localized(section.lead, locale)!} /> : undefined}
            locale={locale}
          >
            <SpeakersBlock section={section} locale={locale} images={images} />
          </EditorialSection>
        );
      case "agenda":
        return (
          <EditorialSection
            id={anchor}
            headingId={headingId}
            index={++index}
            eyebrow={text(section.eyebrow, c.sectionAgendaEyebrow)}
            title={text(section.title, c.sectionAgenda)}
            lead={localized(section.lead, locale) ? <Bidi text={localized(section.lead, locale)!} /> : undefined}
            locale={locale}
          >
            <AgendaBlock section={section} locale={locale} />
          </EditorialSection>
        );
      case "cta": {
        const target = section.target === "passes" ? (passesVisible ? "passes" : null) : exhibitionVisible ? "exhibition" : null;
        return <CtaBlock section={section} locale={locale} slug={event.slug} accent={doc.branding.accent} targetAnchor={target} />;
      }
    }
  };

  return (
    <>
      <CongressHero
        event={event}
        locale={locale}
        hero={doc.hero}
        accent={doc.branding.accent}
        images={images}
        logo={logo}
        showPasses={passesVisible}
        exhibitionLabel={exhibitionVisible ? text(exhibitorsTitle, c.ctaExhibition) : null}
      />
      <div className="pub-sheet">
        <EventActions event={event} locale={locale} />
        <div className="mx-auto max-w-7xl space-y-20 px-4 pt-14 pb-20 sm:space-y-28 sm:px-6 sm:pt-20 sm:pb-28 lg:px-10">
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
