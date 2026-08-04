from datetime import date

from app.models import Account, ImportBatch, Transaction


def make_account(db_session, name="Savings", account_number="1111",
                  account_type="savings", balance_sign="natural"):

    account = Account(
        name=name, account_number=account_number, account_type=account_type, balance_sign=balance_sign
    )
    db_session.add(account)
    db_session.flush()
    return account


def make_transaction(db_session, account_id, transaction_date, balance, narration="Deposit",
                     debit=None, credit="10.00", account_number="1111"):

    batch = ImportBatch(filename="seed.csv", row_count=0, skipped_duplicate_count=0)
    db_session.add(batch)
    db_session.flush()

    transaction = Transaction(
        import_batch_id=batch.id,
        account_id=account_id,
        account_number=account_number,
        transaction_date=transaction_date,
        narration=narration,
        debit=debit,
        credit=credit,
        balance=balance,
        transaction_type="DEP",
    )
    db_session.add(transaction)
    db_session.flush()
    return transaction


def months_from_now(n):
    year = date.today().year
    month = date.today().month + n
    year += (month - 1) // 12
    month = (month - 1) % 12 + 1
    return date(year, month, 1).isoformat()


# --- creation / validation -------------------------------------------------

def test_create_account_balance_goal_requires_an_account(client):

    response = client.post(
        "/api/goals",
        json={"name": "Emergency Fund", "target_amount": "5000.00", "mode": "account_balance"},
    )

    assert response.status_code == 422


def test_create_account_balance_goal(client, db_session):

    account = make_account(db_session)
    make_transaction(db_session, account.id, date(2026, 7, 24), balance="1500.00")
    db_session.commit()

    response = client.post(
        "/api/goals",
        json={
            "name": "Emergency Fund",
            "target_amount": "5000.00",
            "mode": "account_balance",
            "account_id": account.id,
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["current_amount"] == "1500.00"
    assert body["remaining"] == "3500.00"
    assert body["allocated_amount"] is None


def test_account_balance_goal_progress_is_the_signed_balance_not_raw(client, db_session):
    """The load-bearing test for account_balance mode: a goal linked to a
    LIABILITY account must not read raw balance as positive progress - it
    must go through signed_balance() the same as net worth does.
    """

    loan = make_account(db_session, name="Car Loan", account_number="2222", account_type="loan")
    make_transaction(db_session, loan.id, date(2026, 7, 24), balance="-4000.00", account_number="2222")
    db_session.commit()

    goal_id = client.post(
        "/api/goals",
        json={
            "name": "Payoff tracker",
            "target_amount": "5000.00",
            "mode": "account_balance",
            "account_id": loan.id,
        },
    ).json()["id"]

    body = client.get("/api/goals").json()
    goal = next(g for g in body["goals"] if g["id"] == goal_id)

    # signed_balance() for a natural liability with balance -4000.00 is
    # -4000.00 (see services/net_worth.py) - NOT +4000.00, which raw
    # balance would give if naively treated as "how much saved".
    assert goal["current_amount"] == "-4000.00"


def test_create_envelope_goal_requires_allocated_amount(client):

    response = client.post(
        "/api/goals",
        json={"name": "Holiday", "target_amount": "2000.00", "mode": "envelope"},
    )

    assert response.status_code == 422


def test_create_envelope_goal_reports_allocated_amount_as_progress(client):

    response = client.post(
        "/api/goals",
        json={
            "name": "Holiday",
            "target_amount": "2000.00",
            "mode": "envelope",
            "allocated_amount": "500.00",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["current_amount"] == "500.00"
    assert body["remaining"] == "1500.00"


def test_create_goal_rejects_a_non_positive_target_amount(client):

    response = client.post(
        "/api/goals",
        json={"name": "Holiday", "target_amount": "0.00", "mode": "envelope", "allocated_amount": "0.00"},
    )

    assert response.status_code == 422


def test_create_goal_rejects_an_unknown_mode(client):

    response = client.post(
        "/api/goals",
        json={"name": "Holiday", "target_amount": "500.00", "mode": "bogus"},
    )

    assert response.status_code == 422


# --- monthly_required --------------------------------------------------

def test_monthly_required_divides_remaining_by_whole_months(client):

    response = client.post(
        "/api/goals",
        json={
            "name": "Holiday",
            "target_amount": "1200.00",
            "mode": "envelope",
            "allocated_amount": "0.00",
            "target_date": months_from_now(4),
        },
    )

    assert response.status_code == 201
    assert response.json()["monthly_required"] == "300.00"


def test_monthly_required_is_absent_with_no_target_date(client):

    response = client.post(
        "/api/goals",
        json={"name": "Holiday", "target_amount": "1200.00", "mode": "envelope", "allocated_amount": "0.00"},
    )

    assert response.json()["monthly_required"] is None


def test_monthly_required_is_absent_once_the_goal_is_already_met(client):

    response = client.post(
        "/api/goals",
        json={
            "name": "Holiday",
            "target_amount": "1000.00",
            "mode": "envelope",
            "allocated_amount": "1000.00",
            "target_date": months_from_now(3),
        },
    )

    assert response.json()["monthly_required"] is None


# --- over-allocation (the drift check) --------------------------------

def test_over_allocation_is_reported_when_envelopes_exceed_the_account_balance(client, db_session):

    account = make_account(db_session, name="Shared Savings")
    make_transaction(db_session, account.id, date(2026, 7, 24), balance="600.00")
    db_session.commit()

    client.post(
        "/api/goals",
        json={
            "name": "Holiday", "target_amount": "2000.00", "mode": "envelope",
            "allocated_amount": "400.00", "account_id": account.id,
        },
    )
    client.post(
        "/api/goals",
        json={
            "name": "New Laptop", "target_amount": "1500.00", "mode": "envelope",
            "allocated_amount": "400.00", "account_id": account.id,
        },
    )

    body = client.get("/api/goals").json()
    summary = next(s for s in body["account_envelope_summaries"] if s["account_id"] == account.id)

    assert summary["over_allocated"] is True
    assert summary["allocated_total"] == "800.00"
    assert summary["over_allocated_by"] == "200.00"


def test_over_allocation_clears_when_reduced(client, db_session):

    account = make_account(db_session, name="Shared Savings")
    make_transaction(db_session, account.id, date(2026, 7, 24), balance="600.00")
    db_session.commit()

    goal_id = client.post(
        "/api/goals",
        json={
            "name": "Holiday", "target_amount": "2000.00", "mode": "envelope",
            "allocated_amount": "800.00", "account_id": account.id,
        },
    ).json()["id"]

    client.put(
        f"/api/goals/{goal_id}",
        json={
            "name": "Holiday", "target_amount": "2000.00", "mode": "envelope",
            "allocated_amount": "300.00", "account_id": account.id,
        },
    )

    body = client.get("/api/goals").json()
    summary = next(s for s in body["account_envelope_summaries"] if s["account_id"] == account.id)

    assert summary["over_allocated"] is False
    assert summary["over_allocated_by"] is None


def test_an_archived_envelope_goal_does_not_count_toward_allocation(client, db_session):

    account = make_account(db_session, name="Shared Savings")
    make_transaction(db_session, account.id, date(2026, 7, 24), balance="600.00")
    db_session.commit()

    goal_id = client.post(
        "/api/goals",
        json={
            "name": "Holiday", "target_amount": "2000.00", "mode": "envelope",
            "allocated_amount": "800.00", "account_id": account.id,
        },
    ).json()["id"]
    client.post(f"/api/goals/{goal_id}/archive")

    body = client.get("/api/goals?include_archived=true").json()
    summary = next((s for s in body["account_envelope_summaries"] if s["account_id"] == account.id), None)

    assert summary is None


# --- archiving -----------------------------------------------------------

def test_archived_goals_excluded_from_default_list(client):

    goal_id = client.post(
        "/api/goals",
        json={"name": "Holiday", "target_amount": "500.00", "mode": "envelope", "allocated_amount": "0.00"},
    ).json()["id"]
    client.post(f"/api/goals/{goal_id}/archive")

    ids = [g["id"] for g in client.get("/api/goals").json()["goals"]]
    assert goal_id not in ids

    ids_with_archived = [g["id"] for g in client.get("/api/goals?include_archived=true").json()["goals"]]
    assert goal_id in ids_with_archived


def test_restore_brings_an_archived_goal_back(client):

    goal_id = client.post(
        "/api/goals",
        json={"name": "Holiday", "target_amount": "500.00", "mode": "envelope", "allocated_amount": "0.00"},
    ).json()["id"]
    client.post(f"/api/goals/{goal_id}/archive")
    client.post(f"/api/goals/{goal_id}/restore")

    ids = [g["id"] for g in client.get("/api/goals").json()["goals"]]
    assert goal_id in ids


# --- deletion --------------------------------------------------------------

def test_delete_goal(client):

    goal_id = client.post(
        "/api/goals",
        json={"name": "Holiday", "target_amount": "500.00", "mode": "envelope", "allocated_amount": "0.00"},
    ).json()["id"]

    response = client.delete(f"/api/goals/{goal_id}")
    assert response.status_code == 204

    ids = [g["id"] for g in client.get("/api/goals").json()["goals"]]
    assert goal_id not in ids


def test_deleting_an_account_leaves_its_goal_intact_but_unlinked(client, db_session):

    account = make_account(db_session)
    db_session.commit()

    goal_id = client.post(
        "/api/goals",
        json={
            "name": "Emergency Fund", "target_amount": "5000.00",
            "mode": "account_balance", "account_id": account.id,
        },
    ).json()["id"]

    delete_response = client.delete(f"/api/accounts/{account.id}")
    assert delete_response.status_code == 204

    body = client.get("/api/goals").json()
    goal = next(g for g in body["goals"] if g["id"] == goal_id)

    assert goal["account_id"] is None
    assert goal["account_name"] is None
    # No account left to sign a balance by - progress reads as 0, not an error.
    assert goal["current_amount"] == "0"
