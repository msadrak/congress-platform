/**
 * Schedule files (the congress program as a PDF or an image) for the organizer console. Uploads send the raw
 * bytes with their Content-Type, as Page Studio images do; the server checks PDFs, re-encodes images and
 * stores both under generated names. Failures carry a code the screen maps to localized copy.
 *
 * Uses `fetch` rather than the openapi-fetch client because the upload body is the file itself, not JSON;
 * the shapes are the generated schema types.
 */

import { apiErrorCode, formatApiError, type ProgramFileOut, type ProgramFileUpdate, type PublicProgramFile } from "../api/client.ts";

export const PROGRAM_FILE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;
/** The API's (and the edge's) limit: 8,000,000 bytes. */
export const MAX_PROGRAM_FILE_BYTES = 8_000_000;
export const MAX_PROGRAM_FILES = 20;
export const MAX_PROGRAM_FILE_LABEL = 120;

export type ProgramFileErrorCode =
  | "unsupported_type"
  | "too_large"
  | "empty"
  | "rejected_pdf"
  | "rejected_image"
  | "label_required"
  | "limit_reached"
  | "archived"
  | "not_found"
  | "unauthorized"
  | "network"
  | "server";

/** Narrow with `"code" in result` (the app's tsconfig is not strict, so `ok` alone does not narrow). */
export type ProgramFileResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ProgramFileErrorCode; status: number; detail: string };

/** The screen's code for each stable API error code (backend/app/routes/program_files.py and events.py). */
const API_CODES: Record<string, ProgramFileErrorCode> = {
  PROGRAM_FILE_TYPE_UNSUPPORTED: "unsupported_type",
  PROGRAM_FILE_TOO_LARGE: "too_large",
  PROGRAM_FILE_EMPTY: "empty",
  PROGRAM_FILE_PDF_REJECTED: "rejected_pdf",
  PROGRAM_FILE_IMAGE_REJECTED: "rejected_image",
  PROGRAM_FILE_LABEL_REQUIRED: "label_required",
  PROGRAM_FILE_LIMIT_REACHED: "limit_reached",
  PROGRAM_FILE_NOT_FOUND: "not_found",
  EVENT_ARCHIVED: "archived",
  EVENT_NOT_FOUND: "not_found",
};

/**
 * Maps a failed response to a code: by the API's stable error code when it sent one, otherwise by status
 * (the edge answers 413 itself, without a code). `upload` tells 415s apart, which only uploads can return.
 */
export function programFileErrorCode(status: number, apiCode: string | undefined, upload?: { contentType: string }): ProgramFileErrorCode {
  if (apiCode !== undefined && Object.hasOwn(API_CODES, apiCode)) return API_CODES[apiCode];
  switch (status) {
    case 0:
      return "network";
    case 400:
      return upload ? "empty" : "server";
    case 401:
    case 403:
      return "unauthorized";
    case 404:
      return "not_found";
    case 413:
      return "too_large";
    case 415:
      if (!upload || !(PROGRAM_FILE_TYPES as readonly string[]).includes(upload.contentType)) return "unsupported_type";
      return upload.contentType === "application/pdf" ? "rejected_pdf" : "rejected_image";
    case 422:
      return upload ? "label_required" : "server";
    default:
      return "server";
  }
}

/** Client-side checks before any byte is sent; null when the file may be uploaded. */
export function precheckProgramFile(file: { type: string; size: number }, label: string): ProgramFileErrorCode | null {
  if (!label.trim()) return "label_required";
  if (!(PROGRAM_FILE_TYPES as readonly string[]).includes(file.type)) return "unsupported_type";
  if (file.size === 0) return "empty";
  if (file.size > MAX_PROGRAM_FILE_BYTES) return "too_large";
  return null;
}

/** "Day 1 programme.pdf" → "Day 1 programme": a starting label for the chosen file. */
export function labelFromFileName(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[_]+/g, " ").trim().slice(0, MAX_PROGRAM_FILE_LABEL);
}

const base = (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/program-files`;

async function request<T>(
  apiKey: string,
  url: string,
  init: RequestInit,
  parse: (body: unknown) => T,
  upload?: { contentType: string },
): Promise<ProgramFileResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${apiKey}` } });
  } catch {
    return { ok: false, code: "network", status: 0, detail: "" };
  }
  const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const detail = formatApiError(body);
    return { ok: false, code: programFileErrorCode(response.status, apiErrorCode(body), upload), status: response.status, detail };
  }
  return { ok: true, value: parse(body) };
}

// The server's response shapes are trusted as typed here, as openapi-fetch trusts the generated ones.
const asFile = (body: unknown) => body as ProgramFileOut;
const asFiles = (body: unknown) => (Array.isArray(body) ? (body as ProgramFileOut[]) : []);

export function listProgramFiles(apiKey: string, eventId: string): Promise<ProgramFileResult<ProgramFileOut[]>> {
  return request(apiKey, base(eventId), {}, asFiles);
}

export function uploadProgramFile(apiKey: string, eventId: string, file: File, label: string): Promise<ProgramFileResult<ProgramFileOut>> {
  const url = `${base(eventId)}?label=${encodeURIComponent(label.trim())}`;
  return request(apiKey, url, { method: "POST", headers: { "Content-Type": file.type }, body: file }, asFile, { contentType: file.type });
}

export function updateProgramFile(
  apiKey: string,
  eventId: string,
  fileId: string,
  patch: ProgramFileUpdate,
): Promise<ProgramFileResult<ProgramFileOut>> {
  return request(
    apiKey,
    `${base(eventId)}/${encodeURIComponent(fileId)}`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) },
    asFile,
  );
}

export function deleteProgramFile(apiKey: string, eventId: string, fileId: string): Promise<ProgramFileResult<null>> {
  return request(apiKey, `${base(eventId)}/${encodeURIComponent(fileId)}`, { method: "DELETE" }, () => null);
}

/** The organizer's copy of the file as an object URL (the content endpoint needs the Authorization header). */
export async function programFileObjectUrl(apiKey: string, item: Pick<ProgramFileOut, "content_url">): Promise<string | null> {
  try {
    const response = await fetch(item.content_url, { headers: { Authorization: `Bearer ${apiKey}` } });
    return response.ok ? URL.createObjectURL(await response.blob()) : null;
  } catch {
    return null;
  }
}

/**
 * The positions that put `files` in the order of `ids`: only the files whose position changes are listed,
 * so a move costs one or two PATCHes once positions are distinct.
 */
export function reorderPatches(files: readonly Pick<ProgramFileOut, "id" | "position">[], ids: readonly string[]): { id: string; position: number }[] {
  const current: Record<string, number> = {};
  for (const file of files) current[file.id] = file.position;
  return ids.flatMap((id, position) => (current[id] === position ? [] : [{ id, position }]));
}

function isProgramFile(value: unknown): value is PublicProgramFile {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "url" in value &&
    "kind" in value &&
    typeof value.id === "string" &&
    typeof value.url === "string" &&
    (value.kind === "pdf" || value.kind === "image")
  );
}

/** The visible schedule files of a public event payload (absent from payloads of older servers). */
export function programFilesOf(event: object): PublicProgramFile[] {
  if (!("program_files" in event) || !Array.isArray(event.program_files)) return [];
  return event.program_files.filter(isProgramFile);
}

/** "1.2 MB" / "۱٫۲ مگابایت". */
export function formatFileSize(bytes: number, locale: "fa" | "en"): string {
  const tag = locale === "fa" ? "fa-IR" : "en-GB";
  const [value, unit] = bytes >= 1_000_000 ? [bytes / 1_000_000, locale === "fa" ? "مگابایت" : "MB"] : [Math.max(1, Math.round(bytes / 1000)), locale === "fa" ? "کیلوبایت" : "KB"];
  return `${new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }).format(value)} ${unit}`;
}
