import { useEffect } from "react";
import { localized, type PageDoc, type PageImages, type PageLocale } from "./pageDocument";

interface PageMetaInput {
  doc: PageDoc;
  images: PageImages;
  locale: PageLocale;
  eventName: string;
}

const META: Array<{ attr: "name" | "property"; key: string }> = [
  { attr: "name", key: "description" },
  { attr: "property", key: "og:title" },
  { attr: "property", key: "og:description" },
  { attr: "property", key: "og:image" },
  { attr: "property", key: "og:type" },
  { attr: "name", key: "twitter:card" },
];

function metaTag(attr: "name" | "property", key: string): HTMLMetaElement {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attr, key);
    tag.dataset.pageMeta = "added";
    document.head.appendChild(tag);
  }
  return tag;
}

/**
 * Applies the page's SEO title, description and share image to the document head while the congress
 * page is open, and restores the platform defaults afterwards. This serves browsers, search engines that
 * render JavaScript and in-app sharing; crawlers that read raw HTML need server-side injection (see the
 * milestone report).
 */
export function usePageMeta(input: PageMetaInput | null): void {
  const title = input ? localized(input.doc.seo.title, input.locale) ?? localized(input.doc.hero.title, input.locale) ?? input.eventName : null;
  const description = input ? localized(input.doc.seo.description, input.locale) ?? localized(input.doc.hero.subtitle, input.locale) : null;
  const shareId = input ? input.doc.seo.share_image_asset_id ?? input.doc.hero.cover_asset_id : null;
  const shareUrl = input && shareId ? input.images[shareId]?.url : undefined;

  useEffect(() => {
    if (!title) return;
    const previousTitle = document.title;
    const previous = META.map(({ attr, key }) => {
      const existing = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
      return { attr, key, content: existing?.getAttribute("content") ?? null };
    });
    const values: Record<string, string | null> = {
      description,
      "og:title": title,
      "og:description": description,
      "og:image": shareUrl ? new URL(shareUrl, window.location.origin).href : null,
      "og:type": "website",
      "twitter:card": shareUrl ? "summary_large_image" : "summary",
    };
    document.title = title;
    for (const { attr, key } of META) {
      const value = values[key];
      if (value) metaTag(attr, key).setAttribute("content", value);
    }
    return () => {
      document.title = previousTitle;
      for (const { attr, key, content } of previous) {
        const tag = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
        if (!tag) continue;
        if (content === null && tag.dataset.pageMeta === "added") tag.remove();
        else if (content !== null) tag.setAttribute("content", content);
      }
    };
  }, [title, description, shareUrl]);
}
