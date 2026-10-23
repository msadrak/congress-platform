import type { CSSProperties } from "react";
import { eventAccent } from "../../lib/eventAccent";
import { initialsOf } from "./avatarInitials";

const SIZES = {
  sm: "size-10 text-body-sm",
  md: "size-12 text-body",
  lg: "size-14 text-title-sm",
  xl: "size-20 text-title",
} as const;

export interface AvatarProps {
  name: string;
  /** Stable seed for the tint (a user or connection id); defaults to the name. */
  seed?: string;
  size?: keyof typeof SIZES;
  /** Accent ring (the attendee's own avatar only). */
  ring?: boolean;
  className?: string;
}

/** Initials disc tinted from a stable seed. Decorative: the name is always shown next to it. */
export function Avatar({ name, seed, size = "md", ring = false, className = "" }: AvatarProps) {
  const accent = eventAccent(seed ?? name);
  const style = { "--avatar-accent": accent.accent, "--avatar-soft": accent.soft } as CSSProperties;
  return (
    <span
      aria-hidden="true"
      style={style}
      className={`inline-grid shrink-0 place-items-center rounded-full ${ring ? "bg-(--avatar-accent) p-0.5" : ""} ${SIZES[size]} ${className}`.trim()}
    >
      <span
        className={`grid size-full place-items-center rounded-full bg-(--avatar-soft) font-bold leading-none text-(--avatar-accent) ${ring ? "ring-2 ring-inset ring-white" : ""}`}
      >
        {initialsOf(name)}
      </span>
    </span>
  );
}
