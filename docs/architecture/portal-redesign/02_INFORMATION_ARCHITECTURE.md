# 02 — Information Architecture & Navigation Hierarchy

**Status:** ARCHITECTURAL DESIGN (Planning Only — Implementation Prohibited)  
**Role:** Principal Information Architect + Senior UX Systems Designer  
**Scope:** Complete Navigation Trees, 5-Tab Attendee Hierarchy, Partner Discovery, and Public-to-Portal Journeys

---

## 1. Global Navigation Tree Across All Portals

The platform separates interfaces into five distinct role-focused portals plus one specialized operational tool:

```
[Platform Root: /]
│
├── 1. PUBLIC WEBSITE EXPERIENCE (PublicShell)
│   ├── /                                    # Platform Overview & Public Directory
│   ├── /e/:slug                             # Public Congress Landing & Registration
│   └── /e/:slug/booths/:boothId             # Public Company Standee & Digital Brochure
│
├── 2. ATTENDEE PORTAL (AttendeeShell) — Exactly 5 Primary Tabs
│   ├── /c/:slug/my-congress                 # Tab 1: Personalized Congress Home & Partners
│   ├── /c/:slug/my-network                  # Tab 2: Peer Networking, QR Exchange & vCard
│   ├── /c/:slug/my-ticket                   # Tab 3: Digital Pass, High-Contrast QR & Offline Pass
│   ├── /c/:slug/my-profile                  # Tab 4: Identity, Attendee Type & Privacy Consent
│   └── /c/:slug/details                     # Tab 5: Official Congress Agenda, Venue & Guide
│   │
│   └── Backward-Compatible Legacy Aliases:
│       ├── /my-tickets                      # Aliases Tab 3 (auto-resolves active event)
│       └── /my-network                      # Aliases Tab 2 (auto-resolves active event)
│
├── 3. ORGANIZER PORTAL (OrganizerShell)
│   ├── /organizer                           # Tenant Event Directory & Create Event Modal
│   └── /organizer/events/:eventId           # Unified Congress Workspace (Sub-sections below)
│       ├── #overview                        # Congress Dates, Venue, Description & Publication
│       ├── #tiers                           # Ticket Quotas, Pricing/Free Tiers & Capacities
│       ├── #types                           # Configurable Attendee Types (CR-06)
│       ├── #points                          # Check-In Gates, Capacities & Admission Policies
│       ├── #operators                       # Reception Operator Provisioning & Revocation (CR-05)
│       ├── #partners                        # Partners, Exhibition Booths & Staff Assignment (D06)
│       └── #analytics                       # Real-Time Throughput KPIs, Catering & CSV Export
│
├── 4. RECEPTION PORTAL (ReceptionShell)
│   └── /organizer/events/:eventId/desk      # Dedicated Front-Desk Operational Station
│       ├── /desk/register                   # Rapid Walk-In Pass Minting (Sub-second focus)
│       ├── /desk/lookup                     # Live Attendee Search, Status & Re-print Pass
│       └── /desk/card/:ticketId             # Pass Attribution Summary & Check-In History
│
├── 5. PARTNER PORTAL (PartnerShell)
│   └── /booth/:boothId                      # Partner & Booth Lead Workspace (Preserved URL)
│       ├── /partner/profile                 # Company Description, Website & Brochure Link
│       ├── /partner/scan                    # Badge Camera Scanner & USB Barcode Reader
│       ├── /partner/leads                   # Qualified Leads Feed, Ratings & Search
│       └── /partner/export                  # Sanitized CSV Export for CRM Integration
│
└── 6. OPERATIONAL SCANNER CLIENT (ScannerShell)
    └── /scan/:pointId                       # Dedicated Gate Scanner PWA (Preserved URL)
```

---

## 2. Attendee Portal: Mandatory 5-Tab Architecture

The Attendee Portal contains **exactly five top-level primary destinations**. Canonical English names are retained in the system architecture, with verified Persian (`fa`) translations optimized for clarity:

| Tab # | Canonical English ID | Persian UI Label (`fa`) | Primary Task / Objective |
|:---:|---|---|---|
| **Tab 1** | **My Congress** | **کنگره من** | Personalized participant dashboard, next session, saved items, and commercial partner directory |
| **Tab 2** | **My Network** | **ارتباطات من** | Scan peer badges, manage private contact notes, configure email disclosure, and export `.vcf` vCards |
| **Tab 3** | **My Ticket** | **کارت ورود من** | Rapid badge presentation at gates, high-contrast QR, offline cache reassurance, and print pass |
| **Tab 4** | **My Profile** | **پروفایل کاربری** | Verified professional identity, Attendee Type badge, organization, title, and privacy consents |
| **Tab 5** | **Congress Details** | **اطلاعات کنگره** | Official event handbook, schedule, speakers, venue maps, emergency notices, and guidelines |

### Mobile Bottom Navigation Visual Schema:
```
┌────────────────────────────────────────────────────────────────────────┐
│  [کنگره من]    [ارتباطات من]    [کارت ورود من]    [پروفایل من]    [اطلاعات کنگره] │
│   My Congress   My Network     My Ticket       My Profile     Details  │
│       🏛️            🤝             🎫              👤             ℹ️     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Tab 1 — My Congress & Mandatory Partner Discovery

### 3.1 Core Purpose
`My Congress` is the attendee's **personalized command center**. It answers: *"What is my status right now, and what opportunities exist for me at this congress?"*

It deliberately does **not** duplicate the generic public event landing page.

### 3.2 Content Hierarchy of Tab 1
1. **Congress Header Pill:** Official event name, active day indicator (`روز دوم از ۳`), and quick link to venue map.
2. **Participant Status Card:**
   - Welcome greeting with participant's full name and organization.
   - **Attendee Type Badge** (e.g. `پزشک متخصص`, `سخنران`, `دانشجو`).
   - Ticket Tier entitlement indicator (e.g. `دسترسی کامل (VIP)`).
   - Admission status (`پذیرفته شده در سالن اصلی` / `آماده پذیرش`).
3. **Quick Action Shortcuts:**
   - [کارت ورود سریع] (Deep-link to Tab 3).
   - [اسکن همکار جدید] (Deep-link to Tab 2 scan modal).
4. **My Saved Items Section:**
   - Bookmarked Exhibition Booths (`غرفه‌های نشان‌شده من`).
   - Fast link to download cached digital brochures.
5. **Partner & Exhibition Directory (Mandatory Feature):**
   - Full list of event partners, categorized by partnership tier.

### 3.3 Partner Discovery Architecture: Comparison & Recommendation

The client explicitly requires partner discovery inside `My Congress` without adding a 6th primary tab.

| Approach | Architecture | Advantages | Disadvantages | Verdict |
|---|---|---|---|:---:|
| **Option A: Nested Sub-tabs** | Inner tab bar inside Tab 1 (`داشبورد` / `حامیان و غرفه‌ها`) | Isolates long lists from status card | Creates two layers of tab bars (nested tabs violate CR-10 shallow UX) | REJECTED |
| **Option B: Simple Section** | Static grid of partners at the bottom of the page | Very flat hierarchy | Overwhelms the dashboard when a congress has 50+ sponsors | REJECTED |
| **Option C: Hybrid Preview + In-Place Filterable Directory** | Prominent "Featured Partners" preview carousel + in-place expandable directory with category pills | Retains exactly 5 primary tabs; zero deep nesting; supports both booth exhibitors and boothless sponsors; preserves bookmarks | Requires clean in-place search/filter controls | **RECOMMENDED** |

#### Why Option C is the Recommended Solution:
1. **Preserves 5-Tab Integrity:** No 6th tab is created.
2. **Eliminates Nested Navigation:** The attendee never leaves Tab 1 or navigates into a sub-sub-view. Filtering occurs in-place via shallow category chips (`همه`, `غرفه‌داران`, `حامیان مالی`, `موسسات همکار`).
3. **Supports Boothless Partners:** Displays sponsors and scientific partners who do not have physical exhibition booths.
4. **Context-Aware Booth Actions:** If a partner has a physical booth (`booth_id !== null`), the card renders:
   - Stand number pill (`غرفه A-14`).
   - "Download Brochure" button (`دریافت کاتالوگ دیجیتال`).
   - "Bookmark" toggle button (reusing `POST /api/attendees/me/bookmarks/booths/{id}`).
   - "View Standee" link (to `/e/:slug/booths/:boothId`).
   If the partner is sponsor-only, it displays their corporate profile, logo, and external URL without confusing booth artifacts.

---

## 4. Tab 2 — My Network (Peer Networking & vCard)

### 4.1 Content Hierarchy
1. **Network Header:** Connections counter (`۱۴ ارتباط ثبت شده`), Export All Contacts button.
2. **Primary Action Button:** Prominent high-contrast button: `+ ثبت ارتباط با همکار (اسکن بارکد)`.
3. **Privacy Notice Card:** Clear banner displaying current contact disclosure setting (`اشتراک ایمیل: فعال / غیرفعال`) with one-tap toggle (`ContactConsentToggle`).
4. **Connections List:**
   - Filter by name or organization.
   - Connection Card:
     - Peer Name, Title, Organization.
     - Disclosed Email (if peer opted in) or privacy badge (`ایمیل محرمانه`).
     - Private notes drawer/input (`یادداشت‌های محرمانه`).
     - One-tap `.vcf` vCard download button (`دریافت کارت مخاطب`).
5. **Empty State:** Visual illustration with instructions: *"در طول نشست‌ها و زمان پذیرایی، با اسکن کارت نشان همکاران، ارتباط خود را ذخیره کنید."*

---

## 5. Tab 3 — My Ticket (Digital QR Pass & Offline Guard)

### 5.1 Content Hierarchy
1. **High-Contrast Pass Card:**
   - Congress Name & Official Logo.
   - Attendee Full Name, Title, and Organization.
   - **Configurable Attendee Type Pill** (e.g. `شرکت‌کننده آزاد`, `پزشک`).
   - High-Contrast SVG QR Code (minimum $240 \times 240$ px, strictly scannable in direct sunlight and dim auditorium lighting).
   - Pass ID & Secret checksum.
2. **Admission Status Badge:**
   - Green: `پذیرفته شده در گیت اصلی` (with timestamp).
   - Blue: `آماده ورود به سالن`.
3. **Offline Resilience Reassurance Banner:**
   - If offline: Amber banner: `حالت آفلاین — کارت ورود از حافظه امن دستگاه بارگذاری شد.`
   - If online: Green subtle pill: `همگام با سرور مرکزی.`
4. **Utility Actions:**
   - `چاپ کارت ورود (PDF / Print)`: Standard print stylesheet for desk or home printing.
   - `راهنمای ورود به سالن`: Venue entry points and guidelines.

---

## 6. Tab 4 — My Profile (Identity & Privacy Governance)

### 6.1 Content Hierarchy
1. **Verified Identity Header:** Avatar placeholder, Full Name, Email (read-only login identity).
2. **Event Participation Card:**
   - Assigned Attendee Type (read-only, set by registration or desk operator).
   - Ticket Tier entitlement.
   - Registration Date and Operator Attribution (if minted at desk: `ثبت شده در میز پذیرش`).
3. **Editable Professional Details:**
   - Organization / Affiliation (`سازمان یا دانشگاه محل خدمت`).
   - Title / Specialty (`سمت شغلی یا گرایش تخصصی`).
4. **Privacy & Contact Consent Settings:**
   - Toggle: `اشتراک‌گذاری ایمیل با همکاران در هنگام تبادل کارت دیجیتال`.
   - Explanatory note: "در صورت فعال بودن، هنگام اسکن نشان شما توسط همکاران، آدرس ایمیل شما در کارت مخاطب نمایش داده خواهد شد."
5. **Account Controls:**
   - Switch Congress (if multi-event attendee).
   - Logout (`خروج از حساب کاربری`).

---

## 7. Tab 5 — Congress Details vs Tab 1 — My Congress

To prevent duplicate or confusing content between Tab 1 and Tab 5, their architectural responsibilities are strictly separated:

| Dimension | Tab 1: My Congress (`کنگره من`) | Tab 5: Congress Details (`اطلاعات کنگره`) |
|---|---|---|
| **Primary Question** | *"وضعیت من در این همایش چیست؟ چه کارهایی می‌توانم انجام دهم؟"* | *"این همایش چیست؟ زمان‌بندی و اطلاعات کلی آن چگونه است؟"* |
| **Perspective** | **شخصی‌سازی شده و کنش‌گرا (Personalized & Actionable)** | **مرجع جامع و عمومی (Comprehensive Reference)** |
| **User Context** | وضعیت بلیت من، نشان‌های من، ارتباطات من، دسترسی‌های من | برنامه کامل سخنرانی‌ها، نقشه سالن‌ها، اعضای هیئت علمی |
| **Data Source** | داده‌های اختصاصی کاربر (`/api/attendees/me/*`) | داده‌های عمومی رویداد (`/api/public/events/{slug}`) |
| **Content Elements** | کارت وضعیت، دسترسی سریع به کیوآر، غرفه‌های نشان‌شده، فهرست حامیان تجاری | معرفی رویداد، تاریخ‌های دقیق، آدرس محل برگزاری، نقشه گیت‌ها، راهنمای پذیرایی، خط‌مشی‌های رویداد |

---

## 8. Organizer Portal Navigation Hierarchy

The Organizer Portal provides a shallow, multi-workspace console for tenant administrators:

```
/organizer (Tenant Events Dashboard)
  ├── [+ ایجاد همایش جدید] (Event Creation Modal)
  └── [کارت هر همایش] -> /organizer/events/:eventId
        │
        ├── 1. بخش تنظیمات پایه (Overview Tab)
        │     ├── عنوان رسمی، شناسه یکتا (Slug)، تاریخ شروع و پایان
        │     ├── نشانی و سالن برگزاری، معرفی و شرح تفصیلی
        │     └── پیوند اختصاصی صفحه عمومی و وضعیت انتشار
        │
        ├── 2. رده‌های بلیت (Ticket Tiers Tab)
        │     ├── جدول ظرفیت و ثبت‌نام‌ها (Quota, Reserved Count, Status)
        │     └── [+ تعریف رده جدید] (Modal: نام رده، سهمیه مجاز، فعال/غیرفعال)
        │
        ├── 3. انواع شرکت‌کنندگان (Attendee Types Tab — CR-06)
        │     ├── لیست دسته‌بندی‌های اختصاصی (پزشک، دانشجو، مهمان ویژه، VIP)
        │     └── [+ افزودن نوع شرکت‌کننده] (Modal: عنوان، ترتیب نمایش، وضعیت)
        │
        ├── 4. گیت‌های ورود و خط‌مشی‌ها (Check-In Gates Tab)
        │     ├── فهرست ایستگاه‌های فیزیکی و منطقی (گیت اصلی، سالن پذیرایی، سالن A)
        │     ├── خط‌مشی پذیرش (MULTI_ENTRY, SINGLE_ENTRY, ONCE_PER_DAY)
        │     ├── صدور توکن اسکنر و مدیریت دستگاه‌ها (Scanner Devices & Revocation)
        │     └── بارگیری مانیفست آفلاین
        │
        ├── 5. پرسنل میز پذیرش (Desk Staff Tab — CR-05)
        │     ├── جدول اپراتورهای مجاز میز پذیرش (نام، ایمیل، تاریخ تخصیص، وضعیت)
        │     ├── [+ افزودن اپراتور میز پذیرش] (Modal: نام، ایمیل -> تولید کلمه عبور موقت)
        │     └── دکمه لغو دسترسی آنی (Revoke Access -> مسدودسازی فوری بدون نیاز به تغییر کلید اصلی)
        │
        ├── 6. شرکا و غرفه‌های نمایشگاهی (Partners & Booths Tab)
        │     ├── ثبت شرکت‌های حامی و غرفه‌داران (نام شرکت، شماره استند، کاتالوگ)
        │     ├── تخصیص نمایندگان غرفه با ایمیل
        │     └── صدور و پیش‌نمایش پوستر اختصاصی EntityQR غرفه
        │
        └── 7. آمار و گزارش‌های زنده (Analytics Tab)
              ├── نمودار میله‌ای تردد لحظه‌ای در گیت‌ها
              ├── وضعیت سهمیه سالن غذاخوری و پذیرایی (Catering Widget)
              └── خروجی کامل فایل اکسل/CSV شرکت‌کنندگان و ترددها
```

---

## 9. Reception Portal Navigation Hierarchy

The Reception Portal is **completely autonomous** from the Organizer settings menu. It is an operational workstation designed for rapid execution:

```
/organizer/events/:eventId/desk (میز پذیرش همایش)
  │
  ├── هدر عملیاتی (Station Header)
  │     ├── عنوان کنگره فعال
  │     ├── نام و نشان اپراتور فعال (مثال: اپراتور: مریم کاظمی)
  │     ├── نشانگر وضعیت شبکه (آنلاین / تاخیر در اتصال)
  │     └── دکمه خروج اپراتور (Logout)
  │
  ├── فرم پذیرش سریع حضوری (Rapid Walk-In Registration Panel)
  │     ├── فیلد نام و نام خانوادگی (Auto-focused)
  │     ├── فیلد ایمیل (اختیاری برای مراجعان بدون ایمیل -> تولید خودکار walkin-xxx)
  │     ├── فیلد سازمان و سمت شغلی
  │     ├── انتخاب نوع شرکت‌کننده (Attendee Type Dropdown)
  │     ├── انتخاب رده بلیت (Ticket Tier Dropdown)
  │     └── دکمه صدور آنی کارت همایش (ثبت و صدور کارت - کلید میانبر Enter)
  │
  ├── پنل جستجو و وضعیت مراجعان (Live Attendee Lookup Panel)
  │     ├── کادر جستجوی آنی با نام، ایمیل، یا شماره کارت
  │     ├── جدول نتایج با وضعیت پذیرش (پذیرفته شده / آماده ورود)
  │     └── دکمه صدور مجدد کارت (Re-Print Pass)
  │
  └── کارت نمایش بلیت صادر شده (Minted Pass Summary Drawer)
        ├── نمایش کارت دیجیتال و کد QR با کنتراست بالا
        ├── مشخصات متصدی صادرکننده (Attribution: اپراتور مریم کاظمی)
        └── دکمه بازگشت فوری به فرم ثبت‌نام بعدی (آماده برای نفر بعدی)
```

---

## 10. Partner Portal Navigation Hierarchy

Designed for commercial sponsors and booth representatives:

```
/booth/:boothId (پورتال اختصاصی شریک تجاری / غرفه)
  │
  ├── هدر مشخصات شرکت (Partner Brand Header)
  │     ├── نام شرکت و نشان تجاری
  │     ├── شماره غرفه در سالن نمایشگاه
  │     └── خروج نماینده غرفه
  │
  ├── برگه ۱: مشخصات و کاتالوگ دیجیتال (Company Profile)
  │     ├── متن معرفی شرکت و زمینه فعالیت
  │     ├── آدرس وب‌سایت و شبکه‌های اجتماعی
  │     └── پیوند فایل کاتالوگ دیجیتال جهت دانلود بازدیدکنندگان
  │
  ├── برگه ۲: اسکنر ثبت سرنخ فروش (Lead Scanner — ویژه غرفه‌داران)
  │     ├── فعال‌سازی دوربین جهت اسکن کارت نشان بازدیدکننده
  │     ├── کادر ورود دستی کد نشان (در صورت عدم دسترسی به دوربین)
  │     └── پنجره ثبت درجه اهمیت (HOT / WARM / COLD) و برچسب‌های اقدام (ارسال پیش‌فاکتور، جلسه دمو)
  │
  ├── برگه ۳: مدیریت سرنخ‌های ثبت‌شده (Leads Feed)
  │     ├── جدول زنده بازدیدکنندگان اسکن‌شده همراه با اطلاعات تماس
  │     ├── فیلتر بر اساس درجه حرارت (داغ، گرم، سرد) و جستجوی متنی
  │     └── ویرایش یادداشت‌های مذاکره برای هر سرنخ
  │
  └── اقدام عملیاتی: خروجی فایل اکسل/CSV سرنخ‌ها (Export CRM Leads)
        └── دانلود آنی فایل پاکسازی‌شده جهت وارد کردن در سامانه‌های CRM
```
