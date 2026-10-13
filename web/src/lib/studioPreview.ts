/**
 * Messages between Page Studio and its preview frame. Both documents are the same origin; each side
 * accepts messages only from that origin and only from the expected window (parent ↔ frame).
 */
import type { PageDoc, PageLocale } from "./pageDocument";

export interface PreviewAsset {
  id: string;
  width: number;
  height: number;
}

export type StudioToPreview =
  | { type: "page-studio:draft"; doc: PageDoc; assets: PreviewAsset[]; locale: PageLocale }
  | { type: "page-studio:focus"; anchor: string };

export type PreviewToStudio = { type: "page-studio:ready" } | { type: "page-studio:locale"; locale: PageLocale };

export function previewPath(eventId: string, locale: PageLocale): string {
  return `/organizer/events/${encodeURIComponent(eventId)}/page/preview?lang=${locale}`;
}

function isObject(value: unknown): value is { type?: unknown } {
  return typeof value === "object" && value !== null;
}

export function readStudioMessage(event: MessageEvent): StudioToPreview | null {
  if (event.origin !== window.location.origin || event.source !== window.parent || !isObject(event.data)) return null;
  const t = event.data.type;
  return t === "page-studio:draft" || t === "page-studio:focus" ? (event.data as StudioToPreview) : null;
}

export function readPreviewMessage(event: MessageEvent, frame: Window | null | undefined): PreviewToStudio | null {
  if (event.origin !== window.location.origin || !frame || event.source !== frame || !isObject(event.data)) return null;
  const t = event.data.type;
  return t === "page-studio:ready" || t === "page-studio:locale" ? (event.data as PreviewToStudio) : null;
}
