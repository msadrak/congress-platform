"""Schedule PDFs with active content are refused even when a name is hex-escaped (`/J#61vaScript`) or the
dictionary sits inside a compressed object stream; automatic actions, web links and form submission are refused
too. A plain schedule, and one whose /OpenAction only sets the first view, are accepted."""

import zlib

import pytest
from httpx import AsyncClient

from tests.helpers import provision_organizer
from tests.test_program_files import PDF, upload
from tests.test_ticket_tiers import create_event


def with_catalog(extra: bytes) -> bytes:
    return PDF.replace(b"/Type /Catalog", b"/Type /Catalog " + extra)


def with_object_stream(content: bytes, dictionary: bytes = b"/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode") -> bytes:
    """The schedule plus object 9 inside a compressed object stream (object 8)."""
    packed = zlib.compress(b"9 0 " + content) if b"FlateDecode" in dictionary or b"Fl " in dictionary else content
    stream = b"8 0 obj << " + dictionary + b" /Length %d >>\nstream\n" % len(packed) + packed + b"\nendstream\nendobj\n"
    return PDF.replace(b"trailer", stream + b"trailer")


REFUSED = {
    "hex-escaped JavaScript action": with_catalog(b"/OpenAction << /S /J#61vaScript /J#53 (app.alert(1)) >>"),
    "hex-escaped launch action": with_catalog(b"/OpenAction << /S /L#61unch /F (calc.exe) >>"),
    "additional actions": PDF.replace(b"/Type /Page /Parent 2 0 R", b"/Type /Page /Parent 2 0 R /AA << /O 7 0 R >>", 1),
    "web link": PDF.replace(
        b"/Type /Page /Parent 2 0 R", b"/Type /Page /Parent 2 0 R /Annots [<< /A << /S /URI /URI (http://x) >> >>]", 1
    ),
    "form submission": with_catalog(b"/AcroForm << /Fields [<< /A << /S /SubmitForm /F (http://x) >> >>] >>"),
    "automatic action by reference": with_catalog(b"/OpenAction 7 0 R"),
    "automatic action dictionary": with_catalog(b"/OpenAction << /S /GoTo /D [3 0 R /Fit] >>"),
    "JavaScript inside an object stream": with_object_stream(b"<< /S /JavaScript /JS (app.alert(1)) >>"),
    "escaped object stream type": with_object_stream(
        b"<< /S /JavaScript /JS (x) >>", b"/Type /Obj#53tm /N 1 /First 4 /Filter /FlateDecode"
    ),
    "object stream that cannot be decoded": with_object_stream(
        b"<< /Type /Page >>", b"/Type /ObjStm /N 1 /First 4 /Filter /LZWDecode"
    ),
    "corrupt object stream": PDF.replace(
        b"trailer",
        b"8 0 obj << /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length 9 >>\nstream\nnot zlib!\nendstream\n"
        b"endobj\ntrailer",
    ),
}

ACCEPTED = {
    "plain schedule": PDF,
    "first view only": with_catalog(b"/OpenAction [3 0 R /Fit]"),
    "harmless object stream": with_object_stream(b"<< /Type /Page /Parent 2 0 R >>"),
    "names that only start like blocked ones": with_catalog(b"/JSON 1 /URIBase 2 /Launcher 3"),
}


@pytest.mark.parametrize("data", REFUSED.values(), ids=REFUSED.keys())
async def test_active_content_is_refused(client: AsyncClient, data: bytes) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)

    response = await upload(client, organizer, event_id, data)

    assert (response.status_code, response.json()["code"]) == (415, "PROGRAM_FILE_PDF_REJECTED"), response.text


@pytest.mark.parametrize("data", ACCEPTED.values(), ids=ACCEPTED.keys())
async def test_passive_pdfs_are_accepted(client: AsyncClient, data: bytes) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)

    response = await upload(client, organizer, event_id, data)

    assert response.status_code == 201, response.text
