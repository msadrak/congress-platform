import type { IconName } from "../ui/Icon";
import type { PublicLocale } from "./copy";

export interface EnvironmentCopy {
  key: "organizer" | "public" | "attendee" | "reception" | "scanner" | "exhibitor";
  name: string;
  audience: string;
  icon: IconName;
  body: string;
  note?: string;
}

/** Platform landing copy. Only capabilities the product actually has; no figures, logos or testimonials. */
export const homeCopy = {
  en: {
    /** Followed by the brand name (`AITEB_NAME`) in an LTR island. */
    eyebrowLead: "Congress platform by",
    titleLead: "The operating system for",
    titleAccent: "academic & industry congresses",
    lead: "Fast walk-in registration, reliable badge check-in, exhibition lead capture and attendee networking — engineered for the physical reality of busy conference venues.",
    ctaOrganizer: "Organizer Console",
    ctaAttendee: "Find your pass",
    highlights: ["Multi-tenant event workspaces", "High-contrast badge scanning", "Isolated exhibitor leads"],
    panelEyebrow: "One congress",
    panelTitle: "Six connected environments",
    panelNote: "Organizer, attendee, reception, gate and exhibitor views share one source of truth per congress.",
    environments: [
      {
        key: "organizer",
        name: "Organizer console",
        audience: "Organizers",
        icon: "sliders",
        body: "An API-key workspace per organization: congresses, ticket tiers and quotas, check-in points with single-use, multi-entry or capped admission policies, exhibition booths, booth staff and desk operators. Live attendance analytics with CSV export.",
      },
      {
        key: "public",
        name: "Public congress page",
        audience: "Everyone with the link",
        icon: "congress",
        body: "Each congress gets its own registration page: passes with live remaining capacity, free reservation in a minute and an index of exhibitors with their profiles and brochures.",
        note: "Each congress has its own link; congresses the organizer lists also appear above.",
      },
      {
        key: "attendee",
        name: "Attendee portal",
        audience: "Attendees",
        icon: "ticket",
        body: "A personal QR pass that stays available offline, saved exhibition booths and direct contact exchange with fellow attendees, with standard vCard download.",
      },
      {
        key: "reception",
        name: "Reception desk",
        audience: "Front-desk operators",
        icon: "id-card",
        body: "Operator sign-in per congress, fast attendee search, pass review and printing, and walk-in registration that offers the existing pass instead of issuing a duplicate.",
      },
      {
        key: "scanner",
        name: "Gate scanner",
        audience: "Gate staff",
        icon: "scan",
        body: "A paired device per check-in point reading badges by camera or USB barcode reader. The gate manifest lives on the device and scans are buffered offline, then synced when the network returns.",
        note: "Devices are paired by the organizer for a single check-in point.",
      },
      {
        key: "exhibitor",
        name: "Exhibitor workspace",
        audience: "Booth staff",
        icon: "booth",
        body: "Booth representatives capture attendee badges as leads, qualify them Hot, Warm or Cold, add tags and private notes, and export their own CSV. Each booth sees only its own leads.",
        note: "Booth staff receive private access links from the organizer.",
      },
    ] satisfies EnvironmentCopy[],
    openOrganizer: "Open Organizer Console",
    myPasses: "My Tickets & Passes",
    networkingHub: "Networking Hub",
    openReception: "Open Reception Desk",
    rolesEyebrow: "Role entry",
    rolesTitle: "Six environments, one congress",
    rolesLead: "Every role works in an interface calibrated for its task density, device and trust boundary — from the organizer’s desk to a phone at the gate.",
    registerTitle: "Looking to register for a specific congress?",
    registerBody: "Registration is private to each congress. Open the link your organizer shared with you to reserve a free pass.",
    viewMyPasses: "View My Passes",
    lifecycleEyebrow: "Event lifecycle",
    lifecycleTitle: "Built for every phase of your congress",
    lifecycleLead: "From tier configuration to gate throughput and exhibitor lead capture, each phase connects in one clean workflow.",
    phases: [
      {
        phase: "Pre-event",
        title: "Setup & direct registration",
        body: "Organizers configure ticket tiers with strict quota caps, admission policies and the exhibition booth roster.",
        points: ["Private direct links for attendee registration", "Instant QR pass generation", "Exhibition booth profiles & brochures"],
      },
      {
        phase: "At the doors",
        title: "Gate scanning & front desk",
        body: "Attendance is verified at the gates by camera or handheld USB scanner while the front desk issues walk-in passes in seconds.",
        points: ["Local scan buffering for unstable venue networks", "Rapid walk-in search with printable passes", "Live analytics with 30-second refresh & CSV export"],
      },
      {
        phase: "On the floor",
        title: "Leads & peer networking",
        body: "Exhibitors qualify visitor leads with ratings and private notes; attendees exchange contacts directly through their badges.",
        points: ["Isolated exhibitor portals with CSV export", "Hot, Warm and Cold lead qualification", "Private notes & standard vCard (.vcf) download"],
      },
    ],
    venueEyebrow: "Venue engineering",
    venueTitle: "Engineered for the physical reality of conferences",
    venueLead: "Venues bring spotty wireless, harsh overhead lighting and strict competitor boundaries. The platform is designed around all three.",
    principles: [
      {
        title: "High-contrast legibility",
        body: "Passes render as black modules on an opaque white plate with a verified quiet zone, so badges scan reliably under harsh hall lighting or on dimmed phone screens.",
      },
      {
        title: "Network-aware scan buffering",
        body: "Gate check-in evaluates the attendee manifest locally and buffers scans, keeping entry lines moving through temporary venue network dropouts.",
      },
      {
        title: "Strict multi-tenant separation",
        body: "Organizers are partitioned by their API credentials, and competing exhibitor teams are isolated so each company only ever sees its own captured leads.",
      },
    ],
    closingTitle: "Ready to run your congress or symposium?",
    closingLead: "Open the organizer console to set up your event, configure ticket quotas and follow live gate attendance.",
  },
  fa: {
    eyebrowLead: "سامانهٔ همایش",
    titleLead: "سامانهٔ یکپارچهٔ اجرای",
    titleAccent: "همایش‌های علمی و تخصصی",
    lead: "ثبت‌نام حضوری سریع، پذیرش مطمئن کارت ورود در گیت‌ها، ثبت سرنخ در نمایشگاه و شبکه‌سازی شرکت‌کنندگان؛ طراحی‌شده برای واقعیت سالن‌های شلوغ همایش.",
    ctaOrganizer: "پنل برگزارکننده",
    ctaAttendee: "کارت ورود خود را پیدا کنید",
    highlights: ["فضای کاری جداگانه برای هر برگزارکننده", "اسکن پرکنتراست کارت ورود", "سرنخ‌های محرمانهٔ هر غرفه"],
    panelEyebrow: "یک همایش",
    panelTitle: "شش محیط به‌هم‌پیوسته",
    panelNote: "برگزارکننده، شرکت‌کننده، پذیرش، گیت و غرفه‌دار همگی از یک منبع دادهٔ واحد برای هر همایش کار می‌کنند.",
    environments: [
      {
        key: "organizer",
        name: "پنل برگزارکننده",
        audience: "برگزارکنندگان",
        icon: "sliders",
        body: "فضای کاری هر سازمان با کلید API: همایش‌ها، انواع کارت ورود و سهمیهٔ هر کدام، نقاط ورود با سیاست یک‌بار ورود، ورود مکرر یا سقف ظرفیت، غرفه‌های نمایشگاه، نمایندگان غرفه و اپراتورهای پذیرش؛ همراه با آمار زندهٔ حضور و خروجی CSV.",
      },
      {
        key: "public",
        name: "صفحهٔ عمومی همایش",
        audience: "هر کسی که پیوند را دارد",
        icon: "congress",
        body: "هر همایش صفحهٔ ثبت‌نام خودش را دارد: انواع کارت ورود با ظرفیت باقی‌ماندهٔ لحظه‌ای، رزرو رایگان در کمتر از یک دقیقه و فهرست غرفه‌داران با معرفی و بروشور.",
        note: "هر همایش پیوند خودش را دارد؛ همایش‌هایی که برگزارکننده بخواهد در فهرست بالای همین صفحه هم می‌آیند.",
      },
      {
        key: "attendee",
        name: "درگاه شرکت‌کنندگان",
        audience: "شرکت‌کنندگان",
        icon: "ticket",
        body: "کارت ورود QR شخصی که بدون اینترنت هم در دسترس است، غرفه‌های ذخیره‌شده و تبادل مستقیم اطلاعات تماس با دیگر شرکت‌کنندگان همراه با دریافت کارت ویزیت استاندارد (vCard).",
      },
      {
        key: "reception",
        name: "میز پذیرش",
        audience: "اپراتورهای پذیرش",
        icon: "id-card",
        body: "ورود اپراتور برای هر همایش، جست‌وجوی سریع شرکت‌کنندگان، بررسی و چاپ کارت ورود، و ثبت‌نام حضوری که به‌جای صدور کارت تکراری، کارت موجود را پیشنهاد می‌دهد.",
      },
      {
        key: "scanner",
        name: "اسکنر گیت",
        audience: "کارکنان گیت",
        icon: "scan",
        body: "دستگاهی جفت‌شده برای هر نقطهٔ پذیرش که کارت‌ها را با دوربین یا بارکدخوان USB می‌خواند. فهرست مجاز روی خود دستگاه نگه‌داری می‌شود و اسکن‌ها در قطعی شبکه ذخیره و پس از اتصال همگام می‌شوند.",
        note: "برگزارکننده هر دستگاه را برای یک نقطهٔ پذیرش جفت می‌کند.",
      },
      {
        key: "exhibitor",
        name: "فضای کاری غرفه‌دار",
        audience: "نمایندگان غرفه",
        icon: "booth",
        body: "نمایندگان غرفه کارت ورود بازدیدکنندگان را به‌عنوان سرنخ ثبت می‌کنند، آن‌ها را داغ، گرم یا سرد ارزیابی می‌کنند، برچسب و یادداشت محرمانه می‌گذارند و خروجی CSV خودشان را می‌گیرند. هر غرفه فقط سرنخ‌های خودش را می‌بیند.",
        note: "نمایندگان غرفه پیوند دسترسی خصوصی را از برگزارکننده دریافت می‌کنند.",
      },
    ] satisfies EnvironmentCopy[],
    openOrganizer: "ورود به پنل برگزارکننده",
    myPasses: "کارت‌های ورود من",
    networkingHub: "شبکهٔ ارتباطی",
    openReception: "ورود به میز پذیرش",
    rolesEyebrow: "ورود نقش‌ها",
    rolesTitle: "شش محیط، یک همایش",
    rolesLead: "هر نقش در رابطی کار می‌کند که برای حجم کار، دستگاه و مرز دسترسی همان نقش تنظیم شده است؛ از میز برگزارکننده تا تلفن همراه در گیت ورود.",
    registerTitle: "می‌خواهید در همایش مشخصی ثبت‌نام کنید؟",
    registerBody: "ثبت‌نام هر همایش خصوصی است. پیوندی را که برگزارکننده برایتان فرستاده باز کنید تا کارت ورود رایگان خود را رزرو کنید.",
    viewMyPasses: "مشاهدهٔ کارت‌های ورود من",
    lifecycleEyebrow: "چرخهٔ همایش",
    lifecycleTitle: "همراه همهٔ مراحل همایش شما",
    lifecycleLead: "از تعریف انواع کارت ورود تا جریان عبور از گیت‌ها و ثبت سرنخ غرفه‌ها، همهٔ مراحل در یک روند یکپارچه به هم متصل‌اند.",
    phases: [
      {
        phase: "پیش از همایش",
        title: "راه‌اندازی و ثبت‌نام مستقیم",
        body: "برگزارکننده انواع کارت ورود را با سقف سهمیهٔ دقیق، سیاست‌های پذیرش و فهرست غرفه‌های نمایشگاه تعریف می‌کند.",
        points: ["پیوند مستقیم و خصوصی برای ثبت‌نام شرکت‌کنندگان", "صدور فوری کارت ورود QR", "صفحهٔ معرفی و بروشور غرفه‌ها"],
      },
      {
        phase: "در ورودی‌ها",
        title: "اسکن گیت و میز پذیرش",
        body: "حضور شرکت‌کنندگان در گیت‌ها با دوربین یا بارکدخوان دستی USB تأیید می‌شود و میز پذیرش در چند ثانیه کارت ورود حضوری صادر می‌کند.",
        points: ["ذخیرهٔ محلی اسکن‌ها برای شبکهٔ ناپایدار سالن", "جست‌وجوی سریع حضوری با کارت قابل چاپ", "آمار زنده با به‌روزرسانی سی‌ثانیه‌ای و خروجی CSV"],
      },
      {
        phase: "در سالن نمایشگاه",
        title: "سرنخ‌ها و شبکه‌سازی",
        body: "غرفه‌داران سرنخ بازدیدکنندگان را با امتیاز و یادداشت محرمانه ارزیابی می‌کنند و شرکت‌کنندگان اطلاعات تماس را مستقیماً از روی کارت ورود مبادله می‌کنند.",
        points: ["پرتال جداگانهٔ هر غرفه با خروجی CSV", "ارزیابی سرنخ داغ، گرم و سرد", "یادداشت محرمانه و دریافت کارت ویزیت استاندارد (‎.vcf)"],
      },
    ],
    venueEyebrow: "مهندسی محل برگزاری",
    venueTitle: "طراحی‌شده برای واقعیت سالن‌های همایش",
    venueLead: "سالن‌های همایش اینترنت ناپایدار، نور شدید سقفی و مرزهای سخت میان رقبا دارند. سامانه بر پایهٔ هر سه طراحی شده است.",
    principles: [
      {
        title: "خوانایی با کنتراست بالا",
        body: "کارت ورود با ماژول‌های سیاه روی صفحهٔ سفید مات و حاشیهٔ خالی کافی نمایش داده می‌شود تا زیر نور شدید سالن یا روی صفحهٔ کم‌نور تلفن هم بی‌خطا اسکن شود.",
      },
      {
        title: "ذخیرهٔ هوشمند اسکن‌ها",
        body: "پذیرش در گیت فهرست شرکت‌کنندگان را روی خود دستگاه بررسی و اسکن‌ها را ذخیره می‌کند تا صف ورود در قطعی‌های موقت شبکه هم متوقف نشود.",
      },
      {
        title: "جداسازی کامل سازمان‌ها",
        body: "داده‌های هر برگزارکننده با کلید API خودش جدا شده و تیم‌های غرفه‌داران رقیب از هم ایزوله‌اند؛ هر شرکت فقط سرنخ‌های ثبت‌شدهٔ خودش را می‌بیند.",
      },
    ],
    closingTitle: "آمادهٔ برگزاری همایش یا سمپوزیوم خود هستید؟",
    closingLead: "پنل برگزارکننده را باز کنید تا رویداد خود را راه‌اندازی کنید، سهمیهٔ کارت‌های ورود را تنظیم کنید و حضور در گیت‌ها را لحظه‌به‌لحظه دنبال کنید.",
  },
} satisfies Record<PublicLocale, unknown>;
