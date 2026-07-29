import io
from datetime import date

from app.models import ImportBatch, Transaction

HEADER = "BSB Number,Account Number,Transaction Date,Narration,Cheque Number,Debit,Credit,Balance,Transaction Type\n"

SAMPLE_CSV = HEADER + (
    ',5229 8024 5118 3514,24/07/2026,"CCTrueUp",,,3365.49,-1576.67,DEP\n'
    ',5229 8024 5118 3514,24/07/2026,"LS Taquiza               Newport      AU",,-98.00,,-4942.16,WDL\n'
    ',5229 8024 5118 3514,24/07/2026,"Sharon Alback Dance C    REDCLIFFE",,-1.53,,-4844.16,WDL\n'
    ',5229 8024 5118 3514,24/07/2026,"IGA NEWPORT              NEWPORT      QL",,-4.45,,-4842.63,WDL\n'
    ',5229 8024 5118 3514,24/07/2026,"RED ENERGY               CREMORNE",,-238.32,,-4838.18,WDL\n'
    '304-559,0128778,24/07/2026,"CCTrueUp",,-3365.49,,3000.00,TFD\n'
)


def upload(client, content: str, filename: str = "transactions.csv"):

    return client.post(
        "/api/transactions/import",
        files={"file": (filename, io.BytesIO(content.encode("utf-8")), "text/csv")},
    )


def test_import_valid_csv_inserts_transactions_and_batch(client):

    response = upload(client, SAMPLE_CSV)

    assert response.status_code == 201

    body = response.json()
    assert body["imported_count"] == 6
    assert body["skipped_duplicate_count"] == 0
    assert body["batch"]["row_count"] == 6

    assert len(client.get("/api/transactions").json()) == 6
    assert len(client.get("/api/import-batches").json()) == 1


def test_import_duplicate_rows_within_same_file_are_skipped(client):

    csv_content = HEADER + (
        ',1111,24/07/2026,"Coffee",,-5.00,,100.00,WDL\n'
        ',1111,24/07/2026,"Coffee",,-5.00,,100.00,WDL\n'
    )

    response = upload(client, csv_content)

    assert response.status_code == 201

    body = response.json()
    assert body["imported_count"] == 1
    assert body["skipped_duplicate_count"] == 1


def test_import_duplicate_against_existing_db_row_is_skipped(client, db_session):

    batch = ImportBatch(filename="seed.csv", row_count=1, skipped_duplicate_count=0)
    db_session.add(batch)
    db_session.flush()

    db_session.add(Transaction(
        import_batch_id=batch.id,
        bsb_number=None,
        account_number="1111",
        transaction_date=date(2026, 7, 24),
        narration="Coffee",
        cheque_number=None,
        debit="-5.00",
        credit=None,
        balance="100.00",
        transaction_type="WDL",
    ))
    db_session.commit()

    csv_content = HEADER + (
        ',1111,24/07/2026,"Coffee",,-5.00,,100.00,WDL\n'
        ',1111,24/07/2026,"New row",,-6.00,,94.00,WDL\n'
    )

    response = upload(client, csv_content)

    assert response.status_code == 201

    body = response.json()
    assert body["imported_count"] == 1
    assert body["skipped_duplicate_count"] == 1


def test_import_malformed_date_rejects_entire_file(client, db_session):

    csv_content = HEADER + (
        ',1111,24/07/2026,"Good row",,-5.00,,100.00,WDL\n'
        ',1111,32/13/2026,"Bad date",,-6.00,,94.00,WDL\n'
    )

    response = upload(client, csv_content)

    assert response.status_code == 422

    errors = response.json()["detail"]["errors"]
    assert any(e["row_number"] == 3 and "Transaction Date" in e["message"] for e in errors)

    assert db_session.query(Transaction).count() == 0
    assert db_session.query(ImportBatch).count() == 0


def test_import_non_numeric_debit_rejects_entire_file(client):

    csv_content = HEADER + ',1111,24/07/2026,"Bad amount",,abc,,100.00,WDL\n'

    response = upload(client, csv_content)

    assert response.status_code == 422

    errors = response.json()["detail"]["errors"]
    assert any("Debit" in e["message"] for e in errors)


def test_import_both_debit_and_credit_populated_rejects_row(client):

    csv_content = HEADER + ',1111,24/07/2026,"Both",,-5.00,5.00,100.00,WDL\n'

    response = upload(client, csv_content)

    assert response.status_code == 422

    errors = response.json()["detail"]["errors"]
    assert any("both Debit and Credit" in e["message"] for e in errors)


def test_import_neither_debit_nor_credit_populated_rejects_row(client):

    csv_content = HEADER + ',1111,24/07/2026,"Neither",,,,100.00,WDL\n'

    response = upload(client, csv_content)

    assert response.status_code == 422

    errors = response.json()["detail"]["errors"]
    assert any("neither Debit nor Credit" in e["message"] for e in errors)


def test_import_wrong_column_count_rejects_row(client):

    csv_content = HEADER + ',1111,24/07/2026,"Missing column",,-5.00,,100.00\n'

    response = upload(client, csv_content)

    assert response.status_code == 422

    errors = response.json()["detail"]["errors"]
    assert any("columns" in e["message"] for e in errors)


def test_import_non_utf8_file_rejects_with_422_not_500(client):

    # Raw 0x92 (a cp1252 right single quote) is not a valid standalone UTF-8
    # byte - a common real-world case for bank CSV exports saved as cp1252.
    prefix = (HEADER + ',1111,24/07/2026,"Joe').encode("utf-8")
    suffix = 's Cafe",,-5.00,,100.00,WDL\n'.encode("utf-8")
    csv_bytes = prefix + b"\x92" + suffix

    response = client.post(
        "/api/transactions/import",
        files={"file": ("transactions.csv", io.BytesIO(csv_bytes), "text/csv")},
    )

    assert response.status_code == 422

    errors = response.json()["detail"]["errors"]
    assert any("UTF-8" in e["message"] for e in errors)


def test_import_multiple_errors_reports_all_row_numbers(client):

    csv_content = HEADER + (
        ',1111,32/13/2026,"Bad date",,-5.00,,100.00,WDL\n'
        ',1111,24/07/2026,"Bad amount",,abc,,94.00,WDL\n'
    )

    response = upload(client, csv_content)

    assert response.status_code == 422

    row_numbers = {e["row_number"] for e in response.json()["detail"]["errors"]}
    assert row_numbers == {2, 3}


def test_delete_single_transaction(client):

    upload(client, SAMPLE_CSV)
    transaction_id = client.get("/api/transactions").json()[0]["id"]

    response = client.delete(f"/api/transactions/{transaction_id}")

    assert response.status_code == 204
    assert len(client.get("/api/transactions").json()) == 5


def test_delete_single_transaction_404_when_missing(client):

    response = client.delete("/api/transactions/999")

    assert response.status_code == 404


def test_delete_import_batch_cascades_to_transactions(client):

    upload(client, HEADER + ',1111,24/07/2026,"First batch",,-5.00,,100.00,WDL\n', filename="a.csv")
    upload(client, HEADER + ',2222,24/07/2026,"Second batch",,-6.00,,94.00,WDL\n', filename="b.csv")

    batches = client.get("/api/import-batches").json()
    first_batch_id = next(b["id"] for b in batches if b["filename"] == "a.csv")

    response = client.delete(f"/api/import-batches/{first_batch_id}")

    assert response.status_code == 204

    remaining = client.get("/api/transactions").json()
    assert len(remaining) == 1
    assert remaining[0]["narration"] == "Second batch"


def test_delete_import_batch_404_when_missing(client):

    response = client.delete("/api/import-batches/999")

    assert response.status_code == 404


def test_wipe_all_deletes_everything(client):

    upload(client, SAMPLE_CSV)

    response = client.delete("/api/transactions")

    assert response.status_code == 204
    assert client.get("/api/transactions").json() == []
    assert client.get("/api/import-batches").json() == []


def test_list_transactions_sorted_by_date_desc(client):

    csv_content = HEADER + (
        ',1111,01/07/2026,"Older",,-5.00,,100.00,WDL\n'
        ',1111,20/07/2026,"Newer",,-6.00,,94.00,WDL\n'
    )

    upload(client, csv_content)

    narrations = [t["narration"] for t in client.get("/api/transactions").json()]
    assert narrations == ["Newer", "Older"]


def test_list_transactions_empty_returns_empty_list_not_404(client):

    response = client.get("/api/transactions")

    assert response.status_code == 200
    assert response.json() == []
