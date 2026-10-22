"""Seed (and describe) the persistent local manual-review demo environment.

Everything is created through the platform's supported HTTP API, so the data is internally consistent
with what the product itself would have produced (QR secrets, reserved counts, admissions, attribution).
Nothing is ever deleted, and an already seeded demo is left exactly as it is.

Run by ``scripts/demo/start.ps1`` (never against a shared database):

    CONGRESS_PLATFORM_ADMIN_TOKEN=... uv run python seed_demo.py --api URL --web URL --state-dir DIR

Writes, into --state-dir (gitignored):
  credentials.json  every demo credential, id and QR secret
  DEMO-GUIDE.md     portal URLs, accounts and the manual checklist (regenerated on every run)

All people and companies are synthetic; mobile numbers use the unassigned 0900 prefix, and the development
API sends no SMS (sign-in codes are read back through the platform-admin outbox).
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import random
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx

# 2: accounts are mobile numbers signed in by SMS code (e-mail and passwords removed).
SEED_VERSION = 2
ORG1_NAME = "Demo Medical Informatics Association"
ORG2_NAME = "انجمن قلب و عروق (نمونه)"
SLUG1 = "ai-health-2026"
SLUG2 = "cardio-forum-1405"
OPERATOR_MOBILES = {SLUG1: "09000000101", SLUG2: "09000000102"}

FIRST = ["Sara", "Omid", "Leila", "Kian", "Nasrin", "Arash", "Mina", "Farhad", "Tara", "Shayan",
         "Parisa", "Behnam", "Yasaman", "Kaveh", "Roya", "Sina", "Elham", "Darius", "Niloofar", "Payam"]
LAST = ["Ahmadi", "Hosseini", "Karimi", "Mousavi", "Jafari", "Rostami", "Ebrahimi", "Sadeghi", "Tavakoli",
        "Farahani", "Mahdavi", "Zand", "Shirazi", "Pakzad", "Azimi", "Nikbakht"]
ORGS = ["Tehran Demo University of Medical Sciences", "Demo General Hospital", "Persian Gulf Demo Clinic",
        "Sharif Demo Institute", "Demo Biotech Park", "Isfahan Demo Medical Center"]
TITLES = ["Physician", "Researcher", "Resident", "Data Scientist", "Nurse Informatics Lead", "Radiologist"]

# (key, full name, org, title, shares contact with peers)
PERSONAS = [
    ("alice", "Dr. Alice Rahimi", "Demo General Hospital", "Radiologist", True),
    ("bob", "Prof. Bahram Nouri", "Tehran Demo University of Medical Sciences", "Professor of Medical Imaging", True),
    ("carol", "Cyrus Student", "Sharif Demo Institute", "PhD Student", False),
    ("erin", "Erin Entry", "Demo Biotech Park", "Product Manager", True),
    ("frank", "Frank Fresh", "Isfahan Demo Medical Center", "Physician", True),
]


class SeedError(RuntimeError):
    pass


class Api:
    def __init__(self, base: str, admin_token: str) -> None:
        self.http = httpx.Client(base_url=base, timeout=60.0)
        self.admin_token = admin_token
        # One sign-in per number per run: SMS codes are rate limited per number.
        self.sessions: dict[str, tuple[str, str]] = {}

    def call(self, method: str, path: str, *, token: str | None = None, admin: bool = False,
             body: Any = None, params: dict[str, str] | None = None,
             expect: tuple[int, ...] = (200, 201)) -> httpx.Response:
        headers: dict[str, str] = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if admin:
            headers["X-Admin-Token"] = self.admin_token
        r = self.http.request(method, path, headers=headers, json=body, params=params)
        if r.status_code not in expect:
            raise SeedError(f"{method} {path} -> {r.status_code}: {r.text[:300]}")
        return r


def jwt_exp(token: str) -> datetime:
    payload = token.split(".")[1]
    data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    return datetime.fromtimestamp(int(data["exp"]), tz=timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def log(msg: str) -> None:
    print(f"  {msg}", flush=True)


# ───────────────────────────── ensure-style helpers (never delete, never duplicate) ─────────────────────────────

def sms_code(api: Api, mobile: str) -> str:
    """The newest sign-in code the development (console) SMS provider recorded for this number."""
    sent = api.call("GET", "/api/platform/sms-outbox", admin=True, params={"mobile": mobile}).json()
    codes = [m["code"] for m in sent if m["code"]]
    if not codes:
        raise SeedError(f"No sign-in code was recorded for {mobile}; is the API running with CONGRESS_SMS_PROVIDER=console?")
    return str(codes[0])


def user_session(api: Api, mobile: str, name: str, org: str = "", title: str = "") -> tuple[str, str]:
    """Sign in by SMS code (creating the account on first use); returns (access token, user id)."""
    if mobile in api.sessions:
        return api.sessions[mobile]
    while True:
        r = api.call("POST", "/api/auth/otp/request", expect=(202, 429), body={"mobile": mobile})
        if r.status_code == 202:
            break
        time.sleep(int(r.headers.get("retry-after", "5")))  # a previous run asked for a code moments ago
    verified = api.call("POST", "/api/auth/otp/verify", body={"mobile": mobile, "code": sms_code(api, mobile)}).json()
    if verified["status"] == "profile_required":
        verified = api.call("POST", "/api/auth/otp/complete", body={
            "signup_token": verified["signup_token"], "full_name": name, "organization": org, "title": title}).json()
    api.sessions[mobile] = (verified["access_token"], verified["user"]["id"])
    return api.sessions[mobile]


def ensure_event(api: Api, key: str, spec: dict[str, Any]) -> dict[str, Any]:
    """The demo congress exists. A congress created here is published right away (new events start as
    private drafts); an existing one is left exactly as its organizer set it."""
    for ev in api.call("GET", "/api/events", token=key).json():
        if ev["slug"] == spec["slug"]:
            return ev  # type: ignore[no-any-return]
    event: dict[str, Any] = api.call("POST", "/api/events", token=key, body=spec).json()
    page = api.call("GET", f"/api/events/{event['id']}/page", token=key).json()
    api.call("POST", f"/api/events/{event['id']}/page/publish", token=key, body={"revision": page["draft_revision"]})
    return event


def ensure_tier(api: Api, key: str, event_id: str, spec: dict[str, Any]) -> dict[str, Any]:
    for t in api.call("GET", f"/api/events/{event_id}/ticket-tiers", token=key).json():
        if t["name"] == spec["name"]:
            return t  # type: ignore[no-any-return]
    return api.call("POST", f"/api/events/{event_id}/ticket-tiers", token=key, body=spec).json()  # type: ignore[no-any-return]


def ensure_point(api: Api, key: str, event_id: str, spec: dict[str, Any]) -> dict[str, Any]:
    for p in api.call("GET", f"/api/events/{event_id}/checkin-points", token=key).json():
        if p["name"] == spec["name"]:
            return p  # type: ignore[no-any-return]
    return api.call("POST", f"/api/events/{event_id}/checkin-points", token=key, body=spec).json()  # type: ignore[no-any-return]


def ensure_booth(api: Api, key: str, event_id: str, spec: dict[str, Any], rep_mobile: str, rep_name: str) -> dict[str, Any]:
    booth = next((b for b in api.call("GET", f"/api/events/{event_id}/booths", token=key).json()
                  if b["slug"] == spec["slug"]), None)
    if booth is None:
        booth = api.call("POST", f"/api/events/{event_id}/booths", token=key, body=spec).json()
    staff = api.call("GET", f"/api/events/{event_id}/booths/{booth['id']}/staff", token=key).json()
    if not any(s["mobile"] == rep_mobile for s in staff):
        api.call("POST", f"/api/events/{event_id}/booths/{booth['id']}/staff", token=key,
                 body={"mobile": rep_mobile, "full_name": rep_name})
    return booth  # type: ignore[no-any-return]


def ensure_operator(api: Api, key: str, event_id: str, mobile: str, name: str) -> None:
    ops = api.call("GET", f"/api/events/{event_id}/desk/operators", token=key).json()
    if not any(o["mobile"] == mobile and not o["is_revoked"] for o in ops):
        api.call("POST", f"/api/events/{event_id}/desk/operators", token=key,
                 body={"mobile": mobile, "operator_name": name})


def ensure_ticket(api: Api, token: str, event_id: str, tier_id: str) -> str:
    """Returns the QR secret of the user's ticket for the event (reserving one if needed)."""
    for t in api.call("GET", "/api/attendees/me/tickets", token=token).json():
        if t["event_id"] == event_id:
            return t["qr_secret"]  # type: ignore[no-any-return]
    r = api.call("POST", f"/api/events/{event_id}/tickets/reserve", token=token, body={"ticket_tier_id": tier_id})
    return r.json()["qr_secret"]  # type: ignore[no-any-return]


def issue_scanner_credential(api: Api, key: str, point: dict[str, Any], device_name: str) -> dict[str, Any]:
    r = api.call("POST", f"/api/checkin-points/{point['id']}/token", token=key, body={"device_name": device_name}).json()
    return {"point_id": point["id"], "point_name": point["name"], "policy": point["policy_type"],
            "device_id": r["device_id"], "device_name": device_name, "token": r["scanner_token"],
            "expires_at": iso(jwt_exp(r["scanner_token"]))}


def submit_scans(api: Api, key: str, point_id: str, scans: list[tuple[str, str, datetime]]) -> dict[str, int]:
    """scans: (stable label, qr_secret, scanned_at). Deterministic scan ids make re-submission a no-op."""
    tally: dict[str, int] = {}
    payload = [{"scan_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"congress-demo/{point_id}/{label}")),
                "qr_secret": qr, "scanned_at": iso(at)} for label, qr, at in scans]
    for i in range(0, len(payload), 50):
        res = api.call("POST", f"/api/checkin-points/{point_id}/scans/batch", token=key,
                       body={"scans": payload[i:i + 50]}).json()["results"]
        for item in res:
            k = item["status"] + (f":{item['rejection_reason']}" if item.get("rejection_reason") else "")
            tally[k] = tally.get(k, 0) + 1
    return tally


# ───────────────────────────── the demo content ─────────────────────────────

def seed_content(api: Api, creds: dict[str, Any]) -> None:
    rng = random.Random(1405)
    now = datetime.now(timezone.utc)
    key1, key2 = creds["organizers"][0]["api_key"], creds["organizers"][1]["api_key"]

    print("Congress 1 (English, live now) ...")
    ev1 = ensure_event(api, key1, {
        "name": "AI in Healthcare Congress 2026", "slug": SLUG1,
        "starts_at": iso(now - timedelta(hours=5)), "ends_at": iso(now + timedelta(days=14)),
        "location": "Demo Convention Center, Hall A and Hall B",
        "description": "Synthetic demo congress: three days on clinical AI, medical imaging, robotic surgery and "
                       "health data, with an exhibition of demo companies. All people and companies are fictional."})
    t_general = ensure_tier(api, key1, ev1["id"], {"name": "General Delegate", "quota": 200,
                            "description": "Full access to the main hall and the exhibition."})
    t_faculty = ensure_tier(api, key1, ev1["id"], {"name": "Faculty & Speakers", "quota": 40,
                            "description": "Speaker lounge, workshop rooms and the main hall."})
    t_student = ensure_tier(api, key1, ev1["id"], {"name": "Student / Resident", "quota": 12,
                            "description": "Small quota on purpose: this tier is almost full."})
    ensure_tier(api, key1, ev1["id"], {"name": "Early Bird (closed)", "quota": 50, "is_open": False,
                "description": "Sales for this tier are closed on purpose."})
    p_main = ensure_point(api, key1, ev1["id"], {"name": "Main Gate", "location": "Entrance lobby", "policy_type": "MULTI_ENTRY"})
    p_lunch = ensure_point(api, key1, ev1["id"], {"name": "Lunch Hall", "location": "Ground floor catering", "policy_type": "SINGLE_USE"})
    p_work = ensure_point(api, key1, ev1["id"], {"name": "Workshop Room B", "location": "Clinical workshops wing",
                          "policy_type": "TIER_RESTRICTED", "allowed_tier_ids": [t_faculty["id"]]})
    p_hall = ensure_point(api, key1, ev1["id"], {"name": "Hall A (capacity capped)", "location": "Main hall",
                          "policy_type": "CAPACITY_CAPPED", "max_capacity": 30})

    print("Congress 2 (Persian / RTL, upcoming) ...")
    ev2 = ensure_event(api, key2, {
        "name": "همایش ملی قلب و عروق ۱۴۰۵", "slug": SLUG2,
        "starts_at": iso(now + timedelta(days=21)), "ends_at": iso(now + timedelta(days=23)),
        "location": "مرکز همایش‌های نمونه، تالار اصلی",
        "description": "همایش نمونهٔ ساختگی برای بررسی رابط راست‌به‌چپ. تمام افراد و شرکت‌ها خیالی هستند."})
    t2_delegate = ensure_tier(api, key2, ev2["id"], {"name": "شرکت‌کننده عمومی", "quota": 150, "description": "دسترسی به تالار اصلی و نمایشگاه."})
    ensure_tier(api, key2, ev2["id"], {"name": "دستیار تخصصی", "quota": 50, "description": "ویژهٔ دستیاران و دانشجویان."})
    p2_main = ensure_point(api, key2, ev2["id"], {"name": "ورودی اصلی", "location": "لابی", "policy_type": "MULTI_ENTRY"})

    print("Reception operators ...")
    ensure_operator(api, key1, ev1["id"], OPERATOR_MOBILES[SLUG1], "Maryam Bagheri")
    ensure_operator(api, key2, ev2["id"], OPERATOR_MOBILES[SLUG2], "Reza Operator")

    print("Booths and representatives ...")
    reps = {"neurolens": "09000000201", "cardiosense": "09000000202", "medbot": "09000000203",
            "genome": "09000000204", "rhythm": "09000000205", "imaging": "09000000206"}
    rep_names = {"neurolens": "Rep Neurolens", "cardiosense": "Rep Cardiosense", "medbot": "Rep Medbot",
                 "genome": "Rep Genome", "rhythm": "نماینده ریتم قلب", "imaging": "نماینده تصویربرداری"}
    for k, mobile in reps.items():
        user_session(api, mobile, rep_names[k], "Demo exhibitor")
    url = "https://example.com"
    booths = {
        "neurolens": ensure_booth(api, key1, ev1["id"], {"name": "NeuroLens Imaging", "slug": "neurolens-imaging", "location": "A-101",
                  "description": "AI-assisted MRI reading (fictional company).", "website_url": url, "brochure_url": f"{url}/neurolens.pdf"}, reps["neurolens"], rep_names["neurolens"]),
        "cardiosense": ensure_booth(api, key1, ev1["id"], {"name": "CardioSense Wearables", "slug": "cardiosense-wearables", "location": "A-102",
                  "description": "Continuous ECG patches and analytics (fictional company).", "website_url": url, "brochure_url": f"{url}/cardiosense.pdf"}, reps["cardiosense"], rep_names["cardiosense"]),
        "medbot": ensure_booth(api, key1, ev1["id"], {"name": "MedBot Surgical", "slug": "medbot-surgical", "location": "B-201",
                  "description": "Tele-operated laparoscopic platforms (fictional company).", "website_url": url, "brochure_url": f"{url}/medbot.pdf"}, reps["medbot"], rep_names["medbot"]),
        "genome": ensure_booth(api, key1, ev1["id"], {"name": "GenomeCloud Analytics", "slug": "genomecloud-analytics", "location": "B-202",
                  "description": "Cloud pipelines for clinical genomics (fictional company).", "website_url": url, "brochure_url": ""}, reps["genome"], rep_names["genome"]),
        "rhythm": ensure_booth(api, key2, ev2["id"], {"name": "ریتم قلب", "slug": "heart-rhythm", "location": "غرفه ۱",
                  "description": "سامانه‌های پایش ریتم قلب (شرکت خیالی).", "website_url": url, "brochure_url": ""}, reps["rhythm"], rep_names["rhythm"]),
        "imaging": ensure_booth(api, key2, ev2["id"], {"name": "تصویربرداری قلب", "slug": "cardio-imaging", "location": "غرفه ۲",
                  "description": "اکوکاردیوگرافی هوشمند (شرکت خیالی).", "website_url": url, "brochure_url": ""}, reps["imaging"], rep_names["imaging"]),
    }

    print("Attendees and tickets ...")
    people: dict[str, dict[str, Any]] = {}

    def add_person(key: str, mobile: str, name: str, org: str, title: str, share: bool,
                   t1: dict[str, Any] | None, t2: dict[str, Any] | None) -> None:
        token, uid = user_session(api, mobile, name, org, title)
        api.call("PATCH", "/api/attendees/me/network/privacy", token=token, body={"share_contact_with_peers": share})
        qr1 = ensure_ticket(api, token, ev1["id"], t1["id"]) if t1 else None
        qr2 = ensure_ticket(api, token, ev2["id"], t2["id"]) if t2 else None
        people[key] = {"mobile": mobile, "name": name, "token": token, "user_id": uid, "qr1": qr1, "qr2": qr2,
                       "tier1": t1["name"] if t1 else None, "tier2": t2["name"] if t2 else None}

    tiers_for = {"alice": (t_general, t2_delegate), "bob": (t_faculty, t2_delegate), "carol": (t_student, None),
                 "erin": (t_general, None), "frank": (t_general, None)}
    mobiles = {"alice": "09000000001", "bob": "09000000002", "carol": "09000000003",
               "erin": "09000000004", "frank": "09000000005"}
    for key, name, org, title, share in PERSONAS:
        add_person(key, mobiles[key], name, org, title, share, *tiers_for[key])
    for i in range(1, 41):  # 28 General, 4 Faculty, 8 Student; every 4th is also registered for Congress 2
        tier1 = t_general if i <= 28 else t_faculty if i <= 32 else t_student
        name = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
        add_person(f"f{i:02d}", f"0900001{i:04d}", name, rng.choice(ORGS), rng.choice(TITLES),
                   i % 3 != 0, tier1, t2_delegate if i % 4 == 0 else None)
    log(f"{len(people)} attendees, tickets issued for both congresses where applicable")

    print("Leads ...")
    def lead(booth_key: str, person: str, rating: str, tags: list[str], notes: str, event_no: int = 1) -> None:
        rep_token, _ = user_session(api, reps[booth_key], rep_names[booth_key])
        qr = people[person]["qr1" if event_no == 1 else "qr2"]
        api.call("POST", f"/api/booths/{booths[booth_key]['id']}/leads/scan", token=rep_token, expect=(200, 201),
                 body={"qr_secret": qr, "rating": rating, "tags": tags, "notes": notes})
    lead("neurolens", "alice", "HOT", ["demo-request", "radiology"], "Wants an on-site demo for the imaging department.")
    lead("neurolens", "bob", "WARM", ["research"], "Interested in a joint validation study. Follow up next week.")
    lead("neurolens", "carol", "COLD", [], "Collected the brochure.")
    lead("neurolens", "f03", "WARM", ["catalogue"], "Asked for the technical datasheet.")
    lead("cardiosense", "alice", "WARM", ["wearables"], "Compared two patch models.")
    lead("cardiosense", "f05", "HOT", ["pilot", "cardiology"], "Pilot with 40 patients requested.")
    lead("cardiosense", "f06", "COLD", [], "")
    lead("medbot", "bob", "HOT", ["training", "surgery"], "Faculty training programme enquiry.")
    lead("genome", "f07", "WARM", ["pipeline"], "Wants pricing for 500 samples per month.")
    lead("rhythm", "alice", "HOT", ["پایش"], "درخواست نمایش حضوری.", event_no=2)
    lead("imaging", "bob", "WARM", ["همکاری"], "پیگیری پس از همایش.", event_no=2)

    print("Bookmarks and connections ...")
    def bookmark(person: str, booth_key: str) -> None:
        tok = people[person]["token"]
        have = {b["booth_id"] for b in api.call("GET", "/api/attendees/me/bookmarks/booths", token=tok).json()}
        if booths[booth_key]["id"] not in have:
            api.call("POST", f"/api/attendees/me/bookmarks/booths/{booths[booth_key]['id']}", token=tok, expect=(200, 201))
    for person, booth_key in (("alice", "neurolens"), ("alice", "medbot"), ("bob", "cardiosense"), ("carol", "neurolens"), ("alice", "rhythm")):
        bookmark(person, booth_key)

    def connect(a: str, b: str, note: str, event_no: int = 1) -> None:
        api.call("POST", "/api/attendees/me/network/scan", token=people[a]["token"], expect=(200, 201), body={
            "qr_secret": people[b]["qr1" if event_no == 1 else "qr2"], "private_notes": note,
            "event_id": (ev1 if event_no == 1 else ev2)["id"]})
    connect("alice", "bob", "Met after the keynote; possible thesis advisor.")
    connect("alice", "carol", "Student interested in imaging research.")
    connect("bob", "carol", "Promising PhD student, invite to the lab.")
    connect("bob", "alice", "Radiology collaboration.")
    connect("alice", "bob", "Congress 2: follow up on the cardiac imaging session.", event_no=2)

    print("Gate scans (history for analytics) ...")
    def at(minutes_ago_lo: int, minutes_ago_hi: int) -> datetime:
        return now - timedelta(minutes=rng.randint(minutes_ago_lo, minutes_ago_hi))

    admitted = ["alice", "bob", "carol", "frank"] + [f"f{i:02d}" for i in range(1, 27)]
    main_scans = [(f"main/{p}", people[p]["qr1"], at(60, 290)) for p in admitted]
    main_scans.append(("main/invalid-1", "not-a-real-demo-badge-0001", at(30, 120)))
    main_scans.append(("main/other-congress", people["f04"]["qr2"], at(30, 120)))
    lunch_scans = [(f"lunch/{p}", people[p]["qr1"], at(20, 120)) for p in ["alice"] + [f"f{i:02d}" for i in range(1, 13)]]
    lunch_scans += [(f"lunch/dup-{p}", people[p]["qr1"], at(5, 19)) for p in ["alice", "f01", "f02", "f03"]]
    work_scans = [(f"work/{p}", people[p]["qr1"], at(40, 150)) for p in ["bob", "f29", "f30"]]
    work_scans += [(f"work/denied-{p}", people[p]["qr1"], at(40, 150)) for p in ["carol", "f01", "f02"]]
    hall_scans = [(f"hall/{p}", people[p]["qr1"], at(10, 200)) for p in ["alice", "bob", "f01", "f02", "f03", "f04"]]
    for point, scans in ((p_main, main_scans), (p_lunch, lunch_scans), (p_work, work_scans), (p_hall, hall_scans)):
        log(f"{point['name']}: {submit_scans(api, key1, point['id'], scans)}")

    creds["ids"] = {
        "events": [{"slug": SLUG1, "id": ev1["id"], "name": ev1["name"]}, {"slug": SLUG2, "id": ev2["id"], "name": ev2["name"]}],
        "points": {"main": p_main["id"], "lunch": p_lunch["id"], "workshop": p_work["id"], "hall": p_hall["id"], "cardio_main": p2_main["id"]},
        "point_names": {p["id"]: p["name"] for p in (p_main, p_lunch, p_work, p_hall, p2_main)},
        "booths": {k: {"id": b["id"], "name": b["name"], "slug": b["slug"], "rep_mobile": reps[k],
                       "event_slug": SLUG1 if k in ("neurolens", "cardiosense", "medbot", "genome") else SLUG2}
                   for k, b in booths.items()},
        "tiers": {"general": t_general["id"], "faculty": t_faculty["id"], "student": t_student["id"], "delegate2": t2_delegate["id"]},
    }
    creds["people"] = {k: {kk: v for kk, v in p.items() if kk not in ("token",)} for k, p in people.items()
                       if k in {pk for pk, *_ in PERSONAS}}
    creds["operators"] = [
        {"event_slug": SLUG1, "mobile": OPERATOR_MOBILES[SLUG1], "name": "Maryam Bagheri"},
        {"event_slug": SLUG2, "mobile": OPERATOR_MOBILES[SLUG2], "name": "Reza Operator"}]
    creds["scanner_points"] = [p_main, p_lunch, p_work, p_hall]
    creds["scanner_points_event2"] = [p2_main]


def refresh_scanner_credentials(api: Api, creds: dict[str, Any]) -> None:
    """Scanner device tokens last 7 days. Keep one valid credential per gate; mint a new one when < 48h remain."""
    keys = [o["api_key"] for o in creds["organizers"]]
    existing = {c["point_id"]: c for c in creds.get("scanner_credentials", [])}
    now = datetime.now(timezone.utc)
    out = []
    for key, points in ((keys[0], creds["scanner_points"]), (keys[1], creds["scanner_points_event2"])):
        for p in points:
            cur = existing.get(p["id"])
            if cur and datetime.fromisoformat(cur["expires_at"].replace("Z", "+00:00")) - now > timedelta(hours=48):
                out.append(cur)
                continue
            out.append(issue_scanner_credential(api, key, p, f"Demo scanner - {p['name']}"))
            log(f"scanner credential issued for gate '{p['name']}'")
    creds["scanner_credentials"] = out


def provision(api: Api, creds_path: Path) -> dict[str, Any]:
    if creds_path.exists():
        creds: dict[str, Any] = json.loads(creds_path.read_text(encoding="utf-8"))
        if creds.get("seed_version") == SEED_VERSION and creds.get("seeded_at"):
            api.call("GET", "/api/events", token=creds["organizers"][0]["api_key"])  # credentials still valid?
            print("Demo data already present: left untouched.")
            return creds
        if creds.get("seed_version") != SEED_VERSION:
            raise SeedError(
                "This demo was seeded by an older version (e-mail and password accounts). Run "
                "scripts\\demo\\reset.ps1 to start over with mobile-number sign-in.")
        print("Resuming an interrupted seed ...")
    else:
        if api.http.get(f"/api/public/events/{SLUG1}").status_code == 200:
            raise SeedError(
                "The demo database already contains the demo congress, but .demo/credentials.json (the only place the "
                "one-time Organizer API keys exist) is missing. Run scripts\\demo\\reset.ps1 to start over.")
        creds = {"seed_version": SEED_VERSION, "organizers": []}
        for name in (ORG1_NAME, ORG2_NAME):
            o = api.call("POST", "/api/organizers", admin=True, body={"name": name}).json()
            creds["organizers"].append({"name": o["name"], "id": o["id"], "api_key": o["api_key"]})
        creds_path.write_text(json.dumps(creds, indent=2, ensure_ascii=False), encoding="utf-8")  # keys exist only now
        print("Provisioned 2 organizers.")
    seed_content(api, creds)
    creds["seeded_at"] = iso(datetime.now(timezone.utc))
    return creds


# ───────────────────────────── the generated guide ─────────────────────────────

def write_guide(creds: dict[str, Any], web: str, api_url: str, path: Path) -> None:
    ids = creds["ids"]
    e1, e2 = ids["events"]
    org1, org2 = creds["organizers"]
    p = creds["people"]
    sc = {c["point_id"]: c for c in creds["scanner_credentials"]}
    b = ids["booths"]
    pts = ids["points"]
    L: list[str] = []
    add = L.append
    add("# Congress Platform - local demo guide")
    add("")
    add(f"_Generated {creds['seeded_at']}. Contains credentials: local file, gitignored, synthetic data only. Services listen on 127.0.0.1 only._")
    add("")
    add(f"- Web: **{web}**   API: {api_url}   (API docs: {api_url}/docs)")
    add("- Demo users (attendees, representatives, reception operators) sign in with their mobile number and a 6-digit SMS code. "
        "The development API sends no SMS: the code is printed in the API window (\"SMS (not sent, development)\").")
    add("- Scanner tokens are not printed here. Copy one to the clipboard with `scripts\\demo\\credentials.ps1 -CopyScannerToken main` "
        "(names: main, lunch, workshop, hall, cardio). Tokens are valid 7 days; `start.ps1` renews them when < 48 h remain.")
    add("")
    add("## Language and layout (read this first)")
    add("- The attendee, organizer, reception and exhibitor portals **default to Persian (RTL)**; the public congress/booth pages and the gate scanner are English. "
        "The portal language is stored per browser (`localStorage`) and shared by those portals on this URL. Use the language switch in the page header "
        "(\"English\" / \"فارسی\") to change it; English (LTR) is what the checklist below quotes.")
    add("- For a mobile view use the browser dev-tools device toolbar (e.g. 390 x 844); no separate mobile URL exists.")
    add("")
    add("## Congresses")
    add(f"| | Congress 1 (English, live now) | Congress 2 (Persian / RTL, in 3 weeks) |")
    add("|:--|:--|:--|")
    add(f"| name | {e1['name']} | {e2['name']} |")
    add(f"| slug | `{e1['slug']}` | `{e2['slug']}` |")
    add(f"| event id | `{e1['id']}` | `{e2['id']}` |")
    add(f"| Organizer | {org1['name']} | {org2['name']} |")
    add("")
    add("## Portals (verified URLs)")
    add("| Portal | URL |")
    add("|:--|:--|")
    add(f"| Platform landing | {web}/ |")
    add(f"| Public congress 1 | {web}/e/{e1['slug']} |")
    add(f"| Public congress 2 (RTL) | {web}/e/{e2['slug']} |")
    for k in ("neurolens", "cardiosense", "medbot", "genome"):
        add(f"| Public booth: {b[k]['name']} | {web}/e/{e1['slug']}/booths/{b[k]['id']} |")
    for k in ("rhythm", "imaging"):
        add(f"| Public booth: {b[k]['name']} (RTL) | {web}/e/{e2['slug']}/booths/{b[k]['id']} |")
    add(f"| Attendee sign-in | {web}/c/{e1['slug']}/sign-in  (generic: {web}/sign-in) |")
    for page, label in (("my-congress", "Attendee: My Congress"), ("my-ticket", "Attendee: My Ticket"),
                        ("my-network", "Attendee: My Network"), ("my-profile", "Attendee: My Profile"), ("details", "Attendee: Congress Details")):
        add(f"| {label} | {web}/c/{e1['slug']}/{page} |")
    add(f"| Organizer portal (sign in with API key) | {web}/organizer |")
    add(f"| Organizer event workspace | {web}/organizer/events/{e1['id']} |")
    add(f"| Organizer analytics | {web}/organizer/events/{e1['id']}/analytics |")
    add(f"| Organizer front desk (organizer-run desk) | {web}/organizer/events/{e1['id']}/desk |")
    add(f"| Reception portal entry (enter congress code `{e1['slug']}`) | {web}/reception |")
    add(f"| Reception, congress 1 direct | {web}/reception/{e1['id']} |")
    add(f"| Reception, congress 2 direct | {web}/reception/{e2['id']} |")
    for k in ("neurolens", "cardiosense", "medbot", "genome", "rhythm", "imaging"):
        add(f"| Exhibitor portal: {b[k]['name']} | {web}/booth/{b[k]['id']} |")
    for name, pid in (("Main Gate (multi-entry)", pts["main"]), ("Lunch Hall (single-use)", pts["lunch"]),
                      ("Workshop Room B (Faculty only)", pts["workshop"]), ("Hall A (capacity 30)", pts["hall"]),
                      ("Congress 2 main entrance", pts["cardio_main"])):
        add(f"| Gate Scanner: {name} | {web}/scan/{pid} |")
    add("")
    add("## Accounts")
    add("| Role | Sign in with | Notes |")
    add("|:--|:--|:--|")
    add(f"| Organizer 1 (congress 1) | API key `{org1['api_key']}` | at {web}/organizer |")
    add(f"| Organizer 2 (congress 2) | API key `{org2['api_key']}` | sees only congress 2; congress 1 is invisible to it |")
    for key in ("alice", "bob", "carol", "erin", "frank"):
        x = p[key]
        t2 = f", congress 2: {x['tier2']}" if x["tier2"] else ""
        add(f"| Attendee {x['name']} | mobile `{x['mobile']}` + SMS code | congress 1: {x['tier1']}{t2} |")
    for op in creds["operators"]:
        add(f"| Reception operator ({op['event_slug']}) | mobile `{op['mobile']}` + SMS code | congress code `{op['event_slug']}` |")
    for k in ("neurolens", "cardiosense", "medbot", "genome", "rhythm", "imaging"):
        add(f"| BoothStaff: {b[k]['name']} | mobile `{b[k]['rep_mobile']}` + SMS code | authorized for this booth only (other booths answer 403) |")
    add("| Scanner | device credential, not a password | see the clipboard command above; paste it into the scanner's credential field |")
    add("")
    add("## Controlled test badges (manual entry; secrets are QR payloads)")
    add("| Purpose | Holder | QR secret |")
    add("|:--|:--|:--|")
    add(f"| Fresh badge - never scanned anywhere: admit at Lunch (single-use), then scan again for the duplicate rejection | {p['erin']['name']} | `{p['erin']['qr1']}` |")
    add(f"| Already admitted at Main Gate and at Lunch: expect ALREADY_ADMITTED at Lunch | {p['alice']['name']} | `{p['alice']['qr1']}` |")
    add(f"| Faculty: admitted at the Workshop gate | {p['bob']['name']} | `{p['bob']['qr1']}` |")
    add(f"| Student: refused at the Workshop gate (TIER_NOT_ALLOWED) | {p['carol']['name']} | `{p['carol']['qr1']}` |")
    add(f"| Congress 2 badge: refused at any congress 1 gate (EVENT_MISMATCH) | {p['alice']['name']} (congress 2 pass) | `{p['alice']['qr2']}` |")
    add("| Unknown badge: refused INVALID_TICKET | - | `not-a-real-demo-badge-0001` (already used once; type any other random string) |")
    add("")
    add("## Manual checklist")
    add(f"""### Public
- [ ] Open {web}/e/{e1['slug']}: event info, tiers with capacity (Student / Resident is nearly full, Early Bird is closed).
- [ ] Reserve a free pass with a brand-new mobile number (e.g. 0900 999 0001): enter the SMS code from the API window, complete the profile; the pass appears with a QR.
- [ ] Reserve again with the same number: you are signed in to the existing account and told you already hold a pass.
- [ ] Open the public booth profiles from the table above.
### Attendee
- [ ] Sign in at {web}/c/{e1['slug']}/sign-in with `{p['alice']['mobile']}` and the SMS code; walk the five destinations (My Congress, My Ticket, My Network, My Profile, Details).
- [ ] My Ticket shows the tier and a QR; switch to congress 2 (Alice holds a pass in both) and check nothing from congress 1 leaks in.
- [ ] My Network (congress 1): Alice is connected to Bahram and Cyrus; edit a note; Carol hides her contact details (privacy off), Bob shares them.
- [ ] Bookmark/unbookmark booths; toggle the profile privacy setting.
### Organizer
- [ ] Sign in at {web}/organizer with Organizer 1's API key; open the congress; inspect tiers, capacity, booths, check-in points, operators.
- [ ] Open Analytics (about 30 admissions, rejections, per-gate bars) and download the CSV.
- [ ] Sign in with Organizer 2's key in a private window: only congress 2 is visible.
### Reception
- [ ] Open {web}/reception, enter `{e1['slug']}`, sign in with `{OPERATOR_MOBILES[SLUG1]}` and the SMS code.
- [ ] Search "Alice", review the pass, print it. Issue a walk-in ticket for a new person.
- [ ] Register `{p['erin']['mobile']}` again as a walk-in: duplicate feedback offering the existing pass.
### Exhibitor
- [ ] Open the NeuroLens booth URL, sign in with `{b['neurolens']['rep_mobile']}` and the SMS code.
- [ ] Capture a badge with manual input (use Frank's or Erin's secret from the table); open leads; change rating, tags and notes; export CSV.
- [ ] Open the CardioSense booth URL while signed in as the NeuroLens rep: expect a refusal.
### Scanner
- [ ] Copy the Main Gate token (`credentials.ps1 -CopyScannerToken main`), open the Main Gate scanner URL, paste it into the \"Pair Scanner Device\" field and press \"Authorize This Device\" (the field is masked; never put the token in the URL).
- [ ] Inspect the manifest; enter a badge secret manually; check admitted / duplicate handling on the Lunch gate (single-use).
- [ ] This is keyboard simulation. Camera decoding and USB HID reader input are NOT verified by this environment.
### Languages and viewports
- [ ] Switch the attendee language to Persian (RTL) or open congress 2 (Persian content); use the browser dev-tools device toolbar for a 390 px mobile viewport.

## Known limitations (intentional or not yet built - not setup failures)
- No payment or paid tiers; registration is free (ADR 0007).
- Scanner devices can also be paired from the organizer's Check-In Gates page (Pair device shows a QR pairing link); the seed issues one token per gate through the API.
- Scanner tokens expire after 7 days.
- The camera and USB HID paths cannot be exercised without hardware; manual entry is the simulated path.
- No SMS is sent in the demo (console provider): sign-in codes are printed in the API window, ticket confirmations are recorded but not delivered.
- The development server has the PWA service worker disabled, so offline-install behaviour is not representative.
- Congress 1 started 5 hours before the demo was first created and ends 14 days after that; congress 2 starts in 21 days. Dates are relative to the moment the demo was created.
- Congress 2 is upcoming: its analytics and gate history are intentionally empty.
""")
    path.write_text("\n".join(L), encoding="utf-8")


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", required=True)
    ap.add_argument("--web", required=True)
    ap.add_argument("--state-dir", required=True)
    args = ap.parse_args()
    admin = os.environ.get("CONGRESS_PLATFORM_ADMIN_TOKEN", "")
    if not admin:
        print("CONGRESS_PLATFORM_ADMIN_TOKEN is required", file=sys.stderr)
        return 2
    state = Path(args.state_dir)
    state.mkdir(parents=True, exist_ok=True)
    api = Api(args.api, admin)
    try:
        creds = provision(api, state / "credentials.json")
        refresh_scanner_credentials(api, creds)
    except (SeedError, httpx.HTTPError) as exc:
        print(f"SEED FAILED: {exc}", file=sys.stderr)
        return 1
    (state / "credentials.json").write_text(json.dumps(creds, indent=2, ensure_ascii=False), encoding="utf-8")
    write_guide(creds, args.web.rstrip("/"), args.api.rstrip("/"), state / "DEMO-GUIDE.md")
    print(f"Guide: {state / 'DEMO-GUIDE.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
