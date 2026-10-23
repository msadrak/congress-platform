"""Congress program (sessions) and venue directory (entrances, halls): organizer CRUD, timetable import,
tenant isolation, and the live data attendees get in the public event payload (ADR 0014)."""

from typing import Any

from httpx import AsyncClient

from tests.helpers import bearer, provision_organizer, publish_page
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event

PUBLIC = f"/api/public/events/{EVENT['slug']}"


def venue_url(event_id: str) -> str:
    return f"/api/events/{event_id}/venue-places"


def sessions_url(event_id: str) -> str:
    return f"/api/events/{event_id}/sessions"


async def add_place(
    client: AsyncClient, organizer: dict[str, str], event_id: str, kind: str, name: str, location: str = ""
) -> dict[str, Any]:
    response = await client.post(
        venue_url(event_id), json={"kind": kind, "name": name, "location": location}, headers=bearer(organizer)
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def session_body(**overrides: Any) -> dict[str, Any]:
    return {
        "title": "Opening Keynote",
        "track": "Keynote",
        "speakers": "Dr. Sara Ahmadi",
        "description": "Welcome and state of the field.",
        "hall_id": None,
        "starts_at": "2027-04-10T09:00:00Z",
        "ends_at": "2027-04-10T10:00:00Z",
        **overrides,
    }


async def add_session(
    client: AsyncClient, organizer: dict[str, str], event_id: str, **overrides: Any
) -> dict[str, Any]:
    response = await client.post(sessions_url(event_id), json=session_body(**overrides), headers=bearer(organizer))
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def second_event(client: AsyncClient, organizer: dict[str, str], slug: str) -> str:
    response = await client.post("/api/events", json={**EVENT, "slug": slug}, headers=bearer(organizer))
    assert response.status_code == 201, response.text
    event_id: str = response.json()["id"]
    return event_id


async def test_venue_lists_entrances_first_then_halls_in_the_organizers_order(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    hall_b = await add_place(client, organizer, event_id, "hall", "Hall B", "Second floor")
    north = await add_place(client, organizer, event_id, "entrance", "  North Gate  ", "Valiasr St.")
    hall_a = await add_place(client, organizer, event_id, "hall", "Hall A")
    await add_place(client, organizer, event_id, "entrance", "South Gate")

    assert (hall_b["position"], hall_a["position"], north["position"]) == (0, 1, 0)
    assert north["name"] == "North Gate"

    moved = await client.patch(
        f"{venue_url(event_id)}/{hall_b['id']}", json={"position": 2, "location": " Third floor "}, headers=bearer(organizer)
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["kind"] == "hall"
    assert moved.json()["location"] == "Third floor"

    listed = await client.get(venue_url(event_id), headers=bearer(organizer))
    assert [(p["kind"], p["name"]) for p in listed.json()] == [
        ("entrance", "North Gate"),
        ("entrance", "South Gate"),
        ("hall", "Hall A"),
        ("hall", "Hall B"),
    ]


async def test_a_hall_with_sessions_cannot_be_deleted_until_they_move(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    hall = await add_place(client, organizer, event_id, "hall", "Main Hall")
    created = await add_session(client, organizer, event_id, hall_id=hall["id"])
    await add_session(client, organizer, event_id, title="Second", hall_id=hall["id"])
    assert created["hall_name"] == "Main Hall"

    refused = await client.delete(f"{venue_url(event_id)}/{hall['id']}", headers=bearer(organizer))
    assert refused.status_code == 409
    assert refused.json()["code"] == "HALL_IN_USE"
    assert "2 session" in refused.json()["detail"]

    for session in (await client.get(sessions_url(event_id), headers=bearer(organizer))).json():
        await client.patch(f"{sessions_url(event_id)}/{session['id']}", json={"hall_id": None}, headers=bearer(organizer))
    deleted = await client.delete(f"{venue_url(event_id)}/{hall['id']}", headers=bearer(organizer))
    assert deleted.status_code == 204
    again = await client.delete(f"{venue_url(event_id)}/{hall['id']}", headers=bearer(organizer))
    assert again.status_code == 404
    assert (await client.get(venue_url(event_id), headers=bearer(organizer))).json() == []


async def test_hall_names_are_unique_per_event_ignoring_case_and_spacing(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    other_event_id = await second_event(client, organizer, "autumn-congress-2027")
    main = await add_place(client, organizer, event_id, "hall", "Main Hall")
    side = await add_place(client, organizer, event_id, "hall", "Side Room")

    clash = await client.post(venue_url(event_id), json={"kind": "hall", "name": " main   HALL "}, headers=bearer(organizer))
    assert (clash.status_code, clash.json()["code"]) == (409, "HALL_NAME_TAKEN")
    rename = await client.patch(f"{venue_url(event_id)}/{side['id']}", json={"name": "MAIN hall"}, headers=bearer(organizer))
    assert rename.status_code == 409
    # Renaming a hall to its own name in another case, an entrance of the same name and another event's hall are fine.
    assert (await client.patch(f"{venue_url(event_id)}/{main['id']}", json={"name": "Main HALL"}, headers=bearer(organizer))).status_code == 200
    await add_place(client, organizer, event_id, "entrance", "Main Hall")
    await add_place(client, organizer, other_event_id, "hall", "Main Hall")


async def test_sessions_must_fall_within_the_event_days_in_its_time_zone(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    # 2027-04-10T08:00Z .. 2027-04-12T18:00Z is 10–12 April in Tehran (+03:30): any time on those days is fine.
    event_id = await create_event(client, organizer)
    early = await add_session(client, organizer, event_id, starts_at="2027-04-10T00:00:00+03:30", ends_at="2027-04-10T01:00:00+03:30")
    late = await add_session(client, organizer, event_id, starts_at="2027-04-12T22:00:00+03:30", ends_at="2027-04-13T00:00:00+03:30")
    assert early and late

    outside = [
        session_body(starts_at="2027-04-09T23:30:00+03:30", ends_at="2027-04-10T09:00:00+03:30"),
        session_body(starts_at="2027-04-12T23:00:00+03:30", ends_at="2027-04-13T00:30:00+03:30"),
        session_body(starts_at="2027-05-01T09:00:00Z", ends_at="2027-05-01T10:00:00Z"),
    ]
    for body in outside:
        response = await client.post(sessions_url(event_id), json=body, headers=bearer(organizer))
        assert response.status_code == 422, response.text
        assert "event days" in response.json()["detail"]
    moved = await client.patch(
        f"{sessions_url(event_id)}/{early['id']}",
        json={"starts_at": "2027-04-09T09:00:00Z", "ends_at": "2027-04-09T10:00:00Z"},
        headers=bearer(organizer),
    )
    assert moved.status_code == 422
    same_time = await client.post(
        sessions_url(event_id), json=session_body(ends_at="2027-04-10T09:00:00Z"), headers=bearer(organizer)
    )
    assert same_time.status_code == 422

    # In Europe/Berlin (+02:00) the same instants span 10–12 April as well, but 01:00 Tehran is 9 April there.
    berlin = await client.patch(f"/api/events/{event_id}", json={"timezone": "Europe/Berlin"}, headers=bearer(organizer))
    assert berlin.status_code == 200
    again = await client.post(
        sessions_url(event_id),
        json=session_body(starts_at="2027-04-10T00:00:00+03:30", ends_at="2027-04-10T01:00:00+03:30"),
        headers=bearer(organizer),
    )
    assert again.status_code == 422

    rows = [{"title": "Too late", "starts_at": "2027-04-20T09:00:00Z", "ends_at": "2027-04-20T10:00:00Z"}]
    imported = await client.post(f"{sessions_url(event_id)}/import", json={"sessions": rows}, headers=bearer(organizer))
    assert imported.status_code == 422
    assert imported.json()["detail"].startswith("Row 1: ")


async def test_sessions_are_listed_by_start_and_edited_partially(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    hall = await add_place(client, organizer, event_id, "hall", "Main Hall")
    later = await add_session(
        client, organizer, event_id, title="  Imaging Workshop  ", hall_id=hall["id"],
        starts_at="2027-04-10T11:00:00Z", ends_at="2027-04-10T12:30:00Z",
    )
    earlier = await add_session(client, organizer, event_id)
    assert later["title"] == "Imaging Workshop"

    listed = await client.get(sessions_url(event_id), headers=bearer(organizer))
    assert [s["id"] for s in listed.json()] == [earlier["id"], later["id"]]

    retracked = await client.patch(
        f"{sessions_url(event_id)}/{later['id']}", json={"track": "Workshop"}, headers=bearer(organizer)
    )
    assert retracked.status_code == 200, retracked.text
    assert (retracked.json()["track"], retracked.json()["hall_name"]) == ("Workshop", "Main Hall")
    assert retracked.json()["title"] == "Imaging Workshop"

    cleared = await client.patch(
        f"{sessions_url(event_id)}/{later['id']}", json={"hall_id": None}, headers=bearer(organizer)
    )
    assert (cleared.json()["hall_id"], cleared.json()["hall_name"]) == (None, "")

    removed = await client.delete(f"{sessions_url(event_id)}/{earlier['id']}", headers=bearer(organizer))
    assert removed.status_code == 204
    listed = await client.get(sessions_url(event_id), headers=bearer(organizer))
    assert [s["id"] for s in listed.json()] == [later["id"]]


async def test_invalid_session_times_and_halls_are_rejected(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    other_event_id = await second_event(client, organizer, "autumn-congress-2027")
    entrance = await add_place(client, organizer, event_id, "entrance", "North Gate")
    foreign_hall = await add_place(client, organizer, other_event_id, "hall", "Other Hall")
    session = await add_session(client, organizer, event_id)

    rejected = [
        await client.post(
            sessions_url(event_id),
            json=session_body(starts_at="2027-04-10T10:00:00Z", ends_at="2027-04-10T09:59:00Z"),
            headers=bearer(organizer),
        ),
        await client.post(
            sessions_url(event_id), json=session_body(starts_at="2027-04-10T09:00:00"), headers=bearer(organizer)
        ),
        await client.post(sessions_url(event_id), json=session_body(hall_id=foreign_hall["id"]), headers=bearer(organizer)),
        await client.post(sessions_url(event_id), json=session_body(hall_id=entrance["id"]), headers=bearer(organizer)),
        await client.patch(
            f"{sessions_url(event_id)}/{session['id']}", json={"ends_at": "2027-04-10T08:00:00Z"}, headers=bearer(organizer)
        ),
        await client.patch(
            f"{sessions_url(event_id)}/{session['id']}", json={"hall_id": entrance["id"]}, headers=bearer(organizer)
        ),
    ]

    assert [r.status_code for r in rejected] == [422] * len(rejected)
    (unchanged,) = (await client.get(sessions_url(event_id), headers=bearer(organizer))).json()
    assert unchanged == session


async def test_import_matches_halls_by_name_and_creates_unknown_ones(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    main = await add_place(client, organizer, event_id, "hall", "Main Hall")
    await add_place(client, organizer, event_id, "entrance", "Workshop Room")  # an entrance is never a hall
    rows = [
        {"title": "Keynote", "hall": "  main HALL ", "starts_at": "2027-04-10T09:00:00Z", "ends_at": "2027-04-10T10:00:00Z"},
        {"title": "Lab A", "hall": "Workshop Room", "starts_at": "2027-04-10T10:00:00Z", "ends_at": "2027-04-10T11:00:00Z"},
        {"title": "Lab B", "hall": "workshop room", "starts_at": "2027-04-10T11:00:00Z", "ends_at": "2027-04-10T12:00:00Z"},
        {"title": "Lunch", "starts_at": "2027-04-10T12:00:00Z", "ends_at": "2027-04-10T13:00:00Z"},
    ]

    imported = await client.post(f"{sessions_url(event_id)}/import", json={"sessions": rows}, headers=bearer(organizer))

    assert imported.status_code == 200, imported.text
    assert imported.json() == {"created": 4, "removed": 0, "halls_created": 1}
    halls = [p for p in (await client.get(venue_url(event_id), headers=bearer(organizer))).json() if p["kind"] == "hall"]
    assert [(h["name"], h["position"]) for h in halls] == [("Main Hall", 0), ("Workshop Room", 1)]
    listed = (await client.get(sessions_url(event_id), headers=bearer(organizer))).json()
    assert [(s["title"], s["hall_name"]) for s in listed] == [
        ("Keynote", "Main Hall"), ("Lab A", "Workshop Room"), ("Lab B", "Workshop Room"), ("Lunch", ""),
    ]
    assert listed[0]["hall_id"] == main["id"]
    assert listed[1]["hall_id"] == listed[2]["hall_id"] == halls[1]["id"]


async def test_import_appends_or_replaces_the_existing_program(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    other_event_id = await second_event(client, organizer, "autumn-congress-2027")
    await add_session(client, organizer, event_id)
    kept_elsewhere = await add_session(client, organizer, other_event_id)
    row = {"title": "Panel", "starts_at": "2027-04-11T09:00:00Z", "ends_at": "2027-04-11T10:00:00Z"}

    appended = await client.post(f"{sessions_url(event_id)}/import", json={"sessions": [row]}, headers=bearer(organizer))
    assert appended.json() == {"created": 1, "removed": 0, "halls_created": 0}
    replaced = await client.post(
        f"{sessions_url(event_id)}/import",
        json={"replace": True, "sessions": [{**row, "title": "Closing"}]},
        headers=bearer(organizer),
    )
    assert replaced.json() == {"created": 1, "removed": 2, "halls_created": 0}

    listed = (await client.get(sessions_url(event_id), headers=bearer(organizer))).json()
    assert [s["title"] for s in listed] == ["Closing"]
    assert (await client.get(sessions_url(other_event_id), headers=bearer(organizer))).json() == [kept_elsewhere]


async def test_an_import_with_a_bad_row_saves_nothing_and_names_the_row(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    existing = await add_session(client, organizer, event_id)
    rows = [
        {"title": "Fine", "hall": "New Hall", "starts_at": "2027-04-10T09:00:00Z", "ends_at": "2027-04-10T10:00:00Z"},
        {"title": "   ", "starts_at": "2027-04-10T09:00:00Z", "ends_at": "2027-04-10T10:00:00Z"},
        {"title": "Backwards", "starts_at": "2027-04-10T11:00:00Z", "ends_at": "2027-04-10T10:00:00Z"},
    ]

    response = await client.post(
        f"{sessions_url(event_id)}/import", json={"replace": True, "sessions": rows}, headers=bearer(organizer)
    )

    assert response.status_code == 422
    message = " ".join(error["msg"] for error in response.json()["detail"])
    assert "Row 2: title" in message
    assert "Row 3: ends_at must be after starts_at" in message
    assert "Row 1" not in message
    assert (await client.get(sessions_url(event_id), headers=bearer(organizer))).json() == [existing]
    assert (await client.get(venue_url(event_id), headers=bearer(organizer))).json() == []


async def test_another_organizer_can_neither_read_nor_change_the_program_or_venue(client: AsyncClient) -> None:
    owner = await provision_organizer(client, "Owner Co")
    intruder = await provision_organizer(client, "Intruder Co")
    event_id = await create_event(client, owner)
    hall = await add_place(client, owner, event_id, "hall", "Main Hall")
    session = await add_session(client, owner, event_id, hall_id=hall["id"])
    row = {"title": "Spam", "starts_at": "2027-04-10T09:00:00Z", "ends_at": "2027-04-10T10:00:00Z"}

    attempts = [
        await client.get(venue_url(event_id), headers=bearer(intruder)),
        await client.post(venue_url(event_id), json={"kind": "hall", "name": "X"}, headers=bearer(intruder)),
        await client.patch(f"{venue_url(event_id)}/{hall['id']}", json={"name": "X"}, headers=bearer(intruder)),
        await client.delete(f"{venue_url(event_id)}/{hall['id']}", headers=bearer(intruder)),
        await client.get(sessions_url(event_id), headers=bearer(intruder)),
        await client.post(sessions_url(event_id), json=session_body(), headers=bearer(intruder)),
        await client.post(
            f"{sessions_url(event_id)}/import", json={"replace": True, "sessions": [row]}, headers=bearer(intruder)
        ),
        await client.patch(f"{sessions_url(event_id)}/{session['id']}", json={"title": "X"}, headers=bearer(intruder)),
        await client.delete(f"{sessions_url(event_id)}/{session['id']}", headers=bearer(intruder)),
    ]

    assert [a.status_code for a in attempts] == [404] * len(attempts)
    # Ids of the owner's places and sessions are also unknown under the intruder's own event.
    own_event = await second_event(client, intruder, "intruder-congress-2027")
    assert (await client.delete(f"{venue_url(own_event)}/{hall['id']}", headers=bearer(intruder))).status_code == 404
    assert (await client.delete(f"{sessions_url(own_event)}/{session['id']}", headers=bearer(intruder))).status_code == 404
    assert (await client.get(venue_url(event_id), headers=bearer(owner))).json() == [hall]
    assert (await client.get(sessions_url(event_id), headers=bearer(owner))).json() == [session]


async def test_attendees_see_venue_and_program_live_once_the_event_is_public(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    other_event_id = await second_event(client, organizer, "autumn-congress-2027")
    hall = await add_place(client, organizer, event_id, "hall", "Main Hall", "Ground floor")
    gate = await add_place(client, organizer, event_id, "entrance", "North Gate")
    await add_place(client, organizer, other_event_id, "hall", "Elsewhere")
    await add_session(client, organizer, event_id, hall_id=hall["id"])

    assert (await client.get(PUBLIC)).status_code == 404
    await publish_page(client, organizer, event_id)
    # Saved after publishing: operational data needs no new publish.
    late = await add_session(
        client, organizer, event_id, title="Closing", starts_at="2027-04-12T17:00:00Z", ends_at="2027-04-12T18:00:00Z"
    )

    body = (await client.get(PUBLIC)).json()
    assert body["venue"] == [
        {"id": gate["id"], "kind": "entrance", "name": "North Gate", "location": ""},
        {"id": hall["id"], "kind": "hall", "name": "Main Hall", "location": "Ground floor"},
    ]
    assert [(s["title"], s["hall_name"]) for s in body["sessions"]] == [("Opening Keynote", "Main Hall"), ("Closing", "")]
    assert set(body["sessions"][1]) == {
        "id", "title", "track", "speakers", "description", "hall_id", "hall_name", "starts_at", "ends_at",
    }
    assert body["sessions"][1]["id"] == late["id"]


async def test_page_preview_includes_the_live_venue_and_program(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    hall = await add_place(client, organizer, event_id, "hall", "Main Hall")
    session = await add_session(client, organizer, event_id, hall_id=hall["id"])

    preview = await client.get(f"/api/events/{event_id}/page/preview", headers=bearer(organizer))

    assert preview.status_code == 200, preview.text
    assert [p["id"] for p in preview.json()["venue"]] == [hall["id"]]
    assert [(s["id"], s["hall_name"]) for s in preview.json()["sessions"]] == [(session["id"], "Main Hall")]
