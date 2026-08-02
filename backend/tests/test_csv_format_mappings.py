import io

from app.models import Account, CsvFormatMapping, Transaction


def debit_credit_mapping(**overrides):
    payload = {
        "name": "Other Bank",
        "institution": "Other Bank",
        "date_format": "%Y-%m-%d",
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


OTHER_BANK_HEADER = [
    "BSB", "Account", "Value Date", "Description", "Cheque No",
    "Debit Amount", "Credit Amount", "Running Balance", "Type",
]


def other_bank_csv(row="304-559,9999,2026-07-24,Coffee,,5.00,,100.00,WDL"):
    header_line = ",".join(OTHER_BANK_HEADER)
    return f"{header_line}\n{row}\n"


def upload_csv(client, content, filename="other_bank.csv"):
    return client.post(
        "/api/transactions/import",
        files={"file": (filename, io.BytesIO(content.encode("utf-8")), "text/csv")},
    )


def preview_csv(client, content, mapping, filename="other_bank.csv"):
    import json
    return client.post(
        "/api/transactions/import/preview",
        files={"file": (filename, io.BytesIO(content.encode("utf-8")), "text/csv")},
        data={"mapping_json": json.dumps(mapping)},
    )


def test_saving_a_mapping_lets_a_reordered_layout_import(client, db_session):

    # Unrecognized before any mapping is saved.
    response = upload_csv(client, other_bank_csv())
    assert response.status_code == 422
    assert response.json()["detail"]["needs_mapping"] is True

    save_response = client.post(
        "/api/csv-formats",
        json={"mapping": debit_credit_mapping(), "header": OTHER_BANK_HEADER},
    )
    assert save_response.status_code == 201

    import_response = upload_csv(client, other_bank_csv())
    assert import_response.status_code == 201
    assert import_response.json()["imported_count"] == 1

    account = db_session.query(Account).filter_by(account_number="9999").one()
    assert account.institution == "Other Bank"

    transaction = db_session.query(Transaction).filter_by(account_number="9999").one()
    assert transaction.debit == 5.00


def test_single_amount_mode_splits_by_sign(client):

    header = ["Date", "Account", "Description", "Amount", "Balance"]
    mapping = {
        "name": "Signed Amount Bank",
        "institution": "Signed Amount Bank",
        "date_format": "%Y-%m-%d",
        "amount_mode": "single_amount",
        "account_number_index": 1,
        "transaction_date_index": 0,
        "narration_index": 2,
        "amount_index": 3,
        "balance_index": 4,
    }
    client.post("/api/csv-formats", json={"mapping": mapping, "header": header})

    header_line = ",".join(header)
    csv_content = (
        f"{header_line}\n"
        "2026-07-24,9999,Coffee,-5.00,95.00\n"
        "2026-07-25,9999,Salary,3000.00,3095.00\n"
    )

    response = upload_csv(client, csv_content, filename="signed.csv")
    assert response.status_code == 201
    assert response.json()["imported_count"] == 2

    items = client.get("/api/transactions?page_size=10").json()["items"]
    debit_row = next(t for t in items if t["narration"] == "Coffee")
    credit_row = next(t for t in items if t["narration"] == "Salary")

    assert debit_row["debit"] == "-5.00"
    assert debit_row["credit"] is None
    assert credit_row["credit"] == "3000.00"
    assert credit_row["debit"] is None


def test_debit_credit_mode_requires_both_debit_and_credit_columns(client):

    response = client.post(
        "/api/csv-formats",
        json={
            "mapping": debit_credit_mapping(credit_index=None),
            "header": OTHER_BANK_HEADER,
        },
    )

    assert response.status_code == 422


def test_single_amount_mode_requires_an_amount_column(client):

    header = ["Date", "Account", "Description", "Amount", "Balance"]
    response = client.post(
        "/api/csv-formats",
        json={
            "mapping": {
                "name": "Bad", "date_format": "%Y-%m-%d", "amount_mode": "single_amount",
                "account_number_index": 1, "transaction_date_index": 0, "narration_index": 2,
                "balance_index": 4,
            },
            "header": header,
        },
    )

    assert response.status_code == 422


def test_a_mapping_without_a_balance_column_is_rejected(client):

    payload = debit_credit_mapping()
    del payload["balance_index"]

    response = client.post(
        "/api/csv-formats",
        json={"mapping": payload, "header": OTHER_BANK_HEADER},
    )

    assert response.status_code == 422


def test_preview_shows_parsed_rows_and_writes_nothing(client, db_session):

    response = preview_csv(client, other_bank_csv(), debit_credit_mapping())

    assert response.status_code == 200
    body = response.json()
    assert body["errors"] == []
    assert len(body["rows"]) == 1
    assert body["rows"][0]["narration"] == "Coffee"
    assert body["rows"][0]["debit"] == "5.00"

    assert db_session.query(Transaction).count() == 0
    assert db_session.query(Account).count() == 0


def test_preview_surfaces_row_errors_without_raising(client):

    bad_csv = other_bank_csv(row="304-559,9999,not-a-date,Coffee,,5.00,,100.00,WDL")

    response = preview_csv(client, bad_csv, debit_credit_mapping())

    assert response.status_code == 200
    body = response.json()
    assert body["rows"] == []
    assert len(body["errors"]) == 1
    assert "Transaction Date" in body["errors"][0]["message"]


def test_saving_the_same_header_twice_upserts_rather_than_duplicates(client, db_session):

    client.post("/api/csv-formats", json={"mapping": debit_credit_mapping(), "header": OTHER_BANK_HEADER})
    client.post(
        "/api/csv-formats",
        json={"mapping": debit_credit_mapping(name="Renamed"), "header": OTHER_BANK_HEADER},
    )

    mappings = db_session.query(CsvFormatMapping).all()
    assert len(mappings) == 1
    assert mappings[0].name == "Renamed"


def test_list_and_delete_csv_formats(client):

    created = client.post(
        "/api/csv-formats", json={"mapping": debit_credit_mapping(), "header": OTHER_BANK_HEADER}
    ).json()

    listed = client.get("/api/csv-formats").json()
    assert any(m["id"] == created["id"] for m in listed)

    delete_response = client.delete(f"/api/csv-formats/{created['id']}")
    assert delete_response.status_code == 204

    listed_after = client.get("/api/csv-formats").json()
    assert all(m["id"] != created["id"] for m in listed_after)


def test_a_mapping_with_no_transaction_type_column_does_not_leak_a_blank_type_option(client):
    """transaction_type is stored as "" (never None) when a mapping leaves
    transaction_type_index unset - GET /transactions/types must exclude
    that "" the same way it already excludes None, or the Rules page's and
    the ledger's Type dropdowns would each gain a blank, unselectable-
    looking option.
    """

    header = ["Date", "Account", "Description", "Debit", "Credit", "Balance"]
    mapping = {
        "name": "No Type Column Bank",
        "date_format": "%Y-%m-%d",
        "amount_mode": "debit_credit",
        "account_number_index": 1,
        "transaction_date_index": 0,
        "narration_index": 2,
        "debit_index": 3,
        "credit_index": 4,
        "balance_index": 5,
    }
    client.post("/api/csv-formats", json={"mapping": mapping, "header": header})

    header_line = ",".join(header)
    csv_content = f"{header_line}\n2026-07-24,9999,Coffee,5.00,,100.00\n"
    response = upload_csv(client, csv_content, filename="no_type.csv")
    assert response.status_code == 201

    types = client.get("/api/transactions/types").json()
    assert "" not in types
