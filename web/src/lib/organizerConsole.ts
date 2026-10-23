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

/**
 * Whether the console offers an action that needs `needed` to this session. The API key session is the owner.
 * While the session is unknown (/api/organizer/me has not answered, or failed) the action is offered: an owner
 * never sees their controls vanish, and the server still refuses a lower role with ROLE_FORBIDDEN. The same holds for
 * an answer without a known role.
 */
export function sessionAllows(session: { role: OrganizerRole } | null | undefined, needed: OrganizerRole): boolean {
  // A body that is not a session (no known role) is as good as no answer.
  if (session == null || typeof session.role !== "string" || !isOrganizerRole(session.role)) return true;
  return roleAtLeast(session.role, needed);
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
    organizer_key: "کلید یکپارچه‌سازی",
    organizer_member: "عضو",
    desk_operator: "اپراتور پذیرش",
    booth_staff: "نمایندهٔ غرفه",
    system: "سامانه",
  },
  en: {
    platform_admin: "Platform admin",
    organizer_key: "Integration key",
    organizer_member: "Member",
    desk_operator: "Desk operator",
    booth_staff: "Booth representative",
    system: "System",
  },
};

/** Actors that are named people (shown by name, with their kind as a badge). */
export const PERSON_ACTORS: ReadonlySet<string> = new Set(["organizer_member", "desk_operator", "booth_staff"]);

/** "Who": the person's name; the platform admin and the API key by their localized role. */
export function activityActor(item: Pick<AuditEventOut, "actor_type" | "actor_label">, locale: AttendeeLocale): string {
  if (PERSON_ACTORS.has(item.actor_type)) {
    return item.actor_label || ACTOR_COPY[locale][item.actor_type];
  }
  return ACTOR_COPY[locale][item.actor_type] ?? item.actor_label;
}

/** The kind of actor, for a badge next to a person's name. */
export function activityActorKind(actorType: string, locale: AttendeeLocale): string {
  return ACTOR_COPY[locale][actorType] ?? actorType;
}

/** "What": a localized verb for known actions, the raw action otherwise. */
export function activityAction(action: string, locale: AttendeeLocale): string {
  return ACTION_COPY[locale][action] ?? action;
}

/**
 * "On what": the route template of an automatic row without the `/api` prefix and path parameters
 * (`/api/events/{event_id}/booths/{booth_id}` → `events › booths`), or the member's name and role change.
 */
export function activityTarget(item: Pick<AuditEventOut, "action" | "summary">, locale: AttendeeLocale): string {
  const text = (key: string) => {
    const value = item.summary[key];
    return typeof value === "string" ? value : "";
  };
  const role = (key: string) => {
    const value = text(key);
    return isOrganizerRole(value) ? ROLE_COPY[locale][value].label : value;
  };
  if (item.action === "member.role_changed") return `${text("display_name")}: ${role("from")} → ${role("to")}`;
  if (item.action === "member.invited") return `${text("display_name")} (${role("role")})`;
  if (item.action === "member.revoked") return text("display_name");
  if (item.action === "member.renamed") return `${text("from")} → ${text("to")}`;
  const route = text("route");
  if (!route) return "";
  return route
    .replace(/^\/api\//, "")
    .split("/")
    .filter((part) => part && !part.startsWith("{"))
    .join(" › ");
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
