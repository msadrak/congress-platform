import type { PublicEvent } from "../../api/client";
import {
  isSectionVisible,
  localized,
  normalizeDocument,
  standardDocument,
  type PageDoc,
  type PageImages,
  type PageLocale,
  type PageSection,
  type SectionType,
} from "../../lib/pageDocument";

/** The page document that brands and labels the attendee panel, with the images it can show. */
export interface PanelPage {
  doc: PageDoc;
  images: PageImages;
}

/**
 * The congress's published page with its public image URLs. Every upload gets a new asset id, so a new
 * logo or cover is a new URL and never a stale cached image.
 */
export function publishedPage(event: PublicEvent): PanelPage {
  // A payload without a page (older API, test fixtures) uses the standard layout.
  const doc = event.page ? normalizeDocument(event.page.document) : standardDocument();
  const images: PageImages = Object.fromEntries(
    (event.page?.assets ?? []).map((a) => [a.id, { url: a.url, width: a.width, height: a.height }]),
  );
  return { doc, images };
}

function sectionOf<T extends SectionType>(doc: PageDoc, type: T): Extract<PageSection, { type: T }> | undefined {
  return doc.sections.find((s): s is Extract<PageSection, { type: T }> => s.type === type);
}

/** Headings and module visibility taken from the page document, with the panel's own copy as fallback. */
export interface PanelLabels {
  aboutTitle: string;
  /** Organizer-written about text from the page; null falls back to the congress description. */
  aboutBody: string | null;
  showAbout: boolean;
  scheduleTitle: string;
  scheduleLead: string | null;
  boothsTitle: string;
  boothsLead: string;
  showBooths: boolean;
  /** The public page offers passes (so "Reserve a pass" has somewhere to land). */
  showPasses: boolean;
}

export function panelLabels(doc: PageDoc, locale: PageLocale): PanelLabels {
  const fa = locale === "fa";
  const about = sectionOf(doc, "about");
  const exhibitors = sectionOf(doc, "exhibitors");
  const agenda = doc.sections.find((s) => s.type === "agenda" && localized(s.title, locale));
  return {
    aboutTitle: (about && localized(about.title, locale)) ?? (fa ? "درباره همایش" : "About the congress"),
    aboutBody: about ? localized(about.body, locale) : null,
    showAbout: isSectionVisible(doc, "about"),
    scheduleTitle: (agenda && localized(agenda.title, locale)) ?? (fa ? "برنامه همایش" : "Congress program"),
    scheduleLead: agenda?.type === "agenda" ? localized(agenda.lead, locale) : null,
    boothsTitle: (exhibitors && localized(exhibitors.title, locale)) ?? (fa ? "غرفه‌های نمایشگاه" : "Exhibition booths"),
    boothsLead:
      (exhibitors && localized(exhibitors.lead, locale)) ??
      (fa ? "شرکت‌ها و غرفه‌های حاضر در نمایشگاه این همایش." : "Companies exhibiting at this congress."),
    showBooths: isSectionVisible(doc, "exhibitors"),
    showPasses: isSectionVisible(doc, "passes"),
  };
}
