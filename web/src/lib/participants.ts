/**
 * Organizer participants register: copy (fa/en) and the pure helpers behind the page.
 * The page edits a registration's own details for one congress, never the person's shared account.
 */
import { normalizeIranMobile } from "./mobile.ts";

export type ParticipantStatusFilter = "" | "active" | "cancelled";

export interface ParticipantListState {
  q: string;
  tierId: string;
  status: ParticipantStatusFilter;
  page: number;
  pageSize: number;
}

/** Query parameters for GET /participants (and its CSV export): empty filters are left out. */
export function participantListQuery(state: ParticipantListState): {
  q?: string;
  tier_id?: string;
  status?: "active" | "cancelled";
  limit: number;
  offset: number;
} {
  const q = state.q.trim();
  return {
    ...(q ? { q } : {}),
    ...(state.tierId ? { tier_id: state.tierId } : {}),
    ...(state.status ? { status: state.status } : {}),
    limit: state.pageSize,
    offset: Math.max(0, state.page) * state.pageSize,
  };
}

/** 1-based range shown under the table ("21–40 of 57") and whether the pager buttons apply. */
export function pageRange(offset: number, shown: number, total: number): { from: number; to: number; hasPrev: boolean; hasNext: boolean } {
  return {
    from: shown === 0 ? 0 : offset + 1,
    to: offset + shown,
    hasPrev: offset > 0,
    hasNext: offset + shown < total,
  };
}

/** Last page that still has rows after the total shrank (a cancel filter, a delete). */
export function clampPage(page: number, pageSize: number, total: number): number {
  const last = Math.max(0, Math.ceil(total / pageSize) - 1);
  return Math.min(Math.max(0, page), last);
}

export type TransferProblem = "mobileInvalid" | "nameRequired";

/** First problem in the transfer form; `fullName` may be empty when the number already has an account. */
export function transferProblem(form: { mobile: string; fullName: string }, nameRequired: boolean): TransferProblem | null {
  if (!normalizeIranMobile(form.mobile)) return "mobileInvalid";
  if (nameRequired && !form.fullName.trim()) return "nameRequired";
  return null;
}

/** Fill `{name}` tokens in a copy string. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (token, key: string) => (key in values ? String(values[key]) : token));
}

const fa = {
  navLabel: "شرکت‌کنندگان",
  title: "شرکت‌کنندگان",
  description:
    "ثبت‌نام‌های این همایش. ویرایش در این صفحه فقط اطلاعات ثبت‌نام همین همایش را تغییر می‌دهد؛ حساب شخص در همایش‌های دیگر دست نمی‌خورد.",
  searchLabel: "جستجو",
  searchPlaceholder: "نام، موبایل یا سازمان",
  tierFilter: "نوع بلیت",
  statusFilter: "وضعیت",
  all: "همه",
  statusActive: "فعال",
  statusCancelled: "لغوشده",
  exportCsv: "خروجی CSV",
  exporting: "در حال آماده‌سازی…",
  csvError: "دریافت فایل CSV انجام نشد.",
  colName: "شرکت‌کننده",
  colMobile: "موبایل",
  colTier: "نوع بلیت",
  colStatus: "وضعیت",
  colRegistered: "ثبت‌نام",
  colActions: "عملیات",
  noMobile: "بدون موبایل",
  accountDeleted: "حساب حذف شده",
  edit: "ویرایش",
  manage: "مدیریت",
  range: "{from} تا {to} از {total}",
  prev: "قبلی",
  next: "بعدی",
  emptyTitle: "هنوز کسی در این همایش ثبت‌نام نکرده است.",
  emptyBody: "ثبت‌نام‌های صفحهٔ عمومی همایش و میز پذیرش در این فهرست نمایش داده می‌شوند.",
  noResults: "شرکت‌کننده‌ای با این جستجو و فیلترها پیدا نشد.",
  clearFilters: "پاک کردن فیلترها",
  loading: "در حال بارگذاری شرکت‌کنندگان",
  loadError: "فهرست شرکت‌کنندگان بارگذاری نشد.",
  networkError: "اتصال به سرور برقرار نشد.",
  retry: "تلاش دوباره",
  dismiss: "بستن پیام",
  close: "بستن",
  back: "انصراف",
  save: "ذخیره",
  saving: "در حال ذخیره…",
  editTitle: "ویرایش اطلاعات ثبت‌نام",
  editDescription: "این تغییر فقط برای همین همایش است؛ حساب شخص و ثبت‌نام‌های او در همایش‌های دیگر تغییر نمی‌کند.",
  fullName: "نام و نام خانوادگی",
  organization: "سازمان",
  jobTitle: "سمت",
  nameRequired: "نام را وارد کنید.",
  detailTitle: "مدیریت ثبت‌نام",
  registeredAt: "تاریخ ثبت‌نام",
  checkins: "تعداد ورود",
  leads: "ثبت در غرفه‌ها",
  issuedBy: "صادرشده در پذیرش توسط",
  cancelledAt: "تاریخ لغو",
  cancelReason: "دلیل لغو",
  cancelledBy: "لغو توسط",
  reissuedAt: "آخرین صدور دوباره",
  actorOrganizer: "برگزارکننده",
  actorAttendee: "خود شرکت‌کننده",
  actorAccountDeleted: "حذف حساب کاربری",
  reasonTransferred: "انتقال به شخص دیگر",
  cancelTicket: "لغو بلیت",
  cancelTitle: "این بلیت لغو شود؟",
  cancelDescription: "کارت ورود و کد QR این بلیت دیگر معتبر نیست و ظرفیت آن به نوع بلیت برمی‌گردد.",
  reason: "دلیل (اختیاری)",
  notify: "پیامک لغو برای شرکت‌کننده ارسال شود",
  notifyReissue: "پیوند کارت ورود جدید پیامک شود",
  confirmCancel: "لغو بلیت",
  reissue: "صدور دوبارهٔ کارت ورود",
  reissueTitle: "کارت ورود دوباره صادر شود؟",
  reissueDescription: "یک کد QR تازه ساخته می‌شود و کارت ورود قبلی دیگر در گیت کار نمی‌کند.",
  confirmReissue: "صدور دوباره",
  transfer: "انتقال بلیت",
  transferTitle: "انتقال بلیت به شخص دیگر",
  transferDescription:
    "بلیت فعلی لغو و جایگاه آن به صاحب این شمارهٔ موبایل داده می‌شود. کارت ورود تازه برای او پیامک می‌شود و سوابق ورود قبلی برای شخص قبلی باقی می‌ماند.",
  newMobile: "موبایل دارندهٔ جدید",
  transferNameHint: "اگر این شماره در سامانه حساب دارد، می‌توانید نام را خالی بگذارید.",
  mobileInvalid: "شمارهٔ موبایل معتبر نیست؛ مثلاً ۰۹۱۲۱۲۳۴۵۶۷.",
  confirmTransfer: "انتقال",
  delete: "حذف ثبت‌نام",
  deleteTitle: "این ثبت‌نام حذف شود؟",
  deleteDescription: "فقط برای ثبت‌نامی که اشتباه انجام شده است. ثبت‌نام و کارت ورود آن برای همیشه پاک می‌شود.",
  deleteBlocked: "این شرکت‌کننده سابقهٔ ورود یا ثبت در غرفه دارد و حذف نمی‌شود؛ به‌جای آن بلیت را لغو کنید.",
  confirmDelete: "حذف برای همیشه",
  saved: "اطلاعات ثبت‌نام ذخیره شد.",
  cancelled: "بلیت لغو شد.",
  reissued: "کارت ورود دوباره صادر شد.",
  transferred: "بلیت به {name} منتقل شد.",
  deleted: "ثبت‌نام حذف شد.",
  filters: "فیلتر شرکت‌کنندگان",
  results: "{total} شرکت‌کننده",
  scanHistory: "سوابق اسکن کارت ورود",
  noScans: "این کارت ورود هنوز در هیچ گیتی اسکن نشده است.",
  scanAdmitted: "پذیرفته شد",
  scanRejected: "رد شد",
  detailLoadError: "جزئیات این ثبت‌نام بارگذاری نشد.",
  passInactive: "کارت ورود و کد QR این بلیت دیگر معتبر نیست.",
  transferNeedsName: "این شماره هنوز در سامانه حساب ندارد؛ نام دارندهٔ جدید را وارد کنید.",
  optionalDetails: "اطلاعات دارندهٔ جدید (اختیاری)",
  actionError: "این کار انجام نشد. دوباره تلاش کنید.",
};

export type ParticipantsCopy = typeof fa;

const en: ParticipantsCopy = {
  navLabel: "Participants",
  title: "Participants",
  description:
    "Everyone registered for this congress. Edits here change this congress's registration only; the person's account and other congresses are left alone.",
  searchLabel: "Search",
  searchPlaceholder: "Name, mobile or organization",
  tierFilter: "Ticket type",
  statusFilter: "Status",
  all: "All",
  statusActive: "Active",
  statusCancelled: "Cancelled",
  exportCsv: "Export CSV",
  exporting: "Preparing…",
  csvError: "The CSV file could not be downloaded.",
  colName: "Participant",
  colMobile: "Mobile",
  colTier: "Ticket type",
  colStatus: "Status",
  colRegistered: "Registered",
  colActions: "Actions",
  noMobile: "No mobile",
  accountDeleted: "Account deleted",
  edit: "Edit",
  manage: "Manage",
  range: "{from}–{to} of {total}",
  prev: "Previous",
  next: "Next",
  emptyTitle: "Nobody has registered for this congress yet.",
  emptyBody: "Registrations from the public page and the front desk appear here.",
  noResults: "No participant matches this search and these filters.",
  clearFilters: "Clear filters",
  loading: "Loading participants",
  loadError: "The participant list could not be loaded.",
  networkError: "Could not reach the server.",
  retry: "Try again",
  dismiss: "Dismiss",
  close: "Close",
  back: "Cancel",
  save: "Save",
  saving: "Saving…",
  editTitle: "Edit registration details",
  editDescription: "This changes this congress only; the person's account and their other registrations stay as they are.",
  fullName: "Full name",
  organization: "Organization",
  jobTitle: "Title",
  nameRequired: "Enter a name.",
  detailTitle: "Manage registration",
  registeredAt: "Registered",
  checkins: "Check-ins",
  leads: "Booth leads",
  issuedBy: "Issued at the desk by",
  cancelledAt: "Cancelled",
  cancelReason: "Reason",
  cancelledBy: "Cancelled by",
  reissuedAt: "Last reissued",
  actorOrganizer: "Organizer",
  actorAttendee: "The participant",
  actorAccountDeleted: "Account deletion",
  reasonTransferred: "Transferred to someone else",
  cancelTicket: "Cancel ticket",
  cancelTitle: "Cancel this ticket?",
  cancelDescription: "The pass and its QR code stop working and the place returns to the ticket type.",
  reason: "Reason (optional)",
  notify: "Text the participant that the ticket was cancelled",
  notifyReissue: "Text the new pass link",
  confirmCancel: "Cancel ticket",
  reissue: "Reissue pass",
  reissueTitle: "Reissue the pass?",
  reissueDescription: "A new QR code is created and the previous pass no longer works at the gates.",
  confirmReissue: "Reissue",
  transfer: "Transfer ticket",
  transferTitle: "Transfer the ticket to someone else",
  transferDescription:
    "This ticket is cancelled and its place goes to the owner of this mobile number, who receives a new pass by SMS. Past check-ins stay with the previous holder.",
  newMobile: "New holder's mobile",
  transferNameHint: "Leave the name empty if this number already has an account.",
  mobileInvalid: "Enter a valid Iranian mobile number, e.g. 09121234567.",
  confirmTransfer: "Transfer",
  delete: "Delete registration",
  deleteTitle: "Delete this registration?",
  deleteDescription: "Only for a registration made by mistake. The registration and its pass are removed permanently.",
  deleteBlocked: "This participant has check-ins or booth leads and cannot be deleted; cancel the ticket instead.",
  confirmDelete: "Delete permanently",
  saved: "Registration details saved.",
  cancelled: "Ticket cancelled.",
  reissued: "Pass reissued.",
  transferred: "Ticket transferred to {name}.",
  deleted: "Registration deleted.",
  filters: "Filter participants",
  results: "{total} participants",
  scanHistory: "Pass scan history",
  noScans: "This pass has not been scanned at any gate yet.",
  scanAdmitted: "Admitted",
  scanRejected: "Rejected",
  detailLoadError: "This registration's details could not be loaded.",
  passInactive: "This ticket's pass and QR code no longer work.",
  transferNeedsName: "This number has no account yet: enter the new holder's name.",
  optionalDetails: "New holder's details (optional)",
  actionError: "That did not work. Please try again.",
};

export const PARTICIPANTS_COPY: Record<"fa" | "en", ParticipantsCopy> = { fa, en };

/** Who cancelled a ticket, as the organizer reads it. */
export function cancelledByLabel(actor: string | null | undefined, copy: ParticipantsCopy): string {
  if (actor === "attendee") return copy.actorAttendee;
  if (actor === "account_deleted") return copy.actorAccountDeleted;
  if (actor === "organizer") return copy.actorOrganizer;
  return actor ?? "";
}

/** The stored cancellation reason; the system's own reasons are translated. */
export function cancelReasonLabel(reason: string | null | undefined, copy: ParticipantsCopy): string {
  return reason === "transferred" ? copy.reasonTransferred : (reason ?? "");
}
