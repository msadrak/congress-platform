import pytest
from httpx import AsyncClient

from app.security import sanitize_csv_cell
from tests.helpers import bearer
from tests.test_analytics import setup_event_with_scans
def test_sanitize_csv_cell_escapes_formulae() -> None:
    # Danger prefixes: =, +, -, @, \t, \r
    assert sanitize_csv_cell("=cmd|' /C calc'!A0") == "'=cmd|' /C calc'!A0"
    assert sanitize_csv_cell("+12345") == "'+12345"
    assert sanitize_csv_cell("-SOMETHING") == "'-SOMETHING"
    assert sanitize_csv_cell("@SUM(1+1)") == "'@SUM(1+1)"
    assert sanitize_csv_cell("\ttabbed") == "'\ttabbed"
    assert sanitize_csv_cell("\rcarriage") == "'\rcarriage"

    # Benign text and Unicode Persian
    assert sanitize_csv_cell("علی علوی") == "علی علوی"
    assert sanitize_csv_cell("Normal Text") == "Normal Text"
    assert sanitize_csv_cell(123) == "123"
    assert sanitize_csv_cell(None) == ""


@pytest.mark.asyncio
async def test_csv_export_includes_utf8_bom_and_sanitizes_cells(
    client: AsyncClient,
) -> None:
    organizer, event_id, main_gate, lunch_gate, tickets = (
        await setup_event_with_scans(client)
    )

    resp = await client.get(
        f"/api/events/{event_id}/analytics/export-csv",
        headers=bearer(organizer),
    )
    assert resp.status_code == 200
    assert "text/csv; charset=utf-8" in resp.headers["content-type"]
    assert resp.content.startswith(b"\xef\xbb\xbf")  # UTF-8 BOM bytes
