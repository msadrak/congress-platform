"""Iranian mobile numbers: the platform's only personal identifier and contact channel.

Every number is stored and compared in one canonical form, `09xxxxxxxxx` (11 ASCII digits). Input may use
Persian or Arabic-Indic digits, spaces, dashes and the `+98` / `0098` / `98` prefixes, because that is how
people type and paste their own number. The canonical form never starts with `+`, so it survives
`sanitize_csv_cell` unchanged.
"""

import re
import unicodedata
from typing import Annotated

from pydantic import AfterValidator, BeforeValidator, StringConstraints

# Separators people type or paste: spaces, dashes, dots, parentheses and bidi/ZWNJ marks from RTL keyboards.
_SEPARATORS = re.compile(r"[\s\-().‌‎‏‪-‮]")

INVALID_MOBILE = "Enter a valid Iranian mobile number, e.g. 09121234567."


def ascii_digits(value: str) -> str:
    """Replace every Unicode decimal digit (Persian ۰-۹, Arabic-Indic ٠-٩, …) with its ASCII digit."""
    return "".join(str(unicodedata.decimal(ch)) if ch.isdecimal() else ch for ch in value)


def normalize_ir_mobile(raw: str) -> str:
    """Return the canonical `09xxxxxxxxx` form or raise ValueError."""
    compact = ascii_digits(_SEPARATORS.sub("", raw or ""))
    if compact.startswith("+"):
        compact = compact[1:]
    if not compact.isdigit():
        raise ValueError(INVALID_MOBILE)
    if compact.startswith("0098"):
        compact = compact[4:]
    elif compact.startswith("98") and len(compact) == 12:
        compact = compact[2:]
    elif compact.startswith("0"):
        compact = compact[1:]
    if len(compact) != 10 or not compact.startswith("9"):
        raise ValueError(INVALID_MOBILE)
    return "0" + compact


def search_digits(term: str) -> str | None:
    """Digits worth matching against stored numbers, or None when the search term is not number-like.

    Partial numbers are allowed ("4567", "0912 345"); an international prefix is folded into the national form.
    """
    compact = ascii_digits(_SEPARATORS.sub("", term)).lstrip("+")
    if len(compact) < 4 or not compact.isdigit():
        return None
    if compact.startswith("0098"):
        return "0" + compact[4:]
    if compact.startswith("98") and len(compact) >= 12:
        return "0" + compact[2:]
    return compact


def mask_mobile(mobile: str) -> str:
    """`0912***4567`: enough to recognise in logs and support tickets, not enough to contact."""
    return f"{mobile[:4]}***{mobile[-4:]}" if len(mobile) >= 8 else "***"


def to_e164(mobile: str) -> str:
    """`+98912…` for vCards, which phones expect in international form."""
    return "+98" + mobile[1:]


def _empty_to_none(value: object) -> object:
    return None if isinstance(value, str) and not value.strip() else value


IranMobile = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=32), AfterValidator(normalize_ir_mobile)
]
# Optional number from a form field: an empty string means "not given".
OptionalIranMobile = Annotated[IranMobile | None, BeforeValidator(_empty_to_none)]
