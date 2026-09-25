from datetime import date

from app.models import Account, ImportBatch, Transaction

ACCOUNT_PAYLOAD = {
    "name": "Joint Everyday",
    "institution": "ANZ",
    "account_type": "everyday",
    "bsb_number": "013-006",
    "account_number": "5229 8024 5118 3514",
}


def test_create_account(client):

    response = client.post("/api/accounts", json=ACCOUNT_PAYLOAD)

    assert response.status_code == 201

    body = response.json()
    assert body["name"] == "Joint Everyday"
    assert body["account_number"] == "5229 8024 5118 3514"
    assert "id" in body


def test_create_account_has_no_balance_yet(client):

    response = client.post("/api/accounts", json=ACCOUNT_PAYLOAD)

    body = response.json()
    assert body["balance"] is None
    assert body["balance_as_of"] is None


def test_get_account_balance_from_most_recent_transaction(client, db_session):

    account = Account(**ACCOUNT_PAYLOAD)
    db_session.add(account)
    db_session.flush()

    batch = ImportBatch(filename="seed.csv", row_count=2, skipped_duplicate_count=0)
    db_session.add(batch)
    db_session.flush()

    db_session.add(Transaction(
        import_batch_id=batch.id,
        account_id=account.id,
        bsb_number=None,
        account_number=account.account_number,
        transaction_date=date(2026, 7, 24),
        narration="Newer",
        cheque_number=None,
        debit="-5.00",
        credit=None,
        balance="-4838.18",
        transaction_type="WDL",
    ))
    # Imported later (higher id) but an OLDER statement - must not win.
    db_session.add(Transaction(
        import_batch_id=batch.id,
        account_id=account.id,
        bsb_number=None,
        account_number=account.account_number,
        transaction_date=date(2026, 6, 1),
        narration="Older, imported later",
        cheque_number=None,
        debit="-10.00",
        credit=None,
        balance="-100.00",
        transaction_type="WDL",
    ))
    db_session.commit()

    response = client.get(f"/api/accounts/{account.id}")

    body = response.json()
    assert body["balance"] == "-4838.18"
    assert body["balance_as_of"] == "2026-07-24"


def test_list_accounts_includes_balances(client, db_session):

    account = Account(**ACCOUNT_PAYLOAD)
    db_session.add(account)
    db_session.flush()

    batch = ImportBatch(filename="seed.csv", row_count=1, skipped_duplicate_count=0)
    db_session.add(batch)
    db_session.flush()

    db_session.add(Transaction(
        import_batch_id=batch.id,
        account_id=account.id,
        bsb_number=None,
        account_number=account.account_number,
        transaction_date=date(2026, 7, 24),
        narration="Coffee",
        cheque_number=None,
        debit="-5.00",
        credit=None,
        balance="100.00",
        transaction_type="WDL",
    ))
    db_session.commit()

    accounts = client.get("/api/accounts").json()

    assert accounts[0]["balance"] == "100.00"
    assert accounts[0]["balance_as_of"] == "2026-07-24"


def test_create_account_duplicate_account_number_rejected(client):

    client.post("/api/accounts", json=ACCOUNT_PAYLOAD)
    response = client.post("/api/accounts", json=ACCOUNT_PAYLOAD)

    assert response.status_code == 409


def test_list_accounts_sorted_by_name(client):

    client.post("/api/accounts", json={**ACCOUNT_PAYLOAD, "name": "Zeta", "account_number": "1"})
    client.post("/api/accounts", json={**ACCOUNT_PAYLOAD, "name": "Alpha", "account_number": "2"})

    names = [a["name"] for a in client.get("/api/accounts").json()]
    assert names == ["Alpha", "Zeta"]


def test_get_account_404_when_missing(client):

    response = client.get("/api/accounts/999")

    assert response.status_code == 404


def test_update_account(client):

    account_id = client.post("/api/accounts", json=ACCOUNT_PAYLOAD).json()["id"]

    response = client.put(
        f"/api/accounts/{account_id}",
        json={**ACCOUNT_PAYLOAD, "name": "Renamed Account"},
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Renamed Account"


def test_update_account_404_when_missing(client):

    response = client.put("/api/accounts/999", json=ACCOUNT_PAYLOAD)

    assert response.status_code == 404


def test_delete_account(client):

    account_id = client.post("/api/accounts", json=ACCOUNT_PAYLOAD).json()["id"]

    response = client.delete(f"/api/accounts/{account_id}")

    assert response.status_code == 204
    assert client.get(f"/api/accounts/{account_id}").status_code == 404


def test_delete_account_404_when_missing(client):

    response = client.delete("/api/accounts/999")

    assert response.status_code == 404


def test_delete_account_with_linked_transactions_is_blocked(client, db_session):

    account = Account(**ACCOUNT_PAYLOAD)
    db_session.add(account)
    db_session.flush()

    batch = ImportBatch(filename="seed.csv", row_count=1, skipped_duplicate_count=0)
    db_session.add(batch)
    db_session.flush()

    db_session.add(Transaction(
        import_batch_id=batch.id,
        account_id=account.id,
        bsb_number=None,
        account_number=account.account_number,
        transaction_date=date(2026, 7, 24),
        narration="Coffee",
        cheque_number=None,
        debit="-5.00",
        credit=None,
        balance="100.00",
        transaction_type="WDL",
    ))
    db_session.commit()

    response = client.delete(f"/api/accounts/{account.id}")

    assert response.status_code == 409


def _seed_transaction(db_session, account, transaction_date, balance, debit=None, credit=None, narration="Coffee"):

    batch = ImportBatch(filename="seed.csv", row_count=1, skipped_duplicate_count=0)
    db_session.add(batch)
    db_session.flush()

    transaction = Transaction(
        import_batch_id=batch.id,
        account_id=account.id,
        bsb_number=None,
        account_number=account.account_number,
        transaction_date=transaction_date,
        narration=narration,
        cheque_number=None,
        debit=debit,
        credit=credit,
        balance=balance,
        transaction_type="WDL" if debit is not None else "DEP",
    )
    db_session.add(transaction)
    db_session.flush()
    return transaction


def test_get_account_coverage_reports_no_gaps_for_a_clean_account(client, db_session):

    account = Account(**ACCOUNT_PAYLOAD)
    db_session.add(account)
    db_session.flush()

    _seed_transaction(db_session, account, date(2026, 7, 1), "100.00", credit="100.00")
    _seed_transaction(db_session, account, date(2026, 7, 5), "80.00", debit="-20.00")
    db_session.commit()

    response = client.get(f"/api/accounts/{account.id}/coverage")

    assert response.status_code == 200
    body = response.json()
    assert body["account_id"] == account.id
    assert body["gaps"] == []


def test_get_account_coverage_reports_a_detected_gap(client, db_session):

    account = Account(**ACCOUNT_PAYLOAD)
    db_session.add(account)
    db_session.flush()

    _seed_transaction(db_session, account, date(2026, 6, 30), "500.00", credit="500.00")
    _seed_transaction(db_session, account, date(2026, 8, 1), "200.00", debit="-50.00")
    db_session.commit()

    response = client.get(f"/api/accounts/{account.id}/coverage")

    body = response.json()
    assert len(body["gaps"]) == 1
    gap = body["gaps"][0]
    assert gap["before_date"] == "2026-06-30"
    assert gap["after_date"] == "2026-08-01"
    assert gap["discrepancy"] == "-250.00"


def test_get_account_coverage_404s_on_an_unknown_account(client):

    response = client.get("/api/accounts/999999/coverage")

    assert response.status_code == 404
