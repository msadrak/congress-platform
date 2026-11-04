/**
 * How the public hero presents the organizer's image: which layout actually renders, which images it
 * uses and where a cropped image is anchored. Pure, so the renderer, Page Studio and tests agree.
 */
import type { HeroLayout, PageDoc, PageImage, PageImages } from "./pageDocument";

export interface HeroPresentation {
  /** The layout that renders: an image layout without a (loaded) image falls back to the signature. */
  layout: HeroLayout;
  image: PageImage | null;
  /** Cover only: the image for narrow screens (below `md`), when the organizer chose one. */
  mobileImage: PageImage | null;
  /** CSS object-position of a cropped image (cover, split). */
  focus: string;
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, Math.round(Number.isFinite(value) ? value : 50)));

export const focusPosition = (x: number, y: number) => `${clampPercent(x)}% ${clampPercent(y)}%`;

export function heroPresentation(hero: PageDoc["hero"], images: PageImages): HeroPresentation {
  const image = hero.cover_asset_id ? (images[hero.cover_asset_id] ?? null) : null;
  const layout: HeroLayout = hero.layout !== "signature" && image ? hero.layout : "signature";
  const mobileImage = layout === "cover" && hero.mobile_cover_asset_id ? (images[hero.mobile_cover_asset_id] ?? null) : null;
  return { layout, image: layout === "signature" ? null : image, mobileImage, focus: focusPosition(hero.focal_x, hero.focal_y) };
}

/**
 * Banner width: the full content width, unless that would make the image taller than `maxHeight`; then
 * exactly as wide as that height allows. With `height: auto` the box keeps the image's own proportions,
 * so nothing is cropped or letterboxed and the space is reserved before the bytes arrive.
 */
export function bannerWidth(image: Pick<PageImage, "width" | "height">, maxHeight: string): string {
  const ratio = image.height > 0 ? image.width / image.height : 1;
  return `min(100%, calc(${maxHeight} * ${Number(ratio.toFixed(4))}))`;
}

/**
 * The hero layout after the organizer picks or removes the hero image. A first image on a page still
 * showing the signature artwork switches to the banner, which shows the whole image on every screen;
 * a layout the organizer chose deliberately is kept.
 */
export function layoutForImage(hero: PageDoc["hero"], nextImageId: string | null): HeroLayout {
  if (nextImageId && !hero.cover_asset_id && hero.layout === "signature") return "banner";
  return hero.layout;
}
