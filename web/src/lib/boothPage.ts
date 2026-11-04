/**
 * The booth page a booth's representatives edit (description, website, brochure; the logo goes through
 * `imageUpload.ts`). The checks mirror the API's (`BoothProfileUpdate`); the API stays the source of truth.
 */
import { apiErrorCode } from "../api/client.ts";

export const BOOTH_DESCRIPTION_MAX = 2000;
export const BOOTH_LINK_MAX = 500;

export type BoothPageField = "description" | "website_url" | "brochure_url";
export type BoothPageDraft = Record<BoothPageField, string>;
export const BOOTH_PAGE_FIELDS: readonly BoothPageField[] = ["description", "website_url", "brochure_url"];

/** Empty, or an absolute http(s) address of at most 500 characters: these become links on the public page. */
export function isWebLink(value: string): boolean {
  const link = value.trim();
  if (!link) return true;
  if (link.length > BOOTH_LINK_MAX || /\s/.test(link) || !URL.canParse(link)) return false;
  const url = new URL(link);
  return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
}

/** The fields the client already knows the API will refuse. */
export function draftProblems(draft: BoothPageDraft): BoothPageField[] {
  const problems: BoothPageField[] = [];
  if (draft.description.trim().length > BOOTH_DESCRIPTION_MAX) problems.push("description");
  for (const field of ["website_url", "brochure_url"] as const) if (!isWebLink(draft[field])) problems.push(field);
  return problems;
}

/** The fields a 422 validation answer names (`detail[].loc = ["body", field]`); empty for any other error. */
export function refusedFields(error: unknown): BoothPageField[] {
  if (typeof error !== "object" || error === null || apiErrorCode(error) !== undefined) return [];
  const detail = (error as { detail?: unknown }).detail;
  if (!Array.isArray(detail)) return [];
  const fields = new Set<BoothPageField>();
  for (const item of detail) {
    const loc: unknown = typeof item === "object" && item !== null ? (item as { loc?: unknown }).loc : undefined;
    const field = Array.isArray(loc) ? loc[loc.length - 1] : undefined;
    if (typeof field === "string" && (BOOTH_PAGE_FIELDS as readonly string[]).includes(field)) fields.add(field as BoothPageField);
  }
  return BOOTH_PAGE_FIELDS.filter((field) => fields.has(field));
}

/** The trimmed draft, as the PATCH body: only the three fields a representative may change. */
export function profileBody(draft: BoothPageDraft): BoothPageDraft {
  return { description: draft.description.trim(), website_url: draft.website_url.trim(), brochure_url: draft.brochure_url.trim() };
}
