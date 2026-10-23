/**
 * Organizer console members, roles and the activity log (ADR 0016): wording and the small rules the pages
 * share. The server decides what a role may do (backend/app/roles.py); the console only hides what a role
 * could never use, so a refusal is still answered with ROLE_FORBIDDEN.
 */
import type { AuditEventOut, OrganizerRole } from "../api/client";
import type { AttendeeLocale } from "./i18n";

export const ORGANIZER_ROLES = ["owner", "manager", "staff", "viewer"] as const satisfies readonly OrganizerRole[];

const RANK: Record<OrganizerRole, number> = { viewer: 1, staff: 2, manager: 3, owner: 4 };

export function isOrganizerRole(value: string): value is OrganizerRole {
  return Object.hasOwn(RANK, value);
}

/** True when `role` is `needed` or higher (owner > manager > staff > viewer). */
export function roleAtLeast(role: OrganizerRole | null | undefined, needed: OrganizerRole): boolean {
  return role != null && RANK[role] >= RANK[needed];
}

export const ROLE_COPY: Record<AttendeeLocale, Record<OrganizerRole, { label: string; summary: string }>> = {
  fa: {
    owner: { label: "مالک", summary: "همهٔ کارها، از جمله مدیریت اعضا" },
    manager: { label: "مدیر", summary: "تغییر تنظیمات همایش، شرکت‌کنندگان، خروجی‌ها و گزارش فعالیت" },
    staff: { label: "کارمند", summary: "پذیرش، اسکنر و جست‌وجوی شرکت‌کنندگان" },
    viewer: { label: "ناظر", summary: "دیدن تنظیمات و آمار کلی، بدون اطلاعات شخصی" },
  },
  en: {
    owner: { label: "Owner", summary: "Everything, including managing members" },
    manager: { label: "Manager", summary: "Changes the setup, participants, exports and reads the activity log" },
    staff: { label: "Staff", summary: "Reception, scanners and participant lookup" },
    viewer: { label: "Viewer", summary: "Sees the setup and aggregate analytics, no personal data" },
  },
};

const ACTION_COPY: Record<AttendeeLocale, Record<string, string>> = {
  fa: {
    "member.invited": "عضو اضافه کرد",
    "member.role_changed": "نقش عضو را تغییر داد",
    "member.renamed": "نام عضو را تغییر داد",
    "member.revoked": "عضو را حذف کرد",
    "member.signed_in": "وارد کنسول شد",
    "member.signed_out": "از کنسول خارج شد",
    "organizer.provisioned": "سازمان را ساخت",
    "organizer.key_rotated": "کلید API را عوض کرد",
    "organizer.revoked": "دسترسی سازمان را تعلیق کرد",
    "export.download": "خروجی دریافت کرد",
    "http.post": "ثبت کرد",
    "http.put": "ذخیره کرد",
    "http.patch": "ویرایش کرد",
    "http.delete": "حذف کرد",
  },
  en: {
    "member.invited": "added a member",
    "member.role_changed": "changed a member's role",
    "member.renamed": "renamed a member",
    "member.revoked": "removed a member",
    "member.signed_in": "signed in",
    "member.signed_out": "signed out",
    "organizer.provisioned": "created the organization",
    "organizer.key_rotated": "rotated the API key",
    "organizer.revoked": "suspended the organization",
    "export.download": "downloaded an export",
    "http.post": "created",
    "http.put": "saved",
    "http.patch": "edited",
    "http.delete": "deleted",
  },
};

const ACTOR_COPY: Record<AttendeeLocale, Record<string, string>> = {
  fa: {
    platform_admin: "مدیر پلتفرم",
    organizer_key: "کلید API",
    organizer_member: "عضو",
    desk_operator: "اپراتور پذیرش",
    booth_staff: "نمایندهٔ غرفه",
    system: "سامانه",
  },
  en: {
    platform_admin: "Platform admin",
    organizer_key: "API key",
    organizer_member: "Member",
    desk_operator: "Desk operator",
    booth_staff: "Booth representative",
    system: "System",
  },
};

/** Older spellings of an actor type (early rows, fixtures) → the type the server writes today. */
const ACTOR_ALIASES: Record<string, string> = { member: "organizer_member", api_key: "organizer_key" };

/**
 * Labels the server stores for a credential rather than a person (an actor label, a member's `invited_by`):
 * shown by their localized name, never as the stored English.
 */
const SYSTEM_LABELS: Record<string, string> = {
  "api-key": "organizer_key",
  "api key": "organizer_key",
  "integration key": "organizer_key",
  "platform admin": "platform_admin",
  system: "system",
};

/** Actors that are named people (shown by name, with their kind as a badge). */
export const PERSON_ACTORS: ReadonlySet<string> = new Set(["organizer_member", "desk_operator", "booth_staff"]);

/** True when the row's actor is a named person (members, desk operators, booth representatives). */
export function isPersonActor(rawType: string): boolean {
  return PERSON_ACTORS.has(ACTOR_ALIASES[rawType] ?? rawType);
}

/** Who added a member (`invited_by`): the person's name, or the API key / platform admin in the reader's language. */
export function inviterLabel(invitedBy: string, locale: AttendeeLocale): string {
  const system = SYSTEM_LABELS[invitedBy.trim().toLowerCase()];
  return system ? ACTOR_COPY[locale][system] : invitedBy;
}

/** "Who": the person's name; the platform admin and the API key by their localized role. */
export function activityActor(item: Pick<AuditEventOut, "actor_type" | "actor_label">, locale: AttendeeLocale): string {
  const type = ACTOR_ALIASES[item.actor_type] ?? item.actor_type;
  const system = SYSTEM_LABELS[item.actor_label.trim().toLowerCase()];
  if (system) return ACTOR_COPY[locale][system];
  if (PERSON_ACTORS.has(type)) return item.actor_label || ACTOR_COPY[locale][type];
  return ACTOR_COPY[locale][type] ?? (locale === "fa" ? ACTOR_COPY.fa.system : item.actor_label || item.actor_type);
}

/** The kind of actor, for a badge next to a person's name. */
export function activityActorKind(rawType: string, locale: AttendeeLocale): string {
  const type = ACTOR_ALIASES[rawType] ?? rawType;
  return ACTOR_COPY[locale][type] ?? (locale === "fa" ? ACTOR_COPY.fa.system : rawType);
}

/** A verb for an explicit action; Persian never shows an unknown action's raw name. */
export function activityAction(action: string, locale: AttendeeLocale): string {
  return ACTION_COPY[locale][action] ?? (locale === "fa" ? "تغییری ثبت کرد" : action);
}

const E = "/api/events/{event_id}";
const P = "/api/checkin-points/{point_id}";

/**
 * What an automatic row did, by method and route template (backend/app/roles.py lists every organizer route),
 * as a whole phrase: `[fa, en]`. A route missing here falls back to `ROUTE_NOUNS`.
 */
const ROUTE_LABELS: Record<string, readonly [string, string]> = {
  // Congresses and ticket types
  "POST /api/events": ["همایش تازه‌ای ساخت", "created a congress"],
  [`PATCH ${E}`]: ["تنظیمات همایش را ویرایش کرد", "edited the congress settings"],
  [`POST ${E}/archive`]: ["وضعیت بایگانی همایش را تغییر داد", "archived or unarchived the congress"],
  [`DELETE ${E}`]: ["همایش را حذف کرد", "deleted the congress"],
  [`POST ${E}/ticket-tiers`]: ["نوع کارت ورود تازه‌ای ساخت", "created a ticket type"],
  [`PATCH ${E}/ticket-tiers/{tier_id}`]: ["نوع کارت ورود را ویرایش کرد", "edited a ticket type"],
  [`DELETE ${E}/ticket-tiers/{tier_id}`]: ["نوع کارت ورود را حذف کرد", "deleted a ticket type"],
  // Participants
  [`GET ${E}/participants/export-csv`]: ["فهرست شرکت‌کنندگان را دریافت کرد (CSV)", "downloaded the participant list (CSV)"],
  [`PATCH ${E}/participants/{ticket_id}`]: ["اطلاعات شرکت‌کننده را ویرایش کرد", "edited a participant's details"],
  [`POST ${E}/participants/{ticket_id}/cancel`]: ["کارت ورود شرکت‌کننده را لغو کرد", "cancelled a participant's pass"],
  [`POST ${E}/participants/{ticket_id}/reissue`]: ["کارت ورود شرکت‌کننده را دوباره صادر کرد", "reissued a participant's pass"],
  [`POST ${E}/participants/{ticket_id}/transfer`]: ["کارت ورود را به شخص دیگری منتقل کرد", "transferred a pass to another person"],
  [`DELETE ${E}/participants/{ticket_id}`]: ["شرکت‌کننده را حذف کرد", "deleted a participant"],
  // Check-in points and scanners
  [`POST ${E}/checkin-points`]: ["نقطه ورود تازه‌ای ساخت", "created a check-in point"],
  [`PATCH ${E}/checkin-points/{point_id}`]: ["نقطه ورود را ویرایش کرد", "edited a check-in point"],
  [`POST ${P}/token`]: ["برای نقطه ورود کد جفت‌سازی اسکنر صادر کرد", "issued a scanner pairing code for a check-in point"],
  [`POST ${P}/devices/{device_id}/revoke`]: ["دسترسی یک اسکنر نقطه ورود را لغو کرد", "revoked a scanner of a check-in point"],
  // Reception desk
  [`POST ${E}/desk-registrations`]: ["در پذیرش، شرکت‌کننده‌ای را ثبت‌نام کرد", "registered a walk-in at the desk"],
  [`POST ${E}/attendees/{ticket_id}/resend-sms`]: ["پیامک کارت ورود را دوباره فرستاد", "resent the pass SMS"],
  [`POST ${E}/attendees/qr-lookup`]: ["در پذیرش، کد QR را جست‌وجو کرد", "looked up a QR code at the desk"],
  [`POST ${E}/attendees/{ticket_id}/admit`]: ["در پذیرش، شرکت‌کننده را وارد کرد", "admitted an attendee at the desk"],
  [`POST ${E}/attendees/{ticket_id}/prints`]: ["کارت شرکت‌کننده را چاپ کرد", "printed an attendee's badge"],
  [`PATCH ${E}/attendees/{ticket_id}`]: ["در پذیرش، اطلاعات شرکت‌کننده را ویرایش کرد", "edited an attendee at the desk"],
  [`POST ${E}/attendees/{ticket_id}/cancel`]: ["در پذیرش، کارت ورود را لغو کرد", "cancelled a pass at the desk"],
  [`POST ${E}/attendees/{ticket_id}/reissue`]: ["در پذیرش، کارت ورود را دوباره صادر کرد", "reissued a pass at the desk"],
  [`POST ${E}/attendees/{ticket_id}/transfer`]: ["در پذیرش، کارت ورود را منتقل کرد", "transferred a pass at the desk"],
  [`POST ${E}/desk/operators`]: ["اپراتور پذیرش اضافه کرد", "added a desk operator"],
  [`POST ${E}/desk/operators/{operator_id}/revoke`]: ["دسترسی اپراتور پذیرش را لغو کرد", "revoked a desk operator"],
  [`DELETE ${E}/desk/operators/{operator_id}`]: ["دسترسی اپراتور پذیرش را لغو کرد", "revoked a desk operator"],
  [`POST ${E}/desk/operators/{operator_id}/restore`]: ["دسترسی اپراتور پذیرش را بازگرداند", "restored a desk operator"],
  // Analytics exports
  [`GET ${E}/analytics/export-csv`]: ["گزارش ترددها را دریافت کرد (CSV)", "downloaded the attendance report (CSV)"],
  [`GET ${E}/analytics/registrations-csv`]: ["گزارش ثبت‌نام‌ها را دریافت کرد (CSV)", "downloaded the registrations report (CSV)"],
  // Booths
  [`POST ${E}/booths`]: ["غرفهٔ تازه‌ای ساخت", "created a booth"],
  [`PATCH ${E}/booths/{booth_id}`]: ["غرفه را ویرایش کرد", "edited a booth"],
  [`DELETE ${E}/booths/{booth_id}`]: ["غرفه را حذف کرد", "deleted a booth"],
  [`POST ${E}/booths/{booth_id}/staff`]: ["نمایندهٔ غرفه اضافه کرد", "added a booth representative"],
  [`DELETE ${E}/booths/{booth_id}/staff/{staff_id}`]: ["نمایندهٔ غرفه را حذف کرد", "removed a booth representative"],
  "GET /api/booths/{booth_id}/leads/export-csv": ["فهرست لیدهای غرفه را دریافت کرد (CSV)", "downloaded the booth's leads (CSV)"],
  // Public page and media
  [`PUT ${E}/page`]: ["پیش‌نویس صفحهٔ همایش را ذخیره کرد", "saved the congress page draft"],
  [`POST ${E}/page/publish`]: ["صفحهٔ همایش را منتشر کرد", "published the congress page"],
  [`POST ${E}/page/unpublish`]: ["انتشار صفحهٔ همایش را متوقف کرد", "unpublished the congress page"],
  [`POST ${E}/page/discard`]: ["پیش‌نویس صفحهٔ همایش را کنار گذاشت", "discarded the congress page draft"],
  [`POST ${E}/media`]: ["تصویری بارگذاری کرد", "uploaded an image"],
  [`DELETE ${E}/media/{asset_id}`]: ["تصویری را حذف کرد", "deleted an image"],
  // Program and venue
  [`POST ${E}/venue-places`]: ["مکان تازه‌ای به محل همایش افزود", "added a venue place"],
  [`PATCH ${E}/venue-places/{place_id}`]: ["مکانی از محل همایش را ویرایش کرد", "edited a venue place"],
  [`DELETE ${E}/venue-places/{place_id}`]: ["مکانی از محل همایش را حذف کرد", "deleted a venue place"],
  [`POST ${E}/sessions`]: ["جلسهٔ تازه‌ای به برنامه افزود", "added a program session"],
  [`POST ${E}/sessions/import`]: ["برنامه را از فایل وارد کرد", "imported the program from a file"],
  [`PATCH ${E}/sessions/{session_id}`]: ["جلسه‌ای از برنامه را ویرایش کرد", "edited a program session"],
  [`DELETE ${E}/sessions/{session_id}`]: ["جلسه‌ای از برنامه را حذف کرد", "deleted a program session"],
  [`POST ${E}/program-files`]: ["فایل برنامه بارگذاری کرد", "uploaded a schedule file"],
  [`PATCH ${E}/program-files/{file_id}`]: ["فایل برنامه را ویرایش کرد", "edited a schedule file"],
  [`DELETE ${E}/program-files/{file_id}`]: ["فایل برنامه را حذف کرد", "deleted a schedule file"],
  // SMS
  [`PUT ${E}/sms/templates/{kind}`]: ["متن پیامک را تغییر داد", "changed an SMS text"],
  [`DELETE ${E}/sms/templates/{kind}`]: ["متن پیامک را به متن پیش‌فرض برگرداند", "reset an SMS text to the default"],
  [`POST ${E}/sms/test`]: ["پیامک آزمایشی فرستاد", "sent a test SMS"],
  [`POST ${E}/sms/messages/{message_id}/retry`]: ["پیامکی را دوباره فرستاد", "resent an SMS"],
  [`POST ${E}/sms/messages/{message_id}/resolve`]: ["پیامکی را حل‌شده علامت زد", "marked an SMS as resolved"],
};

/** What a route segment is about, for routes without a label of their own: `[fa, en]`. */
const ROUTE_NOUNS: Record<string, readonly [string, string]> = {
  events: ["همایش", "congress"],
  "ticket-tiers": ["نوع کارت ورود", "ticket type"],
  participants: ["شرکت‌کننده", "participant"],
  attendees: ["شرکت‌کننده", "attendee"],
  "checkin-points": ["نقطه ورود", "check-in point"],
  devices: ["اسکنر", "scanner"],
  desk: ["پذیرش", "reception desk"],
  "desk-registrations": ["ثبت‌نام در پذیرش", "desk registration"],
  operators: ["اپراتور پذیرش", "desk operator"],
  booths: ["غرفه", "booth"],
  staff: ["نمایندهٔ غرفه", "booth representative"],
  leads: ["لید غرفه", "booth lead"],
  page: ["صفحهٔ همایش", "congress page"],
  media: ["تصویر", "image"],
  "venue-places": ["مکان", "venue place"],
  sessions: ["جلسه", "program session"],
  "program-files": ["فایل برنامه", "schedule file"],
  sms: ["پیامک", "SMS"],
  templates: ["متن پیامک", "SMS text"],
  messages: ["پیامک", "SMS"],
  members: ["عضو", "member"],
  analytics: ["آمار", "analytics"],
};

/** Persian for an automatic row whose route names nothing the tables know. */
const FA_UNNAMED: Record<string, string> = {
  "http.post": "موردی را ثبت کرد",
  "http.put": "موردی را ذخیره کرد",
  "http.patch": "موردی را ویرایش کرد",
  "http.delete": "موردی را حذف کرد",
};

/** The phrase of an automatic row (`http.*`, `export.download`) from its route template. */
function routePhrase(action: string, route: string, locale: AttendeeLocale): string {
  const method = action === "export.download" ? "GET" : action.replace(/^http\./, "").toUpperCase();
  const index = locale === "fa" ? 0 : 1;
  const labelled = ROUTE_LABELS[`${method} ${route}`];
  if (labelled) return labelled[index];
  const segments = route
    .replace(/^\/api\//, "")
    .split("/")
    .filter((part) => part && !part.startsWith("{"));
  // The most specific segment the table knows names the subject (".../checkin-points/{id}/heartbeat" → check-in
  // point). "events" only names a route of its own: under it, an unknown child is not the congress itself.
  const known = [...segments]
    .reverse()
    .find((part) => Object.hasOwn(ROUTE_NOUNS, part) && (part !== "events" || segments.length === 1));
  const verb = activityAction(action, locale);
  if (known) return `${verb} · ${ROUTE_NOUNS[known][index]}`;
  // A Persian reader never sees a raw route; an English one gets its words.
  return locale === "fa" ? (FA_UNNAMED[action] ?? verb) : `${verb} · ${segments.join(" › ").replace(/-/g, " ")}`;
}

/**
 * One activity row after the actor, in the reader's language: `action` is what was done (for an automatic row,
 * a phrase from its route template, never the template itself), `target` the names it is about (a member's
 * name and role change), shown as user content.
 */
export function describeActivity(
  item: Pick<AuditEventOut, "action" | "summary">,
  locale: AttendeeLocale,
): { action: string; target: string } {
  const text = (key: string) => {
    const value = item.summary[key];
    return typeof value === "string" ? value : "";
  };
  const role = (key: string) => {
    const value = text(key);
    return isOrganizerRole(value) ? ROLE_COPY[locale][value].label : value;
  };
  const route = text("route");
  if (route && (item.action.startsWith("http.") || item.action === "export.download")) {
    return { action: routePhrase(item.action, route, locale), target: "" };
  }
  const action = activityAction(item.action, locale);
  if (item.action === "member.role_changed") return { action, target: `${text("display_name")}: ${role("from")} → ${role("to")}` };
  if (item.action === "member.invited") return { action, target: `${text("display_name")} (${role("role")})` };
  if (item.action === "member.revoked") return { action, target: text("display_name") };
  if (item.action === "member.renamed") return { action, target: `${text("from")} → ${text("to")}` };
  return { action, target: "" };
}

/** Date and time of an activity entry in the reader's calendar (Persian calendar for fa). */
export function formatActivityTime(iso: string, locale: AttendeeLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export const CONSOLE_COPY = {
  fa: {
    membersNav: "اعضا",
    activityNav: "گزارش فعالیت",
    membersEyebrow: "سازمان",
    membersTitle: "اعضای سازمان",
    membersDesc:
      "هر عضو با شماره موبایل خود و کد پیامکی وارد کنسول می‌شود و فقط کارهایی را می‌بیند که نقشش اجازه می‌دهد. کلید API برای یکپارچه‌سازی است و نقش مالک دارد.",
    inviteAction: "افزودن عضو",
    inviteTitle: "افزودن عضو",
    inviteDesc: "پیامکی با نشانی کنسول برای این شماره فرستاده می‌شود.",
    nameLabel: "نام",
    mobileLabel: "شماره موبایل",
    roleLabel: "نقش",
    nameRequired: "نام عضو را وارد کنید.",
    mobileInvalid: "یک شماره موبایل معتبر وارد کنید؛ مثلاً ۰۹۱۲ ۳۴۵ ۶۷۸۹.",
    inviteSubmit: "افزودن و ارسال پیامک",
    inviting: "در حال افزودن…",
    invited: (name: string) => `${name} اضافه شد و پیامک ورود برایش فرستاده می‌شود.`,
    roleSaved: (name: string) => `نقش ${name} تغییر کرد؛ باید دوباره وارد شود.`,
    removed: (name: string) => `${name} حذف شد و نشست‌هایش بسته شد.`,
    removeAction: "حذف",
    removeTitle: "حذف عضو؟",
    removeDesc: (name: string) => `${name} دیگر نمی‌تواند وارد کنسول شود و نشست‌های فعالش بسته می‌شود.`,
    cancel: "انصراف",
    active: "فعال",
    removedStatus: "حذف‌شده",
    invitedBy: (who: string) => `افزوده‌شده به دست ${who}`,
    you: "شما",
    noMembers: "هنوز عضوی ندارید",
    noMembersBody: "اعضا را اضافه کنید تا به‌جای کلید مشترک، هر کس با شمارهٔ خودش و نقش مشخص وارد شود.",
    roleChangeLabel: (name: string) => `نقش ${name}`,
    readOnly: "فقط مالک‌ها می‌توانند اعضا را اضافه، حذف یا نقششان را عوض کنند.",
    loadFailed: "فهرست اعضا بارگیری نشد.",
    retry: "تلاش دوباره",
    activityTitle: "گزارش فعالیت",
    activityDesc:
      "چه کسی، چه زمانی، چه کاری کرد: تغییرات کنسول، کار اپراتورهای پذیرش، دریافت خروجی‌ها و اقدام‌های مدیر پلتفرم روی این سازمان. این گزارش قابل ویرایش یا حذف نیست.",
    allEvents: "همهٔ همایش‌ها",
    eventFilter: "همایش",
    noActivity: "هنوز فعالیتی ثبت نشده است",
    loadMore: "موارد قدیمی‌تر",
    loading: "در حال بارگیری…",
    when: "زمان",
    who: "چه کسی",
    what: "چه کاری",
    where: "از کجا",
    activityLoadFailed: "گزارش فعالیت بارگیری نشد.",
  },
  en: {
    membersNav: "Members",
    activityNav: "Activity",
    membersEyebrow: "Organization",
    membersTitle: "Members",
    membersDesc:
      "Each member signs in to the console with their own mobile number and an SMS code, and sees only what their role allows. The API key is for integrations and acts as an owner.",
    inviteAction: "Add member",
    inviteTitle: "Add a member",
    inviteDesc: "An SMS with the console address is sent to this number.",
    nameLabel: "Name",
    mobileLabel: "Mobile number",
    roleLabel: "Role",
    nameRequired: "Enter the member's name.",
    mobileInvalid: "Enter a valid mobile number, e.g. 0912 345 6789.",
    inviteSubmit: "Add and send SMS",
    inviting: "Adding…",
    invited: (name: string) => `${name} was added and will receive a sign-in SMS.`,
    roleSaved: (name: string) => `${name}'s role changed; they need to sign in again.`,
    removed: (name: string) => `${name} was removed and signed out.`,
    removeAction: "Remove",
    removeTitle: "Remove member?",
    removeDesc: (name: string) => `${name} will no longer be able to sign in, and any active session ends.`,
    cancel: "Cancel",
    active: "Active",
    removedStatus: "Removed",
    invitedBy: (who: string) => `Added by ${who}`,
    you: "You",
    noMembers: "No members yet",
    noMembersBody: "Add members so that each person signs in with their own number and role instead of a shared key.",
    roleChangeLabel: (name: string) => `Role of ${name}`,
    readOnly: "Only owners can add or remove members or change their roles.",
    loadFailed: "The member list could not be loaded.",
    retry: "Try again",
    activityTitle: "Activity",
    activityDesc:
      "Who did what, and when: console changes, reception operators, export downloads and what the platform admin did to this organization. Entries cannot be edited or deleted.",
    allEvents: "All congresses",
    eventFilter: "Congress",
    noActivity: "No activity recorded yet",
    loadMore: "Older entries",
    loading: "Loading…",
    when: "When",
    who: "Who",
    what: "What",
    where: "From",
    activityLoadFailed: "The activity log could not be loaded.",
  },
} as const;

export const SIGN_IN_COPY = {
  fa: {
    mobileTab: "ورود با موبایل",
    keyTab: "کلید API",
    modeLabel: "روش ورود",
    mobileTitle: "ورود به کنسول برگزارکننده",
    mobileDesc: "با شماره موبایلی که مالک سازمان برای شما ثبت کرده است وارد شوید.",
    verify: "ورود",
    chooseTitle: "کدام سازمان؟",
    chooseDesc: "این شماره عضو چند سازمان است. سازمانی را که می‌خواهید مدیریت کنید انتخاب کنید.",
    keyHint: "کلید API برای یکپارچه‌سازی‌ها و مدیر فنی است و نقش مالک دارد.",
    codeInvalid: "کد نادرست است یا منقضی شده است.",
    signedInAs: "واردشده با نقش",
  },
  en: {
    mobileTab: "Mobile sign-in",
    keyTab: "API key",
    modeLabel: "Sign-in method",
    mobileTitle: "Sign in to the organizer console",
    mobileDesc: "Use the mobile number your organization's owner registered for you.",
    verify: "Sign in",
    chooseTitle: "Which organization?",
    chooseDesc: "This number belongs to several organizations. Choose the one to manage.",
    keyHint: "The API key is meant for integrations and technical administrators, and acts as an owner.",
    codeInvalid: "The code is wrong or has expired.",
    signedInAs: "Signed in as",
  },
} as const;
