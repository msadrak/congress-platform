"""Iranian mobile numbers: one canonical form whatever people type or paste."""

import pytest
from pydantic import BaseModel, ValidationError

from app.security import sanitize_csv_cell
from app.sms.phone import (
    IranMobile,
    OptionalIranMobile,
    mask_mobile,
    normalize_ir_mobile,
    search_digits,
    to_e164,
)


@pytest.mark.parametrize(
    "raw",
    [
        "09121234567",
        "9121234567",
        "+989121234567",
        "989121234567",
        "00989121234567",
        "0912 123 4567",
        "0912-123-4567",
        "(0912) 123.4567",
        "۰۹۱۲۱۲۳۴۵۶۷",  # Persian digits
        "٠٩١٢١٢٣٤٥٦٧",  # Arabic-Indic digits
        "+۹۸ ۹۱۲ ۱۲۳ ۴۵۶۷",
        "‎0912‌1234567",  # LRM and ZWNJ pasted from an RTL text field
    ],
)
def test_every_common_spelling_normalizes_to_the_canonical_form(raw: str) -> None:
    assert normalize_ir_mobile(raw) == "09121234567"


@pytest.mark.parametrize(
    "raw",
    ["", "0912123456", "091212345678", "02112345678", "8121234567", "+19121234567", "0912abc4567", "phone", "+"],
)
def test_landlines_short_long_and_foreign_numbers_are_refused(raw: str) -> None:
    with pytest.raises(ValueError):
        normalize_ir_mobile(raw)


def test_pydantic_types_normalize_and_treat_blank_optional_as_absent() -> None:
    class Form(BaseModel):
        mobile: IranMobile
        backup: OptionalIranMobile = None

    form = Form(mobile=" ۰۹۱۲۱۲۳۴۵۶۷ ", backup="  ")
    assert form.mobile == "09121234567"
    assert form.backup is None
    assert Form(mobile="09121234567", backup="+98 935 000 1111").backup == "09350001111"
    with pytest.raises(ValidationError) as exc:
        Form(mobile="12345")
    assert "valid Iranian mobile number" in str(exc.value)


def test_search_digits_accept_partial_numbers_only() -> None:
    assert search_digits("4567") == "4567"
    assert search_digits("۰۹۱۲ ۱۲۳") == "0912123"
    assert search_digits("+989121234567") == "09121234567"
    assert search_digits("123") is None
    assert search_digits("Dr. Ali") is None


def test_display_helpers() -> None:
    assert mask_mobile("09121234567") == "0912***4567"
    assert to_e164("09121234567") == "+989121234567"
    # The canonical form is not mistaken for a spreadsheet formula.
    assert sanitize_csv_cell("09121234567") == "09121234567"
