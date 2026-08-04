import io
from decimal import Decimal

import pytest

from app.services.csv_import import _clean_amount, _parse_decimal

TOLERANT_FORMATS = [
    "-AUD 3,742.37",
    "AUD -3,742.37",
    "-$3,742.37",
    "(3,742.37)",
    "3,742.37",
]


@pytest.mark.parametrize("raw", TOLERANT_FORMATS)
def test_clean_amount_normalizes_to_same_magnitude(raw):

    cleaned = _clean_amount(raw)
    expected_sign = -1 if raw.startswith("-") or "-AUD" in raw or "AUD -" in raw or raw.startswith("(") else 1

    assert Decimal(cleaned) == Decimal("3742.37") * expected_sign


def test_clean_amount_bare_decimal_is_untouched():

    assert _clean_amount("3742.37") == "3742.37"


def test_clean_amount_negative_currency_code_before_number():

    assert Decimal(_clean_amount("-AUD 3,742.37")) == Decimal("-3742.37")


def test_clean_amount_currency_code_before_negative_number():

    assert Decimal(_clean_amount("AUD -3,742.37")) == Decimal("-3742.37")


def test_clean_amount_dollar_symbol():

    assert Decimal(_clean_amount("-$3,742.37")) == Decimal("-3742.37")


def test_clean_amount_accounting_parentheses():

    assert Decimal(_clean_amount("(3,742.37)")) == Decimal("-3742.37")


def test_parse_decimal_accepts_tolerant_formats():

    for raw in TOLERANT_FORMATS:
        errors = []
        result = _parse_decimal(raw, "Amount", 2, errors)
        assert errors == []
        assert result is not None


def test_parse_decimal_rejects_malformed_value_and_quotes_original_cell():

    errors = []
    result = _parse_decimal("not-a-number", "Amount", 2, errors)

    assert result is None
    assert errors == [(2, "invalid Amount amount 'not-a-number'")]


def test_clean_amount_does_not_truncate_letters_glued_to_digits():
    """A currency code is only stripped as its own token - letters fused
    directly onto digits (a typo, not a currency code) must still fail
    Decimal() rather than being silently truncated into a valid number.
    """

    with pytest.raises(Exception):
        Decimal(_clean_amount("abc123"))


HEADER = "BSB Number,Account Number,Transaction Date,Narration,Cheque Number,Debit,Credit,Balance,Transaction Type\n"


def upload(client, content: str):

    return client.post(
        "/api/transactions/import",
        files={"file": ("transactions.csv", io.BytesIO(content.encode("utf-8")), "text/csv")},
    )


def test_import_accepts_currency_coded_amounts_end_to_end(client):

    csv_content = HEADER + (
        ',1111,24/07/2026,"CCTrueUp",,,"AUD 3,742.37","-AUD 1,576.67",DEP\n'
    )

    response = upload(client, csv_content)

    assert response.status_code == 201
    assert response.json()["imported_count"] == 1

    transaction = client.get("/api/transactions", params={"page_size": 10}).json()["items"][0]
    assert transaction["credit"] == "3742.37"
    assert transaction["balance"] == "-1576.67"


def test_import_still_rejects_genuinely_malformed_amount(client):

    csv_content = HEADER + (
        ',1111,24/07/2026,"Bad row",,,"not-a-number",100.00,DEP\n'
    )

    response = upload(client, csv_content)

    assert response.status_code == 422
    errors = response.json()["detail"]["errors"]
    assert any("not-a-number" in e["message"] for e in errors)
