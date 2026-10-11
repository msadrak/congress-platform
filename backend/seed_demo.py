"""Idempotent seed script for local manual demo environment.

Creates a realistic congress with ~250 attendees, Persian metadata,
booths, staff, leads, ticket tiers, check-in points, scan logs,
and scanner device tokens.

Credentials are saved locally to demo_credentials.json (gitignored).
"""

import asyncio
import json
import os
import random
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select

from app.auth import hash_api_key
from app.config import Settings
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.models import (
    Base,
    Booth,
    BoothBookmark,
    BoothStaff,
    CheckIn,
    CheckInPoint,
    Connection,
    EntityQR,
    Event,
    Lead,
    Organizer,
    ScannerDevice,
    Ticket,
    TicketTier,
    User,
)
from app.security import (
    create_scanner_token,
    generate_entity_qr_secret,
    hash_password,
)

# Configuration constants
DEMO_ORGANIZER_KEY = "demo-organizer-secret-api-key-2026"
DEMO_EVENT_SLUG = "ai-health-2026"
STAFF_PASSWORD = "DemoStaff123!"
ATTENDEE_PASSWORD = "DemoUser123!"

PERSIAN_FIRST_NAMES = [
    "علی", "محمد", "رضا", "امیر", "حسین", "مهدی", "سارا", "مریم", "فاطمه", "زهرا",
    "نیلوفر", "نگین", "پریسا", "علیرضا", "حمید", "پویا", "دانیال", "سامان", "امید",
    "احسان", "فرزاد", "بهنام", "سینا", "آرش", "شیرین", "الهام", "رویا", "نرگس",
    "ساناز", "سپیده", "محسن", "مهرداد", "کیان", "آرمین", "پگاه", "بیتا", "هانیه"
]

PERSIAN_LAST_NAMES = [
    "محمدی", "حسینی", "احمدی", "کریمی", "موسوی", "جعفری", "قاسمی", "حیدری", "صادقی",
    "شفیعی", "رضایی", "مرادی", "رحیمی", "ابراهیمی", "کمالی", "طاهری", "رستمی", "سلیمانی",
    "نجفی", "کاظمی", "هاشمی", "مرتضوی", "افشار", "علوی", "مقدم", "صبوری", "پارسا",
    "شریفی", "محبی", "باقری", "مظفری", "فرهادی", "نیک‌زاد", "بهروزی", "دهقان"
]

ORGANIZATIONS = [
    "دانشگاه علوم پزشکی تهران",
    "دانشگاه علوم پزشکی شهید بهشتی",
    "دانشگاه صنعتی شریف - دانشکده مهندسی پزشکی",
    "دانشگاه علوم پزشکی ایران",
    "پژوهشکده علوم اعصاب و داده‌کاوی بالینی",
    "بیمارستان امام خمینی",
    "مرکز قلب تهران",
    "بیمارستان شریعتی",
    "دانشگاه علوم پزشکی اصفهان",
    "دانشگاه علوم پزشکی شیراز",
    "دانشگاه تربیت مدرس",
    "انستیتو پاستور ایران",
    "مرکز تحقیقات هوش مصنوعی سلامت",
]

TITLES = [
    "متخصص تصویربرداری پزشکی",
    "دانشیار رادیولوژی و هوش مصنوعی",
    "رزیدنت سال سوم بیماری‌های داخلی",
    "فلوشیپ جراحی رباتیک",
    "پژوهشگر پسادکتری انفورماتیک پزشکی",
    "دانشجوی دکترای بیوانفورماتیک",
    "دانشجوی کارشناسی ارشد مهندسی پزشکی",
    "پزشک عمومی و پژوهشگر هوش مصنوعی",
    "استاد تمام پاتولوژی بالینی",
    "مهندس نرم‌افزار تجهیزات پزشکی",
]


async def seed_demo():
    print("==================================================")
    print("Congress Platform: Seeding Realistic Demo Data")
    print("==================================================")

    settings = Settings(
        platform_admin_token="dev",
        jwt_secret="provide-a-secure-random-secret-key-at-least-32-chars-long",
    )
    engine = create_async_engine(settings.database_url)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as session:
        # 1. Clean previous demo event if exists (idempotency)
        existing_event = await session.scalar(
            select(Event).where(Event.slug == DEMO_EVENT_SLUG)
        )
        if existing_event:
            print(f"Cleaning existing demo event '{DEMO_EVENT_SLUG}'...")
            # Cascade delete event resources
            evt_id = existing_event.id
            await session.execute(delete(CheckIn).where(CheckIn.checkin_point_id.in_(
                select(CheckInPoint.id).where(CheckInPoint.event_id == evt_id)
            )))
            await session.execute(delete(ScannerDevice).where(ScannerDevice.event_id == evt_id))
            await session.execute(delete(CheckInPoint).where(CheckInPoint.event_id == evt_id))
            await session.execute(delete(Lead).where(Lead.booth_id.in_(
                select(Booth.id).where(Booth.event_id == evt_id)
            )))
            await session.execute(delete(BoothBookmark).where(BoothBookmark.booth_id.in_(
                select(Booth.id).where(Booth.event_id == evt_id)
            )))
            await session.execute(delete(BoothStaff).where(BoothStaff.booth_id.in_(
                select(Booth.id).where(Booth.event_id == evt_id)
            )))
            await session.execute(delete(Booth).where(Booth.event_id == evt_id))
            await session.execute(delete(Connection).where(Connection.event_id == evt_id))
            await session.execute(delete(EntityQR).where(EntityQR.entity_id.in_(
                select(Ticket.id).where(Ticket.event_id == evt_id)
            )))
            await session.execute(delete(Ticket).where(Ticket.event_id == evt_id))
            await session.execute(delete(TicketTier).where(TicketTier.event_id == evt_id))
            await session.execute(delete(Event).where(Event.id == evt_id))
            await session.commit()
            print("Previous demo event cleared cleanly.")

        # 2. Organizer: Iranian Medical Informatics Association
        organizer = await session.scalar(
            select(Organizer).where(Organizer.name == "انجمن انفورماتیک پزشکی ایران")
        )
        if not organizer:
            organizer = Organizer(
                name="انجمن انفورماتیک پزشکی ایران",
                api_key_hash=hash_api_key(DEMO_ORGANIZER_KEY),
            )
            session.add(organizer)
            await session.flush()
            print("Created Organizer: انجمن انفورماتیک پزشکی ایران")
        else:
            organizer.api_key_hash = hash_api_key(DEMO_ORGANIZER_KEY)
            await session.flush()
            print("Reusing Organizer: انجمن انفورماتیک پزشکی ایران")

        # 3. Event: Annual AI in Medicine Congress 2026
        now = datetime.now(timezone.utc)
        event = Event(
            organizer_id=organizer.id,
            name="نخستین کنگره جامع هوش مصنوعی و فناوری‌های نوین سلامت ۱۴۰۵",
            slug=DEMO_EVENT_SLUG,
            location="مرکز همایش‌های بین‌المللی برج میلاد تهران - سالن اصلی و تالار مولوی",
            description=(
                "بزرگترین گردهمایی سالانه متخصصان هوش مصنوعی، تصویربرداری پزشکی، "
                "جراحی رباتیک و کلان‌داده‌های سلامت کشور همراه با نمایشگاه جامع تجهیزات "
                "و کارگاه‌های تخصصی بین‌المللی."
            ),
            starts_at=now - timedelta(hours=4),
            ends_at=now + timedelta(days=2),
        )
        session.add(event)
        await session.flush()
        print(f"Created Event: {event.name} (slug: {event.slug})")

        # 4. Ticket Tiers (3)
        tier_general = TicketTier(
            event_id=event.id,
            name="ثبت‌نام عمومی (پزشکان و پژوهشگران)",
            description="دسترسی به تمامی سخنرانی‌های کلیدی سالن اصلی و نمایشگاه تخصصی",
            quota=200,
            is_open=True,
        )
        tier_faculty = TicketTier(
            event_id=event.id,
            name="اعضای هیئت علمی و سخنرانان مدعو",
            description="دسترسی اختصاصی به جایگاه VIP، سالن سخنرانان و کارگاه‌های فوق تخصصی",
            quota=50,
            is_open=True,
        )
        tier_student = TicketTier(
            event_id=event.id,
            name="دانشجویان و دستیاران تخصصی",
            description="پذیرش دانشجویی رایگان با ارائه کارت معتبر دانشگاهی",
            quota=100,
            is_open=True,
        )
        session.add_all([tier_general, tier_faculty, tier_student])
        await session.flush()
        print("Created 3 Ticket Tiers (General, Faculty, Student)")

        # 5. Check-In Points (3)
        pt_main = CheckInPoint(
            event_id=event.id,
            name="ورودی اصلی و گیت‌های کنترل تردد (گیت ۱)",
            location="لابی ورودی سالن همایش‌ها",
            policy_type="MULTI_ENTRY",
            allowed_tier_ids=[],
            max_capacity=None,
        )
        pt_lunch = CheckInPoint(
            event_id=event.id,
            name="پذیرایی و ناهار سالن حافظ",
            location="طبقه همکف - سالن پذیرایی مرکزی",
            policy_type="SINGLE_USE",
            allowed_tier_ids=[],
            max_capacity=None,
        )
        pt_workshop = CheckInPoint(
            event_id=event.id,
            name="کارگاه تخصصی پردازش تصویر و جراحی رباتیک",
            location="تالار ۲ - سالن کارگاه‌های بالینی",
            policy_type="TIER_RESTRICTED",
            allowed_tier_ids=[str(tier_faculty.id)],
            max_capacity=60,
        )
        session.add_all([pt_main, pt_lunch, pt_workshop])
        await session.flush()
        print("Created 3 Check-In Points (Main Gate, Lunch Catering, Workshop)")

        # 6. Scanner Devices & Tokens
        dev_main = ScannerDevice(
            checkin_point_id=pt_main.id,
            event_id=event.id,
            device_name="تبلت گیت اصلی ۱ (ورودی)",
        )
        dev_lunch = ScannerDevice(
            checkin_point_id=pt_lunch.id,
            event_id=event.id,
            device_name="تبلت سالن پذیرایی و ناهار",
        )
        dev_work = ScannerDevice(
            checkin_point_id=pt_workshop.id,
            event_id=event.id,
            device_name="اسکنر گیت کارگاه تخصصی",
        )
        session.add_all([dev_main, dev_lunch, dev_work])
        await session.flush()

        tok_main = create_scanner_token(pt_main.id, event.id, settings.jwt_secret, dev_main.id)
        tok_lunch = create_scanner_token(pt_lunch.id, event.id, settings.jwt_secret, dev_lunch.id)
        tok_work = create_scanner_token(pt_workshop.id, event.id, settings.jwt_secret, dev_work.id)
        print("Minted point-scoped tokens for all 3 check-in gates.")

        # 7. Exhibition Booths (2)
        booth_sina = Booth(
            event_id=event.id,
            name="سینا روبوتیک (سامانه جراحی رباتیک سینا)",
            slug="sina-robotics",
            location="غرفه A-101 (سالن همکف نمایشگاه)",
            description="توسعه‌دهنده پیشرفته‌ترین سامانه‌های جراحی لاپاراسکوپی از راه دور و رباتیک پزشکی ساخت ایران.",
            website_url="https://sinarobotics.ir",
            brochure_url="https://sinarobotics.ir/catalog-1405.pdf",
        )
        booth_pars = Booth(
            event_id=event.id,
            name="پارس بیودارو (فناوری‌های نوین دارویی)",
            slug="pars-biodrug",
            location="غرفه B-204 (سالن دوم تجاری)",
            description="پیشگام در فرمولاسیون زیست‌داروها و هوش مصنوعی در کشف مولکول‌های درمانی.",
            website_url="https://parsbio.ir",
            brochure_url="https://parsbio.ir/brochure.pdf",
        )
        session.add_all([booth_sina, booth_pars])
        await session.flush()

        # Entity QRs for booths
        qr_sina = EntityQR(
            secret=generate_entity_qr_secret(),
            entity_type="booth",
            entity_id=booth_sina.id,
        )
        qr_pars = EntityQR(
            secret=generate_entity_qr_secret(),
            entity_type="booth",
            entity_id=booth_pars.id,
        )
        session.add_all([qr_sina, qr_pars])
        await session.flush()
        print("Created 2 Exhibition Booths (Sina Robotics & Pars Biodrug)")

        # 8. Booth Staff Accounts
        staff_sina_user = await session.scalar(select(User).where(User.email == "staff@sinarobotics.ir"))
        if not staff_sina_user:
            staff_sina_user = User(
                email="staff@sinarobotics.ir",
                password_hash=hash_password(STAFF_PASSWORD),
                full_name="مهندس علیرضا صبوری",
                organization="سینا روبوتیک",
                title="مدیر بازاریابی بالینی",
                share_contact_with_peers=True,
            )
            session.add(staff_sina_user)
            await session.flush()
        staff_sina_link = BoothStaff(booth_id=booth_sina.id, user_id=staff_sina_user.id)
        session.add(staff_sina_link)

        staff_pars_user = await session.scalar(select(User).where(User.email == "staff@parsbio.ir"))
        if not staff_pars_user:
            staff_pars_user = User(
                email="staff@parsbio.ir",
                password_hash=hash_password(STAFF_PASSWORD),
                full_name="دکتر نیلوفر مهدوی",
                organization="پارس بیودارو",
                title="کارشناس توسعه بازار دارو",
                share_contact_with_peers=True,
            )
            session.add(staff_pars_user)
            await session.flush()
        staff_pars_link = BoothStaff(booth_id=booth_pars.id, user_id=staff_pars_user.id)
        session.add(staff_pars_link)
        await session.flush()
        print("Created Booth Staff Accounts for both exhibitors.")

        # 9. Dedicated Test Personas
        user_attendee = await session.scalar(select(User).where(User.email == "attendee@demo.ir"))
        if not user_attendee:
            user_attendee = User(
                email="attendee@demo.ir",
                password_hash=hash_password(ATTENDEE_PASSWORD),
                full_name="دکتر علی کریمی",
                organization="بیمارستان شریعتی تهران",
                title="پزشک عمومی و پژوهشگر هوش مصنوعی",
                share_contact_with_peers=True,
            )
            session.add(user_attendee)
            await session.flush()

        user_faculty = await session.scalar(select(User).where(User.email == "faculty@demo.ir"))
        if not user_faculty:
            user_faculty = User(
                email="faculty@demo.ir",
                password_hash=hash_password(ATTENDEE_PASSWORD),
                full_name="دکتر سارا علوی",
                organization="دانشگاه علوم پزشکی تهران",
                title="دانشیار رادیولوژی و هوش مصنوعی",
                share_contact_with_peers=True,
            )
            session.add(user_faculty)
            await session.flush()

        user_student = await session.scalar(select(User).where(User.email == "student@demo.ir"))
        if not user_student:
            user_student = User(
                email="student@demo.ir",
                password_hash=hash_password(ATTENDEE_PASSWORD),
                full_name="امیرحسین رضایی",
                organization="دانشگاه صنعتی شریف",
                title="دانشجوی دکترای انفورماتیک پزشکی",
                share_contact_with_peers=True,
            )
            session.add(user_student)
            await session.flush()

        # Dedicated persona tickets
        t_attendee = Ticket(
            event_id=event.id,
            ticket_tier_id=tier_general.id,
            user_id=user_attendee.id,
            status="active",
        )
        t_faculty = Ticket(
            event_id=event.id,
            ticket_tier_id=tier_faculty.id,
            user_id=user_faculty.id,
            status="active",
        )
        t_student = Ticket(
            event_id=event.id,
            ticket_tier_id=tier_student.id,
            user_id=user_student.id,
            status="active",
        )
        session.add_all([t_attendee, t_faculty, t_student])
        await session.flush()

        sec_attendee = generate_entity_qr_secret()
        sec_faculty = generate_entity_qr_secret()
        sec_student = generate_entity_qr_secret()

        qr_att = EntityQR(secret=sec_attendee, entity_type="attendee_ticket", entity_id=t_attendee.id)
        qr_fac = EntityQR(secret=sec_faculty, entity_type="attendee_ticket", entity_id=t_faculty.id)
        qr_stu = EntityQR(secret=sec_student, entity_type="attendee_ticket", entity_id=t_student.id)
        session.add_all([qr_att, qr_fac, qr_stu])
        await session.flush()
        print("Created 3 dedicated test personas (attendee@demo.ir, faculty@demo.ir, student@demo.ir)")

        # 10. Generate 247 Additional Realistic Attendees (~250 total)
        print("Generating 247 synthetic attendees with realistic Persian names...")
        total_additional = 247
        users_batch = []
        pw_hash = hash_password(ATTENDEE_PASSWORD)

        for i in range(total_additional):
            fn = random.choice(PERSIAN_FIRST_NAMES)
            ln = random.choice(PERSIAN_LAST_NAMES)
            email = f"attendee_{i+1:03d}@aihealth.ir"
            org = random.choice(ORGANIZATIONS)
            title = random.choice(TITLES)
            u = User(
                email=email,
                password_hash=pw_hash,
                full_name=f"{fn} {ln}",
                organization=org,
                title=title,
                share_contact_with_peers=(i % 3 != 0),  # 66% consent
            )
            users_batch.append(u)

        session.add_all(users_batch)
        await session.flush()

        # Distribute tickets across tiers:
        # Tier 1 (General): 150
        # Tier 2 (Faculty): 35
        # Tier 3 (Student): 62
        tickets_batch = []
        entity_qrs_batch = []

        for idx, u in enumerate(users_batch):
            if idx < 150:
                tier = tier_general
            elif idx < 185:
                tier = tier_faculty
            else:
                tier = tier_student

            t = Ticket(
                event_id=event.id,
                ticket_tier_id=tier.id,
                user_id=u.id,
                status="active",
            )
            tickets_batch.append(t)

        session.add_all(tickets_batch)
        await session.flush()

        # Entity QRs
        for t in tickets_batch:
            sec = generate_entity_qr_secret()
            eq = EntityQR(
                secret=sec,
                entity_type="attendee_ticket",
                entity_id=t.id,
            )
            entity_qrs_batch.append(eq)

        session.add_all(entity_qrs_batch)
        await session.flush()
        print(f"Total tickets minted: {len(tickets_batch) + 3}")

        # Update tier reserved counts
        tier_general.reserved_count = 151
        tier_faculty.reserved_count = 36
        tier_student.reserved_count = 63
        await session.flush()

        # 11. Populate Realistic Scan Records & Attendance Curve
        print("Populating realistic scan check-ins for analytics curve...")
        all_tickets = [t_attendee, t_faculty, t_student] + tickets_batch
        all_qrs = [sec_attendee, sec_faculty, sec_student] + [eq.secret for eq in entity_qrs_batch]

        checkins_batch = []
        base_time = now - timedelta(hours=3)

        # ~140 scans at Main Gate (MULTI_ENTRY, ADMITTED)
        admitted_tickets = all_tickets[:140]
        admitted_qrs = all_qrs[:140]

        for i, (t, s) in enumerate(zip(admitted_tickets, admitted_qrs)):
            scan_time = base_time + timedelta(minutes=random.randint(0, 150))
            c = CheckIn(
                id=uuid.uuid4(),
                checkin_point_id=pt_main.id,
                ticket_id=t.id,
                qr_secret=s,
                policy_type="MULTI_ENTRY",
                status="ADMITTED",
                rejection_reason=None,
                scanned_at=scan_time,
                synced_at=scan_time + timedelta(seconds=1),
            )
            checkins_batch.append(c)

        # ~80 scans at Lunch Gate (SINGLE_USE, ADMITTED)
        lunch_tickets = admitted_tickets[:80]
        lunch_qrs = admitted_qrs[:80]

        for i, (t, s) in enumerate(zip(lunch_tickets, lunch_qrs)):
            scan_time = base_time + timedelta(minutes=random.randint(120, 180))
            c = CheckIn(
                id=uuid.uuid4(),
                checkin_point_id=pt_lunch.id,
                ticket_id=t.id,
                qr_secret=s,
                policy_type="SINGLE_USE",
                status="ADMITTED",
                rejection_reason=None,
                scanned_at=scan_time,
                synced_at=scan_time + timedelta(seconds=1),
            )
            checkins_batch.append(c)

        # ~12 duplicate scans at Lunch Gate (REJECTED, ALREADY_ADMITTED)
        for i, (t, s) in enumerate(zip(lunch_tickets[:12], lunch_qrs[:12])):
            scan_time = base_time + timedelta(minutes=random.randint(185, 210))
            c = CheckIn(
                id=uuid.uuid4(),
                checkin_point_id=pt_lunch.id,
                ticket_id=t.id,
                qr_secret=s,
                policy_type="SINGLE_USE",
                status="REJECTED",
                rejection_reason="ALREADY_ADMITTED",
                scanned_at=scan_time,
                synced_at=scan_time + timedelta(seconds=1),
            )
            checkins_batch.append(c)

        # ~6 tier-restricted rejections at Workshop (General tickets rejected)
        for i, (t, s) in enumerate(zip(all_tickets[200:206], all_qrs[200:206])):
            scan_time = base_time + timedelta(minutes=random.randint(60, 100))
            c = CheckIn(
                id=uuid.uuid4(),
                checkin_point_id=pt_workshop.id,
                ticket_id=t.id,
                qr_secret=s,
                policy_type="TIER_RESTRICTED",
                status="REJECTED",
                rejection_reason="TIER_NOT_ALLOWED",
                scanned_at=scan_time,
                synced_at=scan_time + timedelta(seconds=1),
            )
            checkins_batch.append(c)

        session.add_all(checkins_batch)
        await session.flush()
        print(f"Generated {len(checkins_batch)} realistic check-in scans.")

        # 12. Populate Sample Leads for Both Booths
        print("Populating exhibitor leads for Sina Robotics & Pars Biodrug...")
        leads_sina = [
            Lead(
                booth_id=booth_sina.id,
                ticket_id=t_faculty.id,
                captured_by_user_id=staff_sina_user.id,
                rating="HOT",
                tags=["جراحی لاپاراسکوپی", "درخواست دمو حضوری", "عضو هیئت علمی"],
                notes="بسیار علاقه‌مند به برگزاری کارگاه مشترک آموزشی در بیمارستان امام خمینی.",
            ),
            Lead(
                booth_id=booth_sina.id,
                ticket_id=admitted_tickets[10].id,
                captured_by_user_id=staff_sina_user.id,
                rating="WARM",
                tags=["تجهیزات پزشکی", "ارسال کاتالوگ"],
                notes="کاتالوگ فنی ارسال شد؛ پیگیری جلسه آنلاین در هفته آینده.",
            ),
            Lead(
                booth_id=booth_sina.id,
                ticket_id=admitted_tickets[25].id,
                captured_by_user_id=staff_sina_user.id,
                rating="COLD",
                tags=["عمومی"],
                notes="بروشور دریافت کرد.",
            ),
        ]
        leads_pars = [
            Lead(
                booth_id=booth_pars.id,
                ticket_id=t_attendee.id,
                captured_by_user_id=staff_pars_user.id,
                rating="HOT",
                tags=["دارودرمانی", "هوش مصنوعی"],
                notes="درخواست مشاوره جهت طراحی مدل یادگیری ماشین در کشف مولکول جدید دارویی.",
            ),
            Lead(
                booth_id=booth_pars.id,
                ticket_id=admitted_tickets[15].id,
                captured_by_user_id=staff_pars_user.id,
                rating="WARM",
                tags=["همکاری تحقیقاتی"],
                notes="پیشنهاد پروژه مشترک تحقیقاتی با دانشگاه تهران مطرح گردید.",
            ),
        ]
        session.add_all(leads_sina + leads_pars)

        # 13. Sample Connections & Bookmarks
        conn1 = Connection(
            user_id=user_faculty.id,
            connected_user_id=user_student.id,
            event_id=event.id,
            private_notes="ملاقات در افتتاحیه همایش — دانشجوی مستعد جهت کارآموزی آزمایشگاه.",
        )
        conn2 = Connection(
            user_id=user_attendee.id,
            connected_user_id=user_faculty.id,
            event_id=event.id,
            private_notes="استاد مشاور پروژه پایان‌نامه هوش مصنوعی.",
        )
        session.add_all([conn1, conn2])

        bm1 = BoothBookmark(user_id=user_attendee.id, booth_id=booth_sina.id)
        bm2 = BoothBookmark(user_id=user_faculty.id, booth_id=booth_sina.id)
        bm3 = BoothBookmark(user_id=user_student.id, booth_id=booth_pars.id)
        session.add_all([bm1, bm2, bm3])

        await session.commit()
        print("Demo dataset successfully committed to PostgreSQL!")

    # 14. Save local demo credentials to demo_credentials.json (gitignored)
    demo_credentials = {
        "event": {
            "name": "نخستین کنگره جامع هوش مصنوعی و فناوری‌های نوین سلامت ۱۴۰۵",
            "slug": DEMO_EVENT_SLUG,
            "url": f"http://127.0.0.1:5180/e/{DEMO_EVENT_SLUG}",
            "location": "مرکز همایش‌های بین‌المللی برج میلاد تهران",
        },
        "organizer": {
            "name": "انجمن انفورماتیک پزشکی ایران",
            "api_key": DEMO_ORGANIZER_KEY,
            "console_url": "http://127.0.0.1:5180/organizer",
            "desk_url": f"http://127.0.0.1:5180/organizer/events/{event.id}/desk",
            "analytics_url": f"http://127.0.0.1:5180/organizer/events/{event.id}/analytics",
        },
        "test_attendees": [
            {
                "email": "attendee@demo.ir",
                "password": ATTENDEE_PASSWORD,
                "name": "دکتر علی کریمی",
                "tier": "ثبت‌نام عمومی (پزشکان و پژوهشگران)",
                "status": "بلیط فعال / کارت آماده اسکن",
                "qr_secret": sec_attendee,
                "portal_url": "http://127.0.0.1:5180/my-tickets",
            },
            {
                "email": "faculty@demo.ir",
                "password": ATTENDEE_PASSWORD,
                "name": "دکتر سارا علوی",
                "tier": "اعضای هیئت علمی و سخنرانان مدعو (VIP)",
                "status": "پذیرفته شده در گیت اصلی و ناهار",
                "qr_secret": sec_faculty,
                "portal_url": "http://127.0.0.1:5180/my-tickets",
            },
            {
                "email": "student@demo.ir",
                "password": ATTENDEE_PASSWORD,
                "name": "امیرحسین رضایی",
                "tier": "دانشجویان و دستیاران تخصصی",
                "status": "پذیرفته شده در گیت اصلی",
                "qr_secret": sec_student,
                "portal_url": "http://127.0.0.1:5180/my-tickets",
            },
        ],
        "exhibitors": [
            {
                "booth_name": "سینا روبوتیک (سامانه جراحی رباتیک سینا)",
                "booth_slug": "sina-robotics",
                "portal_url": f"http://127.0.0.1:5180/booth/{booth_sina.id}",
                "staff_email": "staff@sinarobotics.ir",
                "staff_password": STAFF_PASSWORD,
                "staff_name": "مهندس علیرضا صبوری",
            },
            {
                "booth_name": "پارس بیودارو (فناوری‌های نوین دارویی)",
                "booth_slug": "pars-biodrug",
                "portal_url": f"http://127.0.0.1:5180/booth/{booth_pars.id}",
                "staff_email": "staff@parsbio.ir",
                "staff_password": STAFF_PASSWORD,
                "staff_name": "دکتر نیلوفر مهدوی",
            },
        ],
        "gate_scanners": [
            {
                "gate_name": "ورودی اصلی و گیت‌های کنترل تردد (گیت ۱)",
                "policy": "MULTI_ENTRY",
                "scanner_url": f"http://127.0.0.1:5180/scan/{pt_main.id}",
                "scanner_token": tok_main,
                "point_id": str(pt_main.id),
            },
            {
                "gate_name": "پذیرایی و ناهار سالن حافظ",
                "policy": "SINGLE_USE",
                "scanner_url": f"http://127.0.0.1:5180/scan/{pt_lunch.id}",
                "scanner_token": tok_lunch,
                "point_id": str(pt_lunch.id),
            },
            {
                "gate_name": "کارگاه تخصصی پردازش تصویر و جراحی رباتیک",
                "policy": "TIER_RESTRICTED (VIP)",
                "scanner_url": f"http://127.0.0.1:5180/scan/{pt_workshop.id}",
                "scanner_token": tok_work,
                "point_id": str(pt_workshop.id),
            },
        ],
    }

    out_file = os.path.abspath("demo_credentials.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(demo_credentials, f, indent=2, ensure_ascii=False)

    print(f"\n✔ Demo credentials securely saved to: {out_file}")
    print("==================================================")
    print("DEMO ENVIRONMENT SEEDING COMPLETED SUCCESSFULLY!")
    print("==================================================")


if __name__ == "__main__":
    asyncio.run(seed_demo())
