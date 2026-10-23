import { useState } from "react";

const SIZES = {
  /** Booth directory rows. */
  row: { box: "size-10", px: 40 },
  /** Organizer booth cards. */
  card: { box: "size-12", px: 48 },
  /** The public booth page's header and the booth page editor. */
  header: { box: "size-16", px: 64 },
} as const;

interface BoothLogoProps {
  src: string | null | undefined;
  /** The booth's name. */
  alt: string;
  size: keyof typeof SIZES;
  /** Lists load logos as they scroll into view. */
  lazy?: boolean;
  className?: string;
  /** Called when the image cannot be shown (for example the congress page is not published yet). */
  onUnavailable?: () => void;
}

/**
 * A booth's logo: a square on a neutral surface, the whole image visible (`object-fit: contain`). Nothing is drawn
 * without a logo, or when it fails to load, so the text beside it simply starts at the edge.
 */
export function BoothLogo({ src, alt, size, lazy = false, className = "", onUnavailable }: BoothLogoProps) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return null;
  const { box, px } = SIZES[size];
  return (
    <img
      src={src}
      alt={alt}
      width={px}
      height={px}
      loading={lazy ? "lazy" : undefined}
      decoding="async"
      onError={() => {
        setFailed(src);
        onUnavailable?.();
      }}
      className={`${box} shrink-0 rounded-control border border-border-default bg-white object-contain p-1 ${className}`.trim()}
    />
  );
}
