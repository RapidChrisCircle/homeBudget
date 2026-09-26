from datetime import date
from decimal import Decimal

from app.models import Account, ImportBatch, Transaction


def make_account(db_session, name="Joint Everyday", account_number="1111"):

    account = Account(name=name, account_number=account_number)
    db_session.add(account)
    db_session.flush()
    return account


def make_transaction(db_session, account_id, transaction_date, amount, credit=False, account_number="1111",
                      category_id=None):

    batch = ImportBatch(filename="seed.csv", row_count=0, skipped_duplicate_count=0)
    db_session.add(batch)
    db_session.flush()

    db_session.add(Transaction(
        import_batch_id=batch.id,
        account_id=account_id,
        category_id=category_id,
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


# --- POST /forecast/scenario (T3.1) ----------------------------------------------

def test_post_scenario_shape_matches_the_baseline_forecast(client, db_session):

    account = make_account(db_session)
    make_transaction(db_session, account.id, date(2026, 4, 10), "-50.00")
    db_session.commit()

    response = client.post("/api/forecast/scenario", json={"months": 2})

    assert response.status_code == 200
    body = response.json()
    assert body["as_of"] == "2026-04-10"
    assert len(body["periods"]) == 3
    assert len(body["accounts"]) == 1
    assert body["combined"] is not None


def test_post_scenario_defaults_to_no_stopped_series_or_adjustments(client, db_session):

    account = make_account(db_session)
    make_transaction(db_session, account.id, date(2026, 4, 10), "-50.00")
    db_session.commit()

    baseline = client.get("/api/forecast?months=2").json()
    scenario = client.post("/api/forecast/scenario", json={"months": 2}).json()

    assert scenario == baseline


def test_post_scenario_stops_a_recurring_series(client, db_session):

    account = make_account(db_session)
    for month_day in [date(2026, 1, 15), date(2026, 2, 15), date(2026, 3, 15), date(2026, 4, 15)]:
        make_transaction(db_session, account.id, month_day, "-50.00", account_number=account.account_number)
    db_session.commit()

    baseline = client.get("/api/forecast?months=3").json()
    assert len(baseline["upcoming"]) > 0
    narration_key = baseline["upcoming"][0]["narration_key"]

    response = client.post("/api/forecast/scenario", json={
        "months": 3,
        "stopped_series": [{"account_id": account.id, "narration_key": narration_key}],
    })

    assert response.status_code == 200
    assert response.json()["upcoming"] == []


def test_post_scenario_applies_a_category_adjustment(client, db_session):

    account = make_account(db_session)
    category_id = client.post("/api/categories", json={"name": "Groceries", "kind": "expense"}).json()["id"]
    # Irregular (varying day-of-month, varying amount) so it lands in the
    # everyday run rate, not detected as its own recurring series.
    make_transaction(db_session, account.id, date(2026, 1, 3), "-100.00", category_id=category_id)
    make_transaction(db_session, account.id, date(2026, 2, 20), "-80.00", category_id=category_id)
    make_transaction(db_session, account.id, date(2026, 3, 9), "-120.00", category_id=category_id)
    make_transaction(db_session, account.id, date(2026, 4, 1), "-4.00")
    db_session.commit()

    baseline = client.get("/api/forecast?months=1").json()
    response = client.post("/api/forecast/scenario", json={
        "months": 1,
        "category_adjustments": [{"category_id": category_id, "percent": "-50"}],
    })

    assert response.status_code == 200
    body = response.json()
    baseline_rate = Decimal(baseline["accounts"][0]["daily_run_rate"])
    scenario_rate = Decimal(body["accounts"][0]["daily_run_rate"])
    assert scenario_rate > baseline_rate


def test_post_scenario_404s_for_an_unknown_category(client, db_session):

    make_account(db_session)
    db_session.commit()

    response = client.post("/api/forecast/scenario", json={
        "months": 1,
        "category_adjustments": [{"category_id": 999, "percent": "-50"}],
    })

    assert response.status_code == 404


def test_post_scenario_rejects_out_of_range_months(client):

    response = client.post("/api/forecast/scenario", json={"months": 999})

    assert response.status_code == 422
