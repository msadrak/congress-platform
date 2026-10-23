import { Avatar, type AvatarProps } from "../ui/Avatar";

/** Deprecated: the attendee's initials disc is `ui/Avatar` with its accent ring (UX-Z removes this wrapper). */
export function Monogram(props: Omit<AvatarProps, "ring">) {
  return <Avatar {...props} ring />;
}
