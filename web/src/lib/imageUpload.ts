/**
 * The image intake's limits on the client (Page Studio, booth logos). The server decodes, re-encodes and checks
 * every upload and stays the source of truth; these checks only spare a pointless upload and word the reason.
 */
export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
/** The API's default `media_max_bytes`. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** For `<input type="file" accept>`. */
export const IMAGE_ACCEPT = ACCEPTED_IMAGE_TYPES.join(",");

/** Why a picked file will not be accepted: its type, its size, or null when it may be sent. */
export function imageFileProblem(file: { type: string; size: number }): "type" | "size" | "empty" | null {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) return "type";
  if (file.size === 0) return "empty";
  if (file.size > MAX_IMAGE_BYTES) return "size";
  return null;
}
