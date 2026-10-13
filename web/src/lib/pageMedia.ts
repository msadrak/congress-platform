import { useEffect, useState } from "react";
import { formatApiError, type MediaAssetOut } from "../api/client";
import type { PageImages } from "./pageDocument";

export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type UploadResult = { ok: true; asset: MediaAssetOut } | { ok: false; status: number; message: string };

/** Sends the raw image bytes; the server decodes, re-encodes and stores them under a generated id. */
export async function uploadPageImage(apiKey: string, eventId: string, file: File): Promise<UploadResult> {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, status: 415, message: "Upload a PNG, JPEG or WebP image" };
  }
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, status: 413, message: "Images are limited to 5 MB" };
  const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": file.type },
    body: file,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, status: response.status, message: formatApiError(body) };
  return { ok: true, asset: body as MediaAssetOut };
}

// Image bytes never change for an id, so one object URL per id serves the whole session.
const objectUrls = new Map<string, Promise<string>>();

function authedObjectUrl(apiKey: string, eventId: string, assetId: string): Promise<string> {
  const key = `${eventId}/${assetId}`;
  let pending = objectUrls.get(key);
  if (!pending) {
    pending = fetch(`/api/events/${encodeURIComponent(eventId)}/media/${encodeURIComponent(assetId)}/content`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    }).then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      return URL.createObjectURL(await response.blob());
    });
    pending.catch(() => objectUrls.delete(key));
    objectUrls.set(key, pending);
  }
  return pending;
}

/**
 * Draft images are private, so `<img src>` cannot load them directly: they are fetched with the
 * organizer key and shown through object URLs. Until one arrives its url is "" (space is still reserved).
 */
export function useOrganizerImages(
  apiKey: string | null,
  eventId: string,
  assets: ReadonlyArray<Pick<MediaAssetOut, "id" | "width" | "height">>,
): PageImages {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const ids = assets.map((a) => a.id).join(",");

  useEffect(() => {
    if (!apiKey || !ids) return;
    let active = true;
    for (const id of ids.split(",")) {
      authedObjectUrl(apiKey, eventId, id)
        .then((url) => {
          if (active) setUrls((current) => (current[id] === url ? current : { ...current, [id]: url }));
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [apiKey, eventId, ids]);

  const images: Record<string, { url: string; width: number; height: number }> = {};
  for (const asset of assets) images[asset.id] = { url: urls[asset.id] ?? "", width: asset.width, height: asset.height };
  return images;
}
