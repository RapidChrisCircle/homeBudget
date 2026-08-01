from datetime import date

from app.models import Account, ImportBatch, Transaction


def make_account(db_session, name="Joint Everyday", account_number="1111"):

    account = Account(name=name, account_number=account_number)
    db_session.add(account)
    db_session.flush()
    return account


def make_transaction(db_session, account_id, transaction_date, amount, credit=False, account_number="1111"):

    batch = ImportBatch(filename="seed.csv", row_count=0, skipped_duplicate_count=0)
    db_session.add(batch)
    db_session.flush()

    db_session.add(Transaction(
        import_batch_id=batch.id,
        account_id=account_id,
        account_number=account_number,
        transaction_date=transaction_date,
        narration="Coffee",
        debit=None if credit else amount,
        credit=amount if credit else None,
        balance="100.00",
        transaction_type="WDL",
    ))
    db_session.flush()


def test_get_forecast_shape(client, db_session):

    account = make_account(db_session)
    make_transaction(db_session, account.id, date(2026, 4, 10), "-50.00")
    db_session.commit()

    response = client.get("/api/forecast?months=2")

    assert response.status_code == 200
    body = response.json()
    assert body["as_of"] == "2026-04-10"
    assert len(body["periods"]) == 3  # 1 partial + 2 whole months
    assert body["periods"][0]["is_partial"] is True
    assert body["periods"][1]["is_partial"] is False
    assert len(body["accounts"]) == 1
    assert body["accounts"][0]["account_id"] == account.id
    assert len(body["accounts"][0]["months"]) == 3
    assert body["combined"] is not None


def test_get_forecast_on_an_empty_ledger_returns_empty_not_an_error(client):

    response = client.get("/api/forecast")

    assert response.status_code == 200
    body = response.json()
    assert body["as_of"] is None
    assert body["periods"] == []
    assert body["accounts"] == []
    assert body["combined"] is None
    assert body["upcoming"] == []


def test_get_forecast_defaults_to_three_months(client, db_session):

    account = make_account(db_session)
    make_transaction(db_session, account.id, date(2026, 4, 10), "-50.00")
    db_session.commit()

    response = client.get("/api/forecast")

    assert len(response.json()["periods"]) == 4  # 1 partial + 3 whole months


def test_get_forecast_rejects_zero_months(client):

    response = client.get("/api/forecast?months=0")

    assert response.status_code == 422


def test_get_forecast_rejects_excessive_months(client):

    response = client.get("/api/forecast?months=999")

    assert response.status_code == 422
