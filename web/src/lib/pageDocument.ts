/**
 * The public congress page as edited in Page Studio and rendered on `/e/:slug`.
 *
 * Mirrors `backend/app/page_document.py`. The API marks defaulted fields optional; `normalizeDocument`
 * fills every default once so the renderer and the editor never deal with missing fields. The type check
 * at the bottom keeps this model assignable to the generated API schema, so drift fails `tsc`.
 */
import type { components } from "../api/schema";

export type PageLocale = "fa" | "en";
export interface LocalizedText {
  fa: string;
  en: string;
}

export type AccentName = "indigo" | "magenta" | "azure" | "violet" | "orchid";
export type AccentChoice = "auto" | AccentName;
export type HeroLayout = "signature" | "banner" | "cover" | "split";
/** Layouts that show the hero image (signature shows the generative artwork instead). */
export const IMAGE_LAYOUTS: readonly HeroLayout[] = ["banner", "cover", "split"];
export const HIGHLIGHT_ICONS = [
  "qr", "booth", "users", "wifi-off", "calendar", "clock", "pin", "ticket", "shield", "activity",
  "globe", "layers", "note", "chart", "device", "mail", "bookmark", "congress", "id-card",
  "utensils", "check-circle", "info",
] as const;
export type HighlightIcon = (typeof HIGHLIGHT_ICONS)[number];

interface SectionBase {
  id: string;
  visible: boolean;
  eyebrow: LocalizedText;
  title: LocalizedText;
}
export interface AboutSection extends SectionBase {
  type: "about";
  body: LocalizedText;
}
export interface HighlightItem {
  icon: HighlightIcon;
  title: LocalizedText;
  body: LocalizedText;
}
export interface HighlightsSection extends SectionBase {
  type: "highlights";
  layout: "list" | "cards";
  items: HighlightItem[];
}
export interface PassesSection extends SectionBase {
  type: "passes";
  lead: LocalizedText;
}
export interface ExhibitorsSection extends SectionBase {
  type: "exhibitors";
  lead: LocalizedText;
}
export interface RichTextSection extends SectionBase {
  type: "rich_text";
  layout: "split" | "centered";
  body: LocalizedText;
}
export interface ImageTextSection extends SectionBase {
  type: "image_text";
  layout: "image_start" | "image_end";
  body: LocalizedText;
  image_asset_id: string | null;
  image_alt: LocalizedText;
}
export interface FaqItem {
  question: LocalizedText;
  answer: LocalizedText;
}
export interface FaqSection extends SectionBase {
  type: "faq";
  items: FaqItem[];
}
export interface CtaSection extends SectionBase {
  type: "cta";
  layout: "ink" | "accent";
  body: LocalizedText;
  button_label: LocalizedText;
  target: "passes" | "exhibitors";
}
export interface Speaker {
  name: LocalizedText;
  role: LocalizedText;
  affiliation: LocalizedText;
  photo_asset_id: string | null;
}
export interface SpeakersSection extends SectionBase {
  type: "speakers";
  lead: LocalizedText;
  items: Speaker[];
}
export interface AgendaItem {
  time: string;
  title: LocalizedText;
  detail: LocalizedText;
}
export interface AgendaSection extends SectionBase {
  type: "agenda";
  lead: LocalizedText;
  items: AgendaItem[];
}

export type PageSection =
  | AboutSection
  | HighlightsSection
  | PassesSection
  | ExhibitorsSection
  | RichTextSection
  | ImageTextSection
  | FaqSection
  | CtaSection
  | SpeakersSection
  | AgendaSection;
export type SectionType = PageSection["type"];

export interface PageDoc {
  version: 1;
  primary_locale: "auto" | PageLocale;
  branding: { accent: AccentChoice; logo_asset_id: string | null };
  hero: {
    layout: HeroLayout;
    eyebrow: LocalizedText;
    title: LocalizedText;
    subtitle: LocalizedText;
    cta_label: LocalizedText;
    cover_asset_id: string | null;
    /** Where the subject of a cropped image sits (cover, split), in percent: CSS object-position. */
    focal_x: number;
    focal_y: number;
    /** Cover layout: a separately composed image for narrow screens (below `md`). */
    mobile_cover_asset_id: string | null;
  };
  seo: { title: LocalizedText; description: LocalizedText; share_image_asset_id: string | null };
  sections: PageSection[];
}

/** An image the page can show, with its intrinsic size so space is reserved before it loads. */
export interface PageImage {
  url: string;
  width: number;
  height: number;
}
export type PageImages = Readonly<Record<string, PageImage>>;

/** Bound to operational event data: always present exactly once; hidden, never removed. */
export const CORE_SECTIONS: readonly SectionType[] = ["about", "passes", "exhibitors"];
/** Curated blocks an organizer can add (any number of times) and remove. */
export const ADDABLE_SECTIONS: readonly SectionType[] = ["rich_text", "image_text", "highlights", "speakers", "agenda", "faq", "cta"];
export const MAX_SECTIONS = 24;
export const ACCENTS: readonly AccentName[] = ["indigo", "magenta", "azure", "violet", "orchid"];

export const isCoreSection = (section: PageSection) => CORE_SECTIONS.includes(section.type);

// ── Normalisation ─────────────────────────────────────────────────────────────────────────────────

type ApiDocument = components["schemas"]["PageDocument"];

const text = (value?: Partial<LocalizedText> | null): LocalizedText => ({ fa: value?.fa ?? "", en: value?.en ?? "" });
const emptyText = (): LocalizedText => ({ fa: "", en: "" });

function normalizeSection(raw: ApiDocument["sections"][number]): PageSection {
  const base = { id: raw.id, visible: raw.visible ?? true, eyebrow: text(raw.eyebrow), title: text(raw.title) };
  switch (raw.type) {
    case "about":
      return { ...base, type: "about", body: text(raw.body) };
    case "highlights":
      return {
        ...base,
        type: "highlights",
        layout: raw.layout ?? "list",
        items: (raw.items ?? []).map((i) => ({ icon: i.icon ?? "check-circle", title: text(i.title), body: text(i.body) })),
      };
    case "passes":
      return { ...base, type: "passes", lead: text(raw.lead) };
    case "exhibitors":
      return { ...base, type: "exhibitors", lead: text(raw.lead) };
    case "rich_text":
      return { ...base, type: "rich_text", layout: raw.layout ?? "split", body: text(raw.body) };
    case "image_text":
      return {
        ...base,
        type: "image_text",
        layout: raw.layout ?? "image_start",
        body: text(raw.body),
        image_asset_id: raw.image_asset_id ?? null,
        image_alt: text(raw.image_alt),
      };
    case "faq":
      return { ...base, type: "faq", items: (raw.items ?? []).map((i) => ({ question: text(i.question), answer: text(i.answer) })) };
    case "cta":
      return {
        ...base,
        type: "cta",
        layout: raw.layout ?? "ink",
        body: text(raw.body),
        button_label: text(raw.button_label),
        target: raw.target ?? "passes",
      };
    case "speakers":
      return {
        ...base,
        type: "speakers",
        lead: text(raw.lead),
        items: (raw.items ?? []).map((i) => ({
          name: text(i.name),
          role: text(i.role),
          affiliation: text(i.affiliation),
          photo_asset_id: i.photo_asset_id ?? null,
        })),
      };
    case "agenda":
      return {
        ...base,
        type: "agenda",
        lead: text(raw.lead),
        items: (raw.items ?? []).map((i) => ({ time: i.time ?? "", title: text(i.title), detail: text(i.detail) })),
      };
  }
}

export function normalizeDocument(raw: ApiDocument): PageDoc {
  return {
    version: 1,
    primary_locale: raw.primary_locale ?? "auto",
    branding: { accent: raw.branding?.accent ?? "auto", logo_asset_id: raw.branding?.logo_asset_id ?? null },
    hero: {
      layout: raw.hero?.layout ?? "signature",
      eyebrow: text(raw.hero?.eyebrow),
      title: text(raw.hero?.title),
      subtitle: text(raw.hero?.subtitle),
      cta_label: text(raw.hero?.cta_label),
      cover_asset_id: raw.hero?.cover_asset_id ?? null,
      focal_x: raw.hero?.focal_x ?? 50,
      focal_y: raw.hero?.focal_y ?? 50,
      mobile_cover_asset_id: raw.hero?.mobile_cover_asset_id ?? null,
    },
    seo: {
      title: text(raw.seo?.title),
      description: text(raw.seo?.description),
      share_image_asset_id: raw.seo?.share_image_asset_id ?? null,
    },
    sections: raw.sections.map(normalizeSection),
  };
}

/** The page every congress had before Page Studio; used when a payload carries no page (older API, mocks). */
export function standardDocument(): PageDoc {
  return normalizeDocument({
    version: 1,
    primary_locale: "auto",
    sections: [
      { type: "about", id: "about", visible: true },
      { type: "highlights", id: "highlights", visible: true, layout: "list", items: [] },
      { type: "passes", id: "passes", visible: true },
      { type: "exhibitors", id: "exhibitors", visible: true },
    ],
  });
}

// ── Language ──────────────────────────────────────────────────────────────────────────────────────

const OTHER: Record<PageLocale, PageLocale> = { fa: "en", en: "fa" };

/**
 * The text to show for `locale`: that language, else the other one (the renderer isolates it so its
 * direction is kept), else null so the caller can use the platform's own localized copy.
 */
export function localized(value: LocalizedText, locale: PageLocale): string | null {
  return value[locale].trim() || value[OTHER[locale]].trim() || null;
}

/** Which of the two languages actually has content. */
export function filledLocales(value: LocalizedText): PageLocale[] {
  return (["fa", "en"] as const).filter((l) => value[l].trim().length > 0);
}

// ── Structure ─────────────────────────────────────────────────────────────────────────────────────

/** In-page anchor. The original three keep their historic ids so existing links (#passes …) still work. */
export function sectionAnchor(section: PageSection): string {
  if (section.type === "about") return "about";
  if (section.type === "passes") return "passes";
  if (section.type === "exhibitors") return "exhibition";
  return `section-${section.id}`;
}

export const visibleSections = (doc: PageDoc) => doc.sections.filter((s) => s.visible);

export function isSectionVisible(doc: PageDoc, type: SectionType): boolean {
  return doc.sections.some((s) => s.type === type && s.visible);
}

export function moveSection(doc: PageDoc, id: string, delta: -1 | 1): PageDoc {
  const from = doc.sections.findIndex((s) => s.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= doc.sections.length) return doc;
  const sections = doc.sections.slice();
  [sections[from], sections[to]] = [sections[to], sections[from]];
  return { ...doc, sections };
}

export function removeSection(doc: PageDoc, id: string): PageDoc {
  const section = doc.sections.find((s) => s.id === id);
  if (!section || isCoreSection(section)) return doc;
  return { ...doc, sections: doc.sections.filter((s) => s.id !== id) };
}

export function updateSection(doc: PageDoc, next: PageSection): PageDoc {
  return { ...doc, sections: doc.sections.map((s) => (s.id === next.id ? next : s)) };
}

function freshId(doc: PageDoc, type: SectionType): string {
  const stem = type.replace("_", "-");
  for (let n = 1; ; n++) {
    const id = `${stem}-${n}`;
    if (!doc.sections.some((s) => s.id === id)) return id;
  }
}

/** A new block with sensible starting content, inserted after `afterId` (or at the end). */
export function addSection(doc: PageDoc, type: SectionType, afterId?: string): { doc: PageDoc; id: string } {
  if (!ADDABLE_SECTIONS.includes(type) || doc.sections.length >= MAX_SECTIONS) return { doc, id: "" };
  const id = freshId(doc, type);
  const base = { id, visible: true, eyebrow: emptyText(), title: emptyText() };
  let section: PageSection;
  switch (type) {
    case "rich_text":
      section = { ...base, type, layout: "split", body: emptyText() };
      break;
    case "image_text":
      section = { ...base, type, layout: "image_start", body: emptyText(), image_asset_id: null, image_alt: emptyText() };
      break;
    case "highlights":
      section = { ...base, type, layout: "cards", items: [{ icon: "check-circle", title: emptyText(), body: emptyText() }] };
      break;
    case "speakers":
      section = { ...base, type, lead: emptyText(), items: [{ name: emptyText(), role: emptyText(), affiliation: emptyText(), photo_asset_id: null }] };
      break;
    case "agenda":
      section = { ...base, type, lead: emptyText(), items: [{ time: "", title: emptyText(), detail: emptyText() }] };
      break;
    case "faq":
      section = { ...base, type, items: [{ question: emptyText(), answer: emptyText() }] };
      break;
    default:
      section = { ...base, type: "cta", layout: "ink", body: emptyText(), button_label: emptyText(), target: "passes" };
  }
  const index = afterId ? doc.sections.findIndex((s) => s.id === afterId) : -1;
  const sections = doc.sections.slice();
  sections.splice(index < 0 ? sections.length : index + 1, 0, section);
  return { doc: { ...doc, sections }, id };
}

/** Every image id the document references (logo, hero images, share image, section images, speaker photos). */
export function referencedImages(doc: PageDoc): Set<string> {
  const ids = new Set<string>();
  const add = (id: string | null) => {
    if (id) ids.add(id);
  };
  add(doc.branding.logo_asset_id);
  add(doc.hero.cover_asset_id);
  add(doc.hero.mobile_cover_asset_id);
  add(doc.seo.share_image_asset_id);
  for (const s of doc.sections) {
    if (s.type === "image_text") add(s.image_asset_id);
    if (s.type === "speakers") s.items.forEach((i) => add(i.photo_asset_id));
  }
  return ids;
}

/** Stable comparison for "unsaved changes": same content in the same order. */
export const sameDocument = (a: PageDoc, b: PageDoc) => JSON.stringify(a) === JSON.stringify(b);

/** What another saved version (`theirs`) has that differs from `mine`: the summary of a stale-save conflict. */
export interface DocumentDiff {
  hero: boolean;
  branding: boolean;
  seo: boolean;
  /** The sections both versions have are in another order. */
  order: boolean;
  /** Sections only `theirs` has. */
  added: PageSection[];
  /** Sections only `mine` has. */
  removed: PageSection[];
  /** Sections both have, with other content (`theirs`'s copy). */
  changed: PageSection[];
}

export function documentDiff(mine: PageDoc, theirs: PageDoc): DocumentDiff {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const byId = (doc: PageDoc) => {
    const index: Record<string, PageSection> = {};
    for (const section of doc.sections) index[section.id] = section;
    return index;
  };
  const mineById = byId(mine);
  const theirsById = byId(theirs);
  return {
    hero: !same(mine.hero, theirs.hero) || mine.primary_locale !== theirs.primary_locale,
    branding: !same(mine.branding, theirs.branding),
    seo: !same(mine.seo, theirs.seo),
    order: !same(
      mine.sections.filter((s) => Object.hasOwn(theirsById, s.id)).map((s) => s.id),
      theirs.sections.filter((s) => Object.hasOwn(mineById, s.id)).map((s) => s.id),
    ),
    added: theirs.sections.filter((s) => !Object.hasOwn(mineById, s.id)),
    removed: mine.sections.filter((s) => !Object.hasOwn(theirsById, s.id)),
    changed: theirs.sections.filter((s) => Object.hasOwn(mineById, s.id) && !same(s, mineById[s.id])),
  };
}

// Drift guard: the normalised model must stay a valid API document.
export const toApiDocument = (doc: PageDoc): ApiDocument => doc;
