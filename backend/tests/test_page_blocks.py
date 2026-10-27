"""Page Studio layout and media blocks: columns, video, gallery, links, section style, link buttons and a
custom accent. Everything goes through the save endpoint, so a rejected document never reaches the draft."""

import copy
from typing import Any

import pytest
from httpx import AsyncClient

from tests.helpers import bearer, provision_organizer, publish_page
from tests.test_events import EVENT
from tests.test_page_media import image_bytes, upload
from tests.test_page_studio import page_state, save_draft
from tests.test_ticket_tiers import create_event

PUBLIC = f"/api/public/events/{EVENT['slug']}"


def with_sections(document: dict[str, Any], *sections: dict[str, Any]) -> dict[str, Any]:
    edited = copy.deepcopy(document)
    edited["sections"].extend(sections)
    return edited


async def setup(client: AsyncClient) -> tuple[dict[str, str], str, dict[str, Any]]:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    return organizer, event_id, await page_state(client, organizer, event_id)


async def test_new_blocks_round_trip_and_publish_their_images(client: AsyncClient) -> None:
    organizer, event_id, state = await setup(client)
    photo = (await upload(client, organizer, event_id, image_bytes())).json()["id"]
    logo = (await upload(client, organizer, event_id, image_bytes(size=(80, 40)))).json()["id"]
    poster = (await upload(client, organizer, event_id, image_bytes(size=(160, 90)))).json()["id"]
    sections = [
        {
            "type": "columns",
            "id": "columns-1",
            "layout": "wide_start",
            "surface": "cards",
            "style": {"background": "ink", "width": "narrow", "align": "center", "text_size": "lg", "direction": "rtl"},
            "items": [
                {"icon": "calendar", "title": {"fa": "روز اول", "en": "Day one"}, "body": {"en": "## Morning\n1. Opening"}},
                {"image_asset_id": photo, "button_label": {"en": "Submit"}, "button_url": "https://forms.example.org/a"},
            ],
        },
        {
            "type": "video",
            "id": "video-1",
            "provider": "youtube",
            "video_id": "dQw4w9WgXcQ",
            "poster_asset_id": poster,
            "layout": "video_end",
            "caption": {"en": "Last year"},
        },
        {"type": "video", "id": "video-2", "provider": "aparat", "video_id": "Xy12z"},
        {
            "type": "gallery",
            "id": "gallery-1",
            "layout": "logos",
            "columns": 4,
            "items": [{"image_asset_id": logo, "alt": {"en": "Sponsor"}, "url": "https://sponsor.example.org"}],
        },
        {
            "type": "links",
            "id": "links-1",
            "items": [
                {"kind": "telegram", "url": "https://t.me/congress"},
                {"kind": "email", "url": "mailto:info@example.org"},
                {"kind": "phone", "url": "tel:+98 21 1234 5678"},
            ],
        },
        {"type": "cta", "id": "cta-1", "target": "url", "url": "https://forms.example.org/abstracts"},
        {"type": "rich_text", "id": "text-1", "layout": "columns", "body": {"en": "> quote\n\n---\n\n*italic* ==mark=="}},
    ]
    saved = await save_draft(client, organizer, event_id, state["draft_revision"], with_sections(state["draft"], *sections))
    assert saved.status_code == 200, saved.text
    stored = {s["id"]: s for s in saved.json()["draft"]["sections"]}
    assert stored["columns-1"]["style"]["background"] == "ink"
    assert stored["video-1"]["video_id"] == "dQw4w9WgXcQ"
    assert stored["links-1"]["items"][2]["url"] == "tel:+98 21 1234 5678"
    # Sections saved before the style existed read back with the default style.
    assert stored["about"]["style"] == {"background": "none", "width": "normal", "align": "start", "text_size": "md", "direction": "auto"}

    await publish_page(client, organizer, event_id)
    public = (await client.get(PUBLIC)).json()["page"]
    assert {a["id"] for a in public["assets"]} == {photo, logo, poster}
    for asset in (photo, logo, poster):
        assert (await client.get(f"/api/public/media/{asset}")).status_code == 200

    # An image used only by a published block cannot be deleted from the library.
    deleted = await client.delete(f"/api/events/{event_id}/media/{logo}", headers=bearer(organizer))
    assert deleted.status_code == 409, deleted.text


@pytest.mark.parametrize(
    "section",
    [
        {"type": "video", "id": "v", "provider": "youtube", "video_id": "short"},
        {"type": "video", "id": "v", "provider": "youtube", "video_id": "https://youtu.be/dQw4w9WgXcQ"},
        {"type": "video", "id": "v", "provider": "aparat", "video_id": "abc/../x"},
        {"type": "video", "id": "v", "provider": "vimeo", "video_id": "123456"},
        {"type": "links", "id": "l", "items": [{"kind": "website", "url": "javascript:alert(1)"}]},
        {"type": "links", "id": "l", "items": [{"kind": "website", "url": "https://"}]},
        {"type": "links", "id": "l", "items": [{"kind": "website", "url": "https://a.example/ b"}]},
        {"type": "links", "id": "l", "items": [{"kind": "email", "url": "mailto:not-an-address"}]},
        {"type": "links", "id": "l", "items": [{"kind": "phone", "url": "tel:call-me"}]},
        {"type": "links", "id": "l", "items": [{"kind": "website", "url": "data:text/html,hi"}]},
        {"type": "links", "id": "l", "items": [{"kind": "fax", "url": "https://a.example"}]},
        {"type": "gallery", "id": "g", "items": [{"url": "ftp://files.example.org"}]},
        {"type": "columns", "id": "c", "items": [{"button_url": "//evil.example"}]},
        {"type": "columns", "id": "c", "items": [{}, {}, {}, {}, {}]},
        {"type": "rich_text", "id": "t", "style": {"background": "#ff0000"}},
        {"type": "rich_text", "id": "t", "style": {"font": "Comic Sans"}},
    ],
)
async def test_unsafe_or_malformed_blocks_are_refused(client: AsyncClient, section: dict[str, Any]) -> None:
    organizer, event_id, state = await setup(client)
    saved = await save_draft(client, organizer, event_id, state["draft_revision"], with_sections(state["draft"], section))
    assert saved.status_code == 422, saved.text
    assert (await page_state(client, organizer, event_id))["draft_revision"] == state["draft_revision"]


@pytest.mark.parametrize(
    ("branding", "status"),
    [
        ({"accent": "custom", "accent_color": "#0B6E4F"}, 200),
        ({"accent": "custom", "accent_color": "#ffd400"}, 422),  # yellow on white is illegible
        ({"accent": "custom"}, 422),
        ({"accent": "custom", "accent_color": "red"}, 422),
        ({"accent": "indigo", "accent_color": "#ffd400"}, 200),  # kept for later, unused while not custom
    ],
)
async def test_a_custom_accent_must_be_legible_on_white(client: AsyncClient, branding: dict[str, Any], status: int) -> None:
    organizer, event_id, state = await setup(client)
    document = copy.deepcopy(state["draft"])
    document["branding"] = {**document["branding"], **branding}
    saved = await save_draft(client, organizer, event_id, state["draft_revision"], document)
    assert saved.status_code == status, saved.text
