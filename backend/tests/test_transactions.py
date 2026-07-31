import io
from datetime import date

import pytest

from app.models import Account, CategoryRule, ImportBatch, Transaction
from app.services import csv_formats
from app.services.csv_formats import CsvFormat

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


def test_import_auto_creates_account_for_unknown_account_number(client, db_session):

    response = upload(client, HEADER + ',1111,24/07/2026,"Coffee",,-5.00,,100.00,WDL\n')

    assert response.status_code == 201
    assert response.json()["new_account_count"] == 1

    account = db_session.query(Account).filter_by(account_number="1111").one()
    assert account.name == "1111"
    assert account.institution == "ANZ"

    transaction = db_session.query(Transaction).one()
    assert transaction.account_id == account.id


def test_import_reuses_existing_account_across_imports(client, db_session):

    upload(client, HEADER + ',1111,24/07/2026,"Coffee",,-5.00,,100.00,WDL\n')
    response = upload(client, HEADER + ',1111,25/07/2026,"Groceries",,-6.00,,94.00,WDL\n')

    assert response.status_code == 201
    assert response.json()["new_account_count"] == 0
    assert db_session.query(Account).filter_by(account_number="1111").count() == 1


def test_import_single_csv_with_multiple_accounts_creates_all_accounts(client, db_session):

    response = upload(client, SAMPLE_CSV)

    assert response.status_code == 201
    assert response.json()["new_account_count"] == 2

    account_numbers = {a.account_number for a in db_session.query(Account).all()}
    assert account_numbers == {"5229 8024 5118 3514", "0128778"}


def test_import_unrecognized_header_row_rejected(client):

    bad_header = "Date,Description,Amount\n"
    response = client.post(
        "/api/transactions/import",
        files={"file": ("bad.csv", io.BytesIO(bad_header.encode("utf-8")), "text/csv")},
    )

    assert response.status_code == 422

    errors = response.json()["detail"]["errors"]
    assert any("does not match any supported bank format" in e["message"] for e in errors)


@pytest.fixture
def second_bank_format():

    # Same 9-column logical layout as the ANZ format (see CsvFormat docstring),
    # just different header labels and an ISO date format - a realistic
    # example of a second bank's export differing only cosmetically.
    fmt = CsvFormat(
        key="other_bank",
        institution="Other Bank",
        expected_headers=[
            "BSB", "Account", "Value Date", "Description", "Cheque No",
            "Debit Amount", "Credit Amount", "Running Balance", "Type",
        ],
        date_format="%Y-%m-%d",
    )
    csv_formats.CSV_FORMATS.append(fmt)

    yield fmt

    csv_formats.CSV_FORMATS.remove(fmt)


def test_import_second_format_is_auto_detected_and_sets_institution(client, db_session, second_bank_format):

    header = "BSB,Account,Value Date,Description,Cheque No,Debit Amount,Credit Amount,Running Balance,Type\n"
    csv_content = header + ',9999,2026-07-24,"Coffee",,-5.00,,100.00,WDL\n'

    response = client.post(
        "/api/transactions/import",
        files={"file": ("other_bank.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")},
    )

    assert response.status_code == 201

    account = db_session.query(Account).filter_by(account_number="9999").one()
    assert account.institution == "Other Bank"


def test_assign_category_to_transaction(client):

    upload(client, HEADER + ',1111,24/07/2026,"Coffee",,-5.00,,100.00,WDL\n')
    transaction_id = client.get("/api/transactions").json()[0]["id"]
    category_id = client.post("/api/categories", json={"name": "Groceries"}).json()["id"]

    response = client.patch(f"/api/transactions/{transaction_id}/category", json={"category_id": category_id})

    assert response.status_code == 200
    body = response.json()
    assert body["category_id"] == category_id
    assert body["category_name"] == "Groceries"


def test_clear_category_from_transaction(client):

    upload(client, HEADER + ',1111,24/07/2026,"Coffee",,-5.00,,100.00,WDL\n')
    transaction_id = client.get("/api/transactions").json()[0]["id"]
    category_id = client.post("/api/categories", json={"name": "Groceries"}).json()["id"]

    client.patch(f"/api/transactions/{transaction_id}/category", json={"category_id": category_id})
    response = client.patch(f"/api/transactions/{transaction_id}/category", json={"category_id": None})

    assert response.status_code == 200
    assert response.json()["category_id"] is None


def test_assign_category_404_when_transaction_missing(client):

    category_id = client.post("/api/categories", json={"name": "Groceries"}).json()["id"]

    response = client.patch("/api/transactions/999/category", json={"category_id": category_id})

    assert response.status_code == 404


def test_assign_category_404_when_category_missing(client):

    upload(client, HEADER + ',1111,24/07/2026,"Coffee",,-5.00,,100.00,WDL\n')
    transaction_id = client.get("/api/transactions").json()[0]["id"]

    response = client.patch(f"/api/transactions/{transaction_id}/category", json={"category_id": 999})

    assert response.status_code == 404


def test_import_auto_categorizes_matching_rows(client, db_session):

    category_id = client.post("/api/categories", json={"name": "Groceries"}).json()["id"]
    rule_id = client.post(
        "/api/category-rules",
        json={"narration_pattern": "woolworths", "category_id": category_id},
    ).json()["id"]

    upload(client, HEADER + ',1111,24/07/2026,"WOOLWORTHS NEWPORT",,-98.00,,100.00,WDL\n')

    transaction = db_session.query(Transaction).one()
    assert transaction.category_id == category_id
    assert transaction.categorized_by_rule_id == rule_id


def test_import_reports_auto_categorized_count(client):

    category_id = client.post("/api/categories", json={"name": "Groceries"}).json()["id"]
    client.post("/api/category-rules", json={"narration_pattern": "woolworths", "category_id": category_id})

    response = upload(client, HEADER + (
        ',1111,24/07/2026,"WOOLWORTHS NEWPORT",,-98.00,,100.00,WDL\n'
        ',1111,25/07/2026,"COLES NEWPORT",,-12.00,,88.00,WDL\n'
    ))

    assert response.json()["auto_categorized_count"] == 1


def test_import_leaves_non_matching_rows_uncategorized(client, db_session):

    category_id = client.post("/api/categories", json={"name": "Groceries"}).json()["id"]
    client.post("/api/category-rules", json={"narration_pattern": "woolworths", "category_id": category_id})

    upload(client, HEADER + ',1111,24/07/2026,"COLES NEWPORT",,-12.00,,88.00,WDL\n')

    transaction = db_session.query(Transaction).one()
    assert transaction.category_id is None
    assert transaction.categorized_by_rule_id is None


def test_import_with_no_rules_reports_zero_auto_categorized(client):

    response = upload(client, HEADER + ',1111,24/07/2026,"WOOLWORTHS NEWPORT",,-98.00,,100.00,WDL\n')

    assert response.json()["auto_categorized_count"] == 0


def test_manual_category_patch_clears_rule_marker(client, db_session):

    upload(client, HEADER + ',1111,24/07/2026,"Coffee",,-5.00,,100.00,WDL\n')
    transaction = db_session.query(Transaction).one()
    category_id = client.post("/api/categories", json={"name": "Groceries"}).json()["id"]

    # Simulate the row having been auto-categorized by a rule earlier.
    rule = CategoryRule(narration_pattern="coffee", category_id=category_id, priority=0)
    db_session.add(rule)
    db_session.flush()
    transaction.category_id = category_id
    transaction.categorized_by_rule_id = rule.id
    db_session.commit()

    other_id = client.post("/api/categories", json={"name": "Dining"}).json()["id"]
    response = client.patch(f"/api/transactions/{transaction.id}/category", json={"category_id": other_id})

    assert response.status_code == 200
    assert response.json()["categorized_by_rule_id"] is None

    db_session.expire_all()
    assert db_session.get(Transaction, transaction.id).categorized_by_rule_id is None


def test_clearing_category_manually_clears_rule_marker(client, db_session):

    upload(client, HEADER + ',1111,24/07/2026,"Coffee",,-5.00,,100.00,WDL\n')
    transaction = db_session.query(Transaction).one()
    category_id = client.post("/api/categories", json={"name": "Groceries"}).json()["id"]

    rule = CategoryRule(narration_pattern="coffee", category_id=category_id, priority=0)
    db_session.add(rule)
    db_session.flush()
    transaction.category_id = category_id
    transaction.categorized_by_rule_id = rule.id
    db_session.commit()

    response = client.patch(f"/api/transactions/{transaction.id}/category", json={"category_id": None})

    assert response.status_code == 200
    assert response.json()["category_id"] is None
    assert response.json()["categorized_by_rule_id"] is None


def test_bulk_category_update_clears_rule_marker(client, db_session):

    upload(client, HEADER + ',1111,24/07/2026,"Coffee",,-5.00,,100.00,WDL\n')
    transaction = db_session.query(Transaction).one()
    category_id = client.post("/api/categories", json={"name": "Groceries"}).json()["id"]

    rule = CategoryRule(narration_pattern="coffee", category_id=category_id, priority=0)
    db_session.add(rule)
    db_session.flush()
    transaction.category_id = category_id
    transaction.categorized_by_rule_id = rule.id
    db_session.commit()

    other_id = client.post("/api/categories", json={"name": "Dining"}).json()["id"]
    response = client.post(
        "/api/transactions/bulk-category",
        json={"transaction_ids": [transaction.id], "category_id": other_id},
    )

    assert response.status_code == 200

    db_session.expire_all()
    assert db_session.get(Transaction, transaction.id).categorized_by_rule_id is None


def test_bulk_assign_category_to_transactions(client):

    upload(client, SAMPLE_CSV)
    transaction_ids = [t["id"] for t in client.get("/api/transactions").json()]
    category_id = client.post("/api/categories", json={"name": "Groceries"}).json()["id"]

    response = client.post(
        "/api/transactions/bulk-category",
        json={"transaction_ids": transaction_ids, "category_id": category_id},
    )

    assert response.status_code == 200
    assert response.json()["updated_count"] == len(transaction_ids)

    categories = {t["category_id"] for t in client.get("/api/transactions").json()}
    assert categories == {category_id}
