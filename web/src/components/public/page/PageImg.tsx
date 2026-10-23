import { useState, type CSSProperties } from "react";
import type { PageImage } from "../../../lib/pageDocument";

/** Matches the `md` breakpoint (48rem) and the public stylesheet's narrow-screen rules. */
export const BELOW_MD = "(max-width: 47.99rem)";

interface PageImgProps {
  image: PageImage;
  alt: string;
  className?: string;
  style?: CSSProperties;
  /** Above-the-fold hero imagery: fetched eagerly with high priority. Everything else is lazy. */
  priority?: boolean;
  /** Art direction: a separately composed image below `md`. Only for boxes sized by CSS (not by ratio). */
  mobile?: PageImage | null;
  /**
   * Shows the image once it is fully decoded (a short fade), instead of painting it row by row while the
   * bytes stream in; whatever is behind it (a tinted frame, the signature artwork) holds the space.
   */
  reveal?: boolean;
}

/**
 * Organizer image with its intrinsic size declared, so the browser reserves the box before the bytes
 * arrive (no layout shift). While a preview image is still loading (empty url) a tinted block holds the
 * same space. Every asset has one rendition, so there is no srcset (and no `sizes`) to choose from.
 */
export function PageImg({ image, alt, className = "", style, priority = false, mobile = null, reveal = false }: PageImgProps) {
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const ratio = { aspectRatio: `${image.width} / ${image.height}` };
  if (!image.url) {
    return <span role="presentation" style={{ ...ratio, ...style }} className={`block bg-white/10 motion-safe:animate-pulse ${className}`} />;
  }
  const sourceKey = `${image.url} ${mobile?.url ?? ""}`;
  const shown = !reveal || loadedKey === sourceKey;
  const img = (
    <img
      src={image.url}
      alt={alt}
      width={image.width}
      height={image.height}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : "auto"}
      style={{ ...ratio, ...style }}
      onLoad={reveal ? () => setLoadedKey(sourceKey) : undefined}
      // A cached image can finish before React attaches the listener.
      ref={
        reveal
          ? (node) => {
              if (node?.complete && node.naturalWidth > 0) setLoadedKey(sourceKey);
            }
          : undefined
      }
      data-loaded={reveal ? shown : undefined}
      className={`${className} ${reveal ? `motion-safe:transition-opacity motion-safe:duration-500 ${shown ? "opacity-100" : "opacity-0"}` : ""}`}
    />
  );
  if (!mobile?.url) return img;
  return (
    <picture className="contents">
      <source media={BELOW_MD} srcSet={mobile.url} width={mobile.width} height={mobile.height} />
      {img}
    </picture>
  );
}
