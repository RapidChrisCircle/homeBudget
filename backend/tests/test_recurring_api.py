from datetime import date

from app.models import Account, ImportBatch, RecurringDismissal, Transaction


def make_account(db_session, name="Joint Everyday", account_number="1111"):

    account = Account(name=name, account_number=account_number)
    db_session.add(account)
    db_session.flush()
    return account


def make_transaction(db_session, account_id, transaction_date, narration, amount):

    batch = ImportBatch(filename="seed.csv", row_count=0, skipped_duplicate_count=0)
    db_session.add(batch)
    db_session.flush()

    db_session.add(Transaction(
        import_batch_id=batch.id,
        account_id=account_id,
        account_number="1111",
        transaction_date=transaction_date,
        narration=narration,
        debit=amount,
        balance="100.00",
        transaction_type="WDL",
    ))
    db_session.flush()


def seed_monthly_series(db_session, account_id, narration="NETFLIX.COM", months=4, day=15,
                         start_month=1, amount="-15.99"):

    for i in range(months):
        month = start_month + i
        year = 2026 + (month - 1) // 12
        month = (month - 1) % 12 + 1
        make_transaction(db_session, account_id, date(year, month, day), narration, amount)

    db_session.commit()


def test_get_recurring_returns_series_summary_and_as_of(client, db_session):

    account = make_account(db_session)
    seed_monthly_series(db_session, account.id)

    response = client.get("/api/recurring")

    assert response.status_code == 200
    body = response.json()
    assert body["as_of"] == "2026-04-15"
    assert body["summary"]["series_count"] == 1
    assert len(body["series"]) == 1
    assert body["series"][0]["cadence"] == "monthly"
    assert body["series"][0]["account_id"] == account.id


def test_get_recurring_empty_ledger_returns_empty_list(client):

    response = client.get("/api/recurring")

    assert response.status_code == 200
    body = response.json()
    assert body["series"] == []
    assert body["summary"]["series_count"] == 0
    assert body["as_of"] is None


def test_dismiss_then_refetch_excludes_the_series(client, db_session):

    account = make_account(db_session)
    seed_monthly_series(db_session, account.id)

    key = client.get("/api/recurring").json()["series"][0]["narration_key"]

    dismiss_response = client.post(
        "/api/recurring/dismissals",
        json={"account_id": account.id, "narration_key": key},
    )
    assert dismiss_response.status_code == 201

    response = client.get("/api/recurring")
    assert response.json()["series"] == []

    with_dismissed = client.get("/api/recurring?include_dismissed=true").json()
    assert len(with_dismissed["series"]) == 1
    assert with_dismissed["series"][0]["dismissed"] is True
    # The frontend restores by DELETEing this id - it has no other way to
    # find the dismissal row a series corresponds to.
    assert with_dismissed["series"][0]["dismissal_id"] == dismiss_response.json()["id"]
    # A dismissed series never contributes to the summary, even when listed.
    assert with_dismissed["summary"]["series_count"] == 0


def test_dismissing_twice_is_idempotent(client, db_session):

    account = make_account(db_session)
    seed_monthly_series(db_session, account.id)
    key = client.get("/api/recurring").json()["series"][0]["narration_key"]

    first = client.post("/api/recurring/dismissals", json={"account_id": account.id, "narration_key": key})
    second = client.post("/api/recurring/dismissals", json={"account_id": account.id, "narration_key": key})

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    assert db_session.query(RecurringDismissal).count() == 1


def test_dismiss_404s_for_unknown_account(client):

    response = client.post(
        "/api/recurring/dismissals",
        json={"account_id": 999999, "narration_key": "NETFLIX.COM"},
    )

    assert response.status_code == 404


def test_restore_removes_the_dismissal(client, db_session):

    account = make_account(db_session)
    seed_monthly_series(db_session, account.id)
    key = client.get("/api/recurring").json()["series"][0]["narration_key"]

    dismissal_id = client.post(
        "/api/recurring/dismissals", json={"account_id": account.id, "narration_key": key}
    ).json()["id"]

    delete_response = client.delete(f"/api/recurring/dismissals/{dismissal_id}")
    assert delete_response.status_code == 204

    response = client.get("/api/recurring")
    assert len(response.json()["series"]) == 1


def test_restore_404s_for_unknown_dismissal(client):

    response = client.delete("/api/recurring/dismissals/999999")

    assert response.status_code == 404


def test_dismissals_cascade_when_their_account_is_deleted(client, db_session):
    # delete_account only ever succeeds on an account with no transactions
    # (see test_accounts.py), so a dismissal is the only thing left to clean
    # up - this is exactly the case the ORM cascade on
    # Account.recurring_dismissals exists for.
    account = make_account(db_session)
    db_session.add(RecurringDismissal(account_id=account.id, narration_key="NETFLIX.COM"))
    db_session.commit()

    delete_response = client.delete(f"/api/accounts/{account.id}")

    assert delete_response.status_code == 204
    assert db_session.query(RecurringDismissal).count() == 0
