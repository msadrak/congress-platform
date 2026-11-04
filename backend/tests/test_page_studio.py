"""Page Studio: draft, publication, preview and tenant isolation of the public congress page."""

import copy
from typing import Any

from httpx import AsyncClient

from tests.helpers import bearer, provision_organizer, publish_page
from tests.test_booths import BOOTH_PAYLOAD
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event, tier
from tests.test_tickets import register_user

PUBLIC = f"/api/public/events/{EVENT['slug']}"


async def page_state(client: AsyncClient, organizer: dict[str, str], event_id: str) -> dict[str, Any]:
    response = await client.get(f"/api/events/{event_id}/page", headers=bearer(organizer))
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def save_draft(
    client: AsyncClient, organizer: dict[str, str], event_id: str, revision: int, document: dict[str, Any]
) -> Any:
    return await client.put(
        f"/api/events/{event_id}/page",
        json={"revision": revision, "document": document},
        headers=bearer(organizer),
    )


def with_subtitle(document: dict[str, Any], en: str, fa: str = "") -> dict[str, Any]:
    edited = copy.deepcopy(document)
    edited["hero"]["subtitle"] = {"en": en, "fa": fa}
    return edited


async def test_a_new_event_stays_private_until_its_page_is_published(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    booth = await client.post(f"/api/events/{event_id}/booths", json=BOOTH_PAYLOAD, headers=bearer(organizer))

    state = await page_state(client, organizer, event_id)
    assert state["is_published"] is False
    assert state["has_unpublished_changes"] is True
    assert [s["type"] for s in state["draft"]["sections"]] == ["about", "highlights", "passes", "exhibitors"]
    for path in (PUBLIC, f"{PUBLIC}/booths", f"{PUBLIC}/booths/{booth.json()['id']}"):
        assert (await client.get(path)).status_code == 404, path

    published = await publish_page(client, organizer, event_id)

    assert published["is_published"] is True
    assert published["has_unpublished_changes"] is False
    assert (await client.get(PUBLIC)).status_code == 200
    assert (await client.get(f"{PUBLIC}/booths")).json()[0]["id"] == booth.json()["id"]


async def test_draft_edits_reach_visitors_only_when_published(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    state = await page_state(client, organizer, event_id)

    saved = await save_draft(client, organizer, event_id, state["draft_revision"], with_subtitle(state["draft"], "First words"))
    assert saved.status_code == 200, saved.text
    assert saved.json()["draft_revision"] == state["draft_revision"] + 1
    assert (await client.get(PUBLIC)).status_code == 404

    await publish_page(client, organizer, event_id)
    assert (await client.get(PUBLIC)).json()["page"]["document"]["hero"]["subtitle"]["en"] == "First words"

    current = await page_state(client, organizer, event_id)
    edited = await save_draft(client, organizer, event_id, current["draft_revision"], with_subtitle(current["draft"], "Second thoughts"))
    assert edited.json()["has_unpublished_changes"] is True
    assert (await client.get(PUBLIC)).json()["page"]["document"]["hero"]["subtitle"]["en"] == "First words"

    await publish_page(client, organizer, event_id)
    assert (await client.get(PUBLIC)).json()["page"]["document"]["hero"]["subtitle"]["en"] == "Second thoughts"


async def test_section_order_visibility_and_custom_blocks_are_published_as_saved(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    state = await page_state(client, organizer, event_id)
    document = copy.deepcopy(state["draft"])
    about, highlights, passes, exhibitors = document["sections"]
    highlights["visible"] = False
    custom = {
        "type": "rich_text", "id": "s-venue", "visible": True, "layout": "centered",
        "title": {"en": "Getting there", "fa": "مسیر دسترسی"},
        "body": {"en": "Take **line 3** to the tower.", "fa": ""},
    }
    document["sections"] = [passes, custom, about, highlights, exhibitors]

    saved = await save_draft(client, organizer, event_id, state["draft_revision"], document)
    assert saved.status_code == 200, saved.text
    await publish_page(client, organizer, event_id)

    sections = (await client.get(PUBLIC)).json()["page"]["document"]["sections"]
    assert [s["id"] for s in sections] == ["passes", "s-venue", "about", "highlights", "exhibitors"]
    assert [s["visible"] for s in sections] == [True, True, True, False, True]
    assert sections[1]["body"]["en"] == "Take **line 3** to the tower."


async def test_a_stale_revision_never_overwrites_newer_work(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    state = await page_state(client, organizer, event_id)
    base = state["draft_revision"]

    first = await save_draft(client, organizer, event_id, base, with_subtitle(state["draft"], "Editor one"))
    second = await save_draft(client, organizer, event_id, base, with_subtitle(state["draft"], "Editor two"))
    stale_publish = await client.post(
        f"/api/events/{event_id}/page/publish", json={"revision": base}, headers=bearer(organizer)
    )

    assert first.status_code == 200
    assert second.status_code == 409
    assert second.json()["code"] == "PAGE_DRAFT_STALE"
    assert stale_publish.status_code == 409
    assert stale_publish.json()["code"] == "PAGE_DRAFT_STALE"
    latest = await page_state(client, organizer, event_id)
    assert latest["draft"]["hero"]["subtitle"]["en"] == "Editor one"
    assert latest["is_published"] is False


async def test_invalid_documents_are_rejected(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    state = await page_state(client, organizer, event_id)
    revision, draft = state["draft_revision"], state["draft"]

    without_passes = copy.deepcopy(draft)
    without_passes["sections"] = [s for s in draft["sections"] if s["type"] != "passes"]
    duplicate_ids = copy.deepcopy(draft)
    duplicate_ids["sections"][1]["id"] = "about"
    unknown_type = copy.deepcopy(draft)
    unknown_type["sections"].append({"type": "html", "id": "raw", "html": "<script>alert(1)</script>"})
    extra_field = copy.deepcopy(draft)
    extra_field["hero"]["custom_css"] = "body{display:none}"
    bad_accent = copy.deepcopy(draft)
    bad_accent["branding"]["accent"] = "#ff0000"

    for document in (without_passes, duplicate_ids, unknown_type, extra_field, bad_accent):
        response = await save_draft(client, organizer, event_id, revision, document)
        assert response.status_code == 422, response.text
    assert (await page_state(client, organizer, event_id))["draft_revision"] == revision


async def test_hero_layout_and_focal_point_are_published_as_saved(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    state = await page_state(client, organizer, event_id)
    # A document saved before the banner layout and the focal point existed carries none of the new fields.
    legacy = copy.deepcopy(state["draft"])
    for key in ("focal_x", "focal_y", "mobile_cover_asset_id"):
        legacy["hero"].pop(key)
    saved = await save_draft(client, organizer, event_id, state["draft_revision"], legacy)
    assert saved.status_code == 200, saved.text
    hero = (await page_state(client, organizer, event_id))["draft"]["hero"]
    assert {k: hero[k] for k in ("layout", "focal_x", "focal_y", "mobile_cover_asset_id")} == {
        "layout": "signature", "focal_x": 50, "focal_y": 50, "mobile_cover_asset_id": None,
    }

    for layout, focal in (("banner", (50, 50)), ("cover", (0, 100)), ("split", (25, 70))):
        current = await page_state(client, organizer, event_id)
        document = copy.deepcopy(current["draft"])
        document["hero"].update(layout=layout, focal_x=focal[0], focal_y=focal[1])
        saved = await save_draft(client, organizer, event_id, current["draft_revision"], document)
        assert saved.status_code == 200, saved.text
        await publish_page(client, organizer, event_id)
        hero = (await client.get(PUBLIC)).json()["page"]["document"]["hero"]
        assert (hero["layout"], hero["focal_x"], hero["focal_y"]) == (layout, *focal)


async def test_invalid_hero_presentation_is_rejected(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    state = await page_state(client, organizer, event_id)
    revision = state["draft_revision"]

    for patch in (
        {"layout": "fullscreen"},
        {"focal_x": 101},
        {"focal_y": -1},
        {"focal_x": "left"},
        {"focal_y": 33.5},
        {"mobile_cover_asset_id": "not-a-uuid"},
    ):
        document = copy.deepcopy(state["draft"])
        document["hero"].update(patch)
        response = await save_draft(client, organizer, event_id, revision, document)
        assert response.status_code == 422, (patch, response.text)
    assert (await page_state(client, organizer, event_id))["draft_revision"] == revision


async def test_page_text_is_stored_as_plain_text_without_control_characters(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    state = await page_state(client, organizer, event_id)

    saved = await save_draft(
        client, organizer, event_id, state["draft_revision"],
        with_subtitle(state["draft"], "  <b>Bold</b>\x00 claim\r\nnext  ", "همایش\x07"),
    )

    subtitle = saved.json()["draft"]["hero"]["subtitle"]
    assert subtitle == {"en": "<b>Bold</b> claim\nnext", "fa": "همایش"}


async def test_another_organizer_can_neither_read_nor_change_the_page(client: AsyncClient) -> None:
    owner = await provision_organizer(client, "Owner Co")
    intruder = await provision_organizer(client, "Intruder Co")
    event_id = await create_event(client, owner)
    state = await page_state(client, owner, event_id)
    secret_draft = with_subtitle(state["draft"], "Unannounced keynote")
    await save_draft(client, owner, event_id, state["draft_revision"], secret_draft)
    revision = state["draft_revision"] + 1

    attempts = [
        await client.get(f"/api/events/{event_id}/page", headers=bearer(intruder)),
        await client.get(f"/api/events/{event_id}/page/preview", headers=bearer(intruder)),
        await save_draft(client, intruder, event_id, revision, state["draft"]),
        await client.post(f"/api/events/{event_id}/page/publish", json={"revision": revision}, headers=bearer(intruder)),
        await client.post(f"/api/events/{event_id}/page/unpublish", headers=bearer(intruder)),
        await client.post(f"/api/events/{event_id}/page/discard", json={"revision": revision}, headers=bearer(intruder)),
    ]

    assert [r.status_code for r in attempts] == [404] * len(attempts)
    assert all("Unannounced keynote" not in r.text for r in attempts)
    after = await page_state(client, owner, event_id)
    assert after["draft_revision"] == revision
    assert after["is_published"] is False


async def test_preview_renders_the_draft_for_the_owner_only(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    await client.post(f"/api/events/{event_id}/ticket-tiers", json=tier(), headers=bearer(organizer))
    await client.post(f"/api/events/{event_id}/booths", json=BOOTH_PAYLOAD, headers=bearer(organizer))
    await publish_page(client, organizer, event_id)
    state = await page_state(client, organizer, event_id)
    await save_draft(client, organizer, event_id, state["draft_revision"], with_subtitle(state["draft"], "Coming soon"))

    preview = await client.get(f"/api/events/{event_id}/page/preview", headers=bearer(organizer))
    anonymous = await client.get(f"/api/events/{event_id}/page/preview")

    assert preview.status_code == 200
    body = preview.json()
    assert body["page"]["document"]["hero"]["subtitle"]["en"] == "Coming soon"
    assert [t["name"] for t in body["ticket_tiers"]] == ["General Admission"]
    assert [b["name"] for b in body["booths"]] == [BOOTH_PAYLOAD["name"]]
    assert anonymous.status_code == 401
    public = (await client.get(PUBLIC)).json()
    assert public["page"]["document"]["hero"]["subtitle"]["en"] == ""
    assert set(public["page"]) == {"document", "assets"}
    assert "Coming soon" not in str(public)


async def test_unpublish_hides_the_page_and_new_reservations_but_keeps_tickets(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    tier_id = (
        await client.post(f"/api/events/{event_id}/ticket-tiers", json=tier(), headers=bearer(organizer))
    ).json()["id"]
    await publish_page(client, organizer, event_id)
    _, holder = await register_user(client, "09121000056")
    kept = await client.post(
        f"/api/events/{event_id}/tickets/reserve",
        json={"ticket_tier_id": tier_id},
        headers={"Authorization": f"Bearer {holder}"},
    )
    assert kept.status_code == 201, kept.text

    unpublished = await client.post(f"/api/events/{event_id}/page/unpublish", headers=bearer(organizer))
    _, token = await register_user(client, "09121000057")
    reserved = await client.post(
        f"/api/events/{event_id}/tickets/reserve",
        json={"ticket_tier_id": tier_id},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert unpublished.json()["is_published"] is False
    assert (await client.get(PUBLIC)).status_code == 404
    # Reservations need a published page; tickets already issued stay valid.
    assert reserved.status_code == 404, reserved.text
    mine = await client.get("/api/attendees/me/tickets", headers={"Authorization": f"Bearer {holder}"})
    assert [t["id"] for t in mine.json()] == [kept.json()["id"]]
    assert (await page_state(client, organizer, event_id))["draft"]["sections"]


async def test_discard_returns_the_draft_to_the_published_page(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    never = await page_state(client, organizer, event_id)
    nothing_to_discard = await client.post(
        f"/api/events/{event_id}/page/discard", json={"revision": never["draft_revision"]}, headers=bearer(organizer)
    )
    published = await publish_page(client, organizer, event_id)
    await save_draft(client, organizer, event_id, published["draft_revision"], with_subtitle(published["draft"], "Oops"))
    revision = published["draft_revision"] + 1

    discarded = await client.post(
        f"/api/events/{event_id}/page/discard", json={"revision": revision}, headers=bearer(organizer)
    )

    assert nothing_to_discard.status_code == 409
    assert discarded.status_code == 200
    assert discarded.json()["draft"]["hero"]["subtitle"]["en"] == ""
    assert discarded.json()["has_unpublished_changes"] is False
