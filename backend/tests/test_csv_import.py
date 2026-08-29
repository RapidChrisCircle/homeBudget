import io
import json
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


# --- pending card authorisations (AUTHORISATION ONLY - ...) ----------------
#
# Columns, per HEADER above: bsb,account,date,narration,cheque,debit,credit,
# balance,type.

def test_import_skips_a_pending_authorisation_row(client):

    csv_content = HEADER + (
        ',1111,24/07/2026,"AUTHORISATION ONLY - WOOLWORTHS 1234",,"45.00",,"100.00",WDL\n'
        ',1111,25/07/2026,"Coles",,"12.00",,"88.00",WDL\n'
    )

    response = upload(client, csv_content)

    assert response.status_code == 201
    body = response.json()
    assert body["imported_count"] == 1
    assert body["skipped_authorisation_count"] == 1
    assert body["batch"]["skipped_authorisation_count"] == 1

    narrations = [t["narration"] for t in client.get("/api/transactions", params={"page_size": 10}).json()["items"]]
    assert narrations == ["Coles"]


def test_import_keeps_an_authorisation_only_row_with_no_debit(client):
    """The prefix alone isn't enough - a bank can label a settled REFUND
    the same way, and that one carries real money that must not vanish.
    """

    csv_content = HEADER + (
        ',1111,24/07/2026,"AUTHORISATION ONLY - REFUND",,,"20.00","120.00",DEP\n'
    )

    response = upload(client, csv_content)

    assert response.status_code == 201
    body = response.json()
    assert body["imported_count"] == 1
    assert body["skipped_authorisation_count"] == 0


def test_import_matches_the_prefix_case_insensitively(client):

    csv_content = HEADER + (
        ',1111,24/07/2026,"authorisation only - shop",,"5.00",,"95.00",WDL\n'
        ',1111,25/07/2026,"Coles",,"12.00",,"83.00",WDL\n'
    )

    response = upload(client, csv_content)

    assert response.status_code == 201
    assert response.json()["skipped_authorisation_count"] == 1


def test_a_pending_authorisation_row_is_skipped_before_its_own_fields_are_validated(client):
    """A pending hold is a placeholder, not a real transaction - its other
    fields (here, a blank Balance that would otherwise reject the whole
    file) are never even looked at once the narration+Debit match.
    """

    csv_content = HEADER + (
        ',1111,24/07/2026,"AUTHORISATION ONLY - CAFE",,"12.50",,,WDL\n'
        ',1111,25/07/2026,"Coles",,"12.00",,"88.00",WDL\n'
    )

    response = upload(client, csv_content)

    assert response.status_code == 201
    body = response.json()
    assert body["imported_count"] == 1
    assert body["skipped_authorisation_count"] == 1


def test_a_row_matching_the_prefix_with_a_non_numeric_debit_is_not_skipped(client):
    """"Contains a numeric value in the Debit column" is the second half of
    the rule - a non-numeric Debit cell means this isn't recognizably a
    pending hold, so it is treated as an ordinary (here, malformed) row
    instead of silently disappearing.
    """

    csv_content = HEADER + (
        ',1111,24/07/2026,"AUTHORISATION ONLY - CAFE",,"not-a-number",,"100.00",WDL\n'
    )

    response = upload(client, csv_content)

    assert response.status_code == 422
    errors = response.json()["detail"]["errors"]
    assert any("not-a-number" in e["message"] for e in errors)


def test_a_file_of_only_pending_authorisations_is_rejected_as_having_no_data_rows(client):

    csv_content = HEADER + (
        ',1111,24/07/2026,"AUTHORISATION ONLY - WOOLWORTHS",,"45.00",,"100.00",WDL\n'
    )

    response = upload(client, csv_content)

    assert response.status_code == 422
    assert "no data rows" in response.json()["detail"]["errors"][0]["message"]


def _built_in_mapping(**overrides):
    """Mirrors the built-in HEADER's own column order, for the preview
    endpoint - which (unlike /transactions/import) always needs an
    explicit mapping rather than auto-detecting one.
    """

    payload = {
        "name": "Built-in",
        "institution": "Built-in",
        "date_format": "%d/%m/%Y",
        "amount_mode": "debit_credit",
        "bsb_index": 0,
        "account_number_index": 1,
        "transaction_date_index": 2,
        "narration_index": 3,
        "cheque_number_index": 4,
        "debit_index": 5,
        "credit_index": 6,
        "balance_index": 7,
        "transaction_type_index": 8,
    }
    payload.update(overrides)
    return payload


def preview(client, content: str, mapping: dict):

    return client.post(
        "/api/transactions/import/preview",
        files={"file": ("transactions.csv", io.BytesIO(content.encode("utf-8")), "text/csv")},
        data={"mapping_json": json.dumps(mapping)},
    )


def test_preview_reports_skipped_authorisation_count(client):

    csv_content = HEADER + (
        ',1111,24/07/2026,"AUTHORISATION ONLY - WOOLWORTHS 1234",,"45.00",,"100.00",WDL\n'
        ',1111,25/07/2026,"Coles",,"12.00",,"88.00",WDL\n'
    )

    preview_response = preview(client, csv_content, _built_in_mapping())
    assert preview_response.status_code == 200
    assert preview_response.json()["skipped_authorisation_count"] == 1
    # Nothing is written by preview - the point of the endpoint.
    assert len(preview_response.json()["rows"]) == 1

    import_response = upload(client, csv_content)
    assert import_response.json()["skipped_authorisation_count"] == 1
