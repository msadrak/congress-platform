"""Search and keyset pagination shared by the exhibitor lead list and the attendee network list.

Persian text is typed with different keyboards: an Arabic layout produces ي/ى and ك where a Persian one
produces ی and ک, digits come as ۱۲۳ or ١٢٣, and compound words may or may not carry a zero-width non-joiner.
Both the search term and the searched columns are folded to one form, so "کریمی" finds "كريمي". The term is
matched literally: `%`, `_` and `\\` are escaped, so they never act as LIKE wildcards.

Pages are ordered newest first by (created_at, id); the cursor is the last row's pair, opaque to clients.
"""

import base64
import binascii
import uuid
from datetime import datetime
from typing import Any

from fastapi import status
from sqlalchemy import ColumnElement, func, literal, or_, tuple_

from app.errors import ApiError

ZWNJ = "\u200c"
# translate(): each character of _FOLD_FROM becomes the one at the same position of _FOLD_TO; the trailing
# ZWNJ has no counterpart and is removed.
_FOLD_FROM = "يىك" + "۰۱۲۳۴۵۶۷۸۹" + "٠١٢٣٤٥٦٧٨٩" + ZWNJ
_FOLD_TO = "ییک" + "0123456789" + "0123456789"
_FOLD = str.maketrans(_FOLD_FROM[: len(_FOLD_TO)], _FOLD_TO, ZWNJ)

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200


def fold(text: str) -> str:
    """The search form of a term: Persian letters and ASCII digits, no ZWNJ, outer spaces trimmed."""
    return text.translate(_FOLD).strip()


def like_pattern(term: str) -> str:
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def folded(column: Any) -> ColumnElement[str]:
    folded_column: ColumnElement[str] = func.translate(column, _FOLD_FROM, _FOLD_TO)
    return folded_column


def text_matches(term: str, *columns: Any) -> ColumnElement[bool]:
    """Case-insensitive, Persian-folded, literal substring match of `term` in any of the columns."""
    pattern = like_pattern(fold(term))
    return or_(*(folded(column).ilike(pattern, escape="\\") for column in columns))


def encode_cursor(created_at: datetime, row_id: uuid.UUID) -> str:
    raw = f"{created_at.isoformat()}|{row_id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        created_at, row_id = raw.split("|")
        parsed = datetime.fromisoformat(created_at)
        if parsed.tzinfo is None:
            raise ValueError("naive cursor")
        return parsed, uuid.UUID(row_id)
    except (ValueError, UnicodeDecodeError, binascii.Error):
        raise ApiError(status.HTTP_400_BAD_REQUEST, "CURSOR_INVALID", "Invalid page cursor") from None


def before_cursor(created_at_column: Any, id_column: Any, cursor: str) -> ColumnElement[bool]:
    """Rows after the cursor in newest-first order."""
    created_at, row_id = decode_cursor(cursor)
    condition: ColumnElement[bool] = tuple_(created_at_column, id_column) < tuple_(
        literal(created_at, created_at_column.type), literal(row_id, id_column.type)
    )
    return condition
