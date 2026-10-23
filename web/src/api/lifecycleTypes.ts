// TODO(gen:api): replace with generated types. These mirror the B4 backend models (event lifecycle and
// schedule files) by hand because `npm run gen:api` could not run when they were added; once schema.d.ts is
// regenerated, export them from ./client like the other schema types and delete this module.

/** Default IANA zone of a new event (`backend/app/routes/events.py` DEFAULT_TIMEZONE). */
export const DEFAULT_EVENT_TIMEZONE = "Asia/Tehran";

/** Lifecycle fields added to `EventCreate` / `EventUpdate` / `EventOut` (migration 0024). */
export interface EventLifecycleInput {
  timezone?: string;
  registration_enabled?: boolean;
  registration_opens_at?: string | null;
  registration_closes_at?: string | null;
  listed?: boolean;
}

/** `PublicProgramFile`: a visible schedule file in the public event payload. */
export interface PublicProgramFile {
  id: string;
  label: string;
  kind: "pdf" | "image";
  content_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  page_count: number | null;
  /** Anonymous URL, `/api/public/program-files/{id}`. */
  url: string;
}

/** `ProgramFileOut`: a schedule file as the organizer sees it. */
export interface ProgramFileOut {
  id: string;
  event_id: string;
  label: string;
  kind: "pdf" | "image";
  content_type: string;
  position: number;
  is_visible: boolean;
  byte_size: number;
  width: number | null;
  height: number | null;
  page_count: number | null;
  created_at: string;
  /** Needs the organizer's Authorization header. */
  content_url: string;
}

/** `ProgramFileUpdate`: partial update. */
export interface ProgramFileUpdate {
  label?: string;
  position?: number;
  is_visible?: boolean;
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

/** The event's IANA zone (the server's default for payloads that predate the field). */
export function eventTimeZone(event: object): string {
  return "timezone" in event && typeof event.timezone === "string" && event.timezone ? event.timezone : DEFAULT_EVENT_TIMEZONE;
}
