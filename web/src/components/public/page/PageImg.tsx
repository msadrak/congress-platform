import type { PageImage } from "../../../lib/pageDocument";

interface PageImgProps {
  image: PageImage;
  alt: string;
  className?: string;
  /** Above-the-fold hero imagery: fetched eagerly with high priority. Everything else is lazy. */
  priority?: boolean;
}

/**
 * Organizer image with its intrinsic size declared, so the browser reserves the box before the bytes
 * arrive (no layout shift). While a preview image is still loading (empty url) a tinted block holds the
 * same space.
 */
export function PageImg({ image, alt, className = "", priority = false }: PageImgProps) {
  const ratio = { aspectRatio: `${image.width} / ${image.height}` };
  if (!image.url) {
    return <span role="presentation" style={ratio} className={`block bg-white/10 motion-safe:animate-pulse ${className}`} />;
  }
  return (
    <img
      src={image.url}
      alt={alt}
      width={image.width}
      height={image.height}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : "auto"}
      style={ratio}
      className={className}
    />
  );
}
