from datetime import date
from decimal import Decimal

from app.models import ImportBatch, Transaction


def make_account(client, name="Cash", account_number="CASH"):

    return client.post("/api/accounts", json={"name": name, "account_number": account_number}).json()


def make_category(client, name="Groceries", kind="expense"):

    return client.post("/api/categories", json={"name": name, "kind": kind}).json()


def create_manual(client, account_id, transaction_date="2026-09-01", narration="Snacks",
                   debit=None, credit=None, category_id=None, note=None, transaction_type=None):

    payload = {
        "account_id": account_id,
        "transaction_date": transaction_date,
        "narration": narration,
        "debit": debit,
        "credit": credit,
        "category_id": category_id,
        "note": note,
        "transaction_type": transaction_type,
    }
    return client.post("/api/transactions", json=payload)


def seed_imported_transaction(db_session, account_id, account_number, transaction_date=date(2026, 9, 10),
                               debit=Decimal("-5.00"), balance=Decimal("100.00")):

    batch = ImportBatch(filename="statement.csv", row_count=1, skipped_duplicate_count=0, skipped_authorisation_count=0)
    db_session.add(batch)
    db_session.flush()

    transaction = Transaction(
        import_batch_id=batch.id,
        account_id=account_id,
        account_number=account_number,
        transaction_date=transaction_date,
        narration="Bank fee",
        debit=debit,
        balance=balance,
        transaction_type="WDL",
        is_manual=False,
    )
    db_session.add(transaction)
    db_session.commit()
    db_session.refresh(transaction)
    return transaction


# --- create ------------------------------------------------------------------------


def test_create_manual_expense_is_flagged_and_negative(client):

    account = make_account(client)

    response = create_manual(client, account["id"], debit="12.50")

    assert response.status_code == 201
    body = response.json()
    assert body["is_manual"] is True
    assert body["debit"] == "-12.50"
    assert body["credit"] is None
    assert body["balance"] == "-12.50"
    assert body["transaction_type"] == "WDL"


def test_create_manual_income_is_positive_credit(client):

    account = make_account(client)

    response = create_manual(client, account["id"], narration="Reimbursement", credit="20.00")

    assert response.status_code == 201
    body = response.json()
    assert body["credit"] == "20.00"
    assert body["debit"] is None
    assert body["balance"] == "20.00"
    assert body["transaction_type"] == "DEP"


def test_create_manual_balance_carries_forward_from_the_accounts_current_balance(client):

    account = make_account(client)
    create_manual(client, account["id"], transaction_date="2026-09-01", debit="12.50")

    second = create_manual(client, account["id"], transaction_date="2026-09-02", credit="100.00")

    assert second.json()["balance"] == "87.50"


def test_create_manual_rejects_both_debit_and_credit(client):

    account = make_account(client)

    response = create_manual(client, account["id"], debit="5.00", credit="5.00")

    assert response.status_code == 422
    assert "exactly one" in response.json()["detail"].lower()


def test_create_manual_rejects_neither_debit_nor_credit(client):

    account = make_account(client)

    response = create_manual(client, account["id"])

    assert response.status_code == 422


def test_create_manual_rejects_a_non_positive_amount(client):

    account = make_account(client)

    response = create_manual(client, account["id"], debit="0.00")

    assert response.status_code == 422
    assert "positive" in response.json()["detail"].lower()


def test_create_manual_rejects_an_unknown_account(client):

    response = create_manual(client, 999, debit="5.00")

    assert response.status_code == 404


def test_create_manual_rejects_backdating_before_the_accounts_latest_transaction(client):

    account = make_account(client)
    create_manual(client, account["id"], transaction_date="2026-09-05", debit="10.00")

    response = create_manual(client, account["id"], transaction_date="2026-09-01", debit="5.00")

    assert response.status_code == 422
    assert "on or after" in response.json()["detail"]


def test_create_manual_on_the_same_day_as_the_latest_transaction_is_allowed(client):
    """Same-day is not backdating - the tie-break is transaction id, which a
    freshly inserted row always wins (see services/ledger.py's
    _latest_balance_subquery ordering)."""

    account = make_account(client)
    create_manual(client, account["id"], transaction_date="2026-09-05", debit="10.00")

    response = create_manual(client, account["id"], transaction_date="2026-09-05", debit="5.00")

    assert response.status_code == 201
    assert response.json()["balance"] == "-15.00"


def test_create_manual_on_a_brand_new_account_starts_from_zero(client):

    account = make_account(client)

    response = create_manual(client, account["id"], debit="15.00")

    assert response.json()["balance"] == "-15.00"


def test_create_manual_rejects_a_category_with_children(client):

    account = make_account(client)
    parent = make_category(client, "Food")
    client.post("/api/categories", json={"name": "Takeaway", "kind": "expense", "parent_id": parent["id"]})

    response = create_manual(client, account["id"], debit="5.00", category_id=parent["id"])

    assert response.status_code == 422


def test_create_manual_applies_a_matching_rule_when_no_category_given(client):

    account = make_account(client)
    category = make_category(client)
    client.post("/api/category-rules", json={"narration_pattern": "uber", "category_id": category["id"]})

    response = create_manual(client, account["id"], narration="Uber trip", debit="20.00")

    body = response.json()
    assert body["category_id"] == category["id"]
    assert body["categorized_by_rule_id"] is not None


def test_create_manual_with_an_explicit_category_skips_rule_matching(client):

    account = make_account(client)
    matched_category = make_category(client, "Transport")
    explicit_category = make_category(client, "Personal")
    client.post("/api/category-rules", json={"narration_pattern": "uber", "category_id": matched_category["id"]})

    response = create_manual(
        client, account["id"], narration="Uber trip", debit="20.00", category_id=explicit_category["id"]
    )

    body = response.json()
    assert body["category_id"] == explicit_category["id"]
    assert body["categorized_by_rule_id"] is None


def test_create_manual_defaults_transaction_type_from_sign(client):

    account = make_account(client)

    debit_txn = create_manual(client, account["id"], debit="5.00").json()
    credit_txn = create_manual(
        client, account["id"], transaction_date="2026-09-02", credit="5.00"
    ).json()

    assert debit_txn["transaction_type"] == "WDL"
    assert credit_txn["transaction_type"] == "DEP"


def test_create_manual_accepts_an_explicit_transaction_type(client):

    account = make_account(client)

    response = create_manual(client, account["id"], debit="5.00", transaction_type="Cash Withdrawal")

    assert response.json()["transaction_type"] == "Cash Withdrawal"


def test_create_manual_uses_one_shared_batch_across_entries(client):

    account = make_account(client)
    create_manual(client, account["id"], transaction_date="2026-09-01", debit="5.00")
    create_manual(client, account["id"], transaction_date="2026-09-02", debit="5.00")

    batches = client.get("/api/import-batches").json()

    assert len(batches) == 1
    assert batches[0]["filename"] == "Manually added"
    assert batches[0]["row_count"] == 2


def test_manual_transaction_appears_in_the_ledger_and_reports_like_any_other(client):

    account = make_account(client)
    category = make_category(client)
    create_manual(client, account["id"], transaction_date="2026-09-15", debit="50.00", category_id=category["id"])

    ledger = client.get("/api/transactions", params={"page_size": 50}).json()["items"]
    assert any(t["is_manual"] for t in ledger)

    report = client.get("/api/reports/monthly", params={"year": 2026, "month": 9}).json()
    line = next((b for b in report["budgets"] if b["category_id"] == category["id"]), None)
    assert line is None or line["actual"] == "50.00"

    summary = report["summary"]
    assert summary["total_spending"] == "50.00"


# --- update --------------------------------------------------------------------------


def test_update_manual_transaction_recomputes_balance(client):

    account = make_account(client)
    created = create_manual(client, account["id"], transaction_date="2026-09-01", debit="10.00").json()

    response = client.put(f"/api/transactions/{created['id']}", json={
        "transaction_date": "2026-09-01",
        "narration": "Snacks and drinks",
        "debit": "15.00",
    })

    assert response.status_code == 200
    body = response.json()
    assert body["debit"] == "-15.00"
    assert body["balance"] == "-15.00"
    assert body["narration"] == "Snacks and drinks"


def test_update_manual_transaction_can_move_its_date_forward(client):

    account = make_account(client)
    created = create_manual(client, account["id"], transaction_date="2026-09-01", debit="10.00").json()

    response = client.put(f"/api/transactions/{created['id']}", json={
        "transaction_date": "2026-09-10",
        "narration": "Snacks",
        "debit": "10.00",
    })

    assert response.status_code == 200
    assert response.json()["transaction_date"] == "2026-09-10"


def test_update_manual_transaction_rejects_moving_before_another_transaction(client):

    account = make_account(client)
    first = create_manual(client, account["id"], transaction_date="2026-09-01", debit="10.00").json()
    create_manual(client, account["id"], transaction_date="2026-09-05", debit="5.00")

    response = client.put(f"/api/transactions/{first['id']}", json={
        "transaction_date": "2026-09-01",
        "narration": "Snacks",
        "debit": "20.00",
    })

    assert response.status_code == 422
    assert "on or after" in response.json()["detail"]


def test_update_manual_transaction_recomputes_balance_using_other_transactions_balance(client):
    """Editing the LATEST manual row must base its new balance on the OTHER
    transaction's balance, not on its own stale prior value - otherwise a
    changed amount would silently compound onto itself."""

    account = make_account(client)
    create_manual(client, account["id"], transaction_date="2026-09-01", debit="10.00")
    second = create_manual(client, account["id"], transaction_date="2026-09-05", debit="5.00").json()
    assert second["balance"] == "-15.00"

    response = client.put(f"/api/transactions/{second['id']}", json={
        "transaction_date": "2026-09-05",
        "narration": "Snacks",
        "debit": "8.00",
    })

    assert response.json()["balance"] == "-18.00"


def test_update_rejects_an_imported_transaction(client, db_session):

    account = make_account(client)
    imported = seed_imported_transaction(db_session, account["id"], account["account_number"])

    response = client.put(f"/api/transactions/{imported.id}", json={
        "transaction_date": "2026-09-10",
        "narration": "Bank fee (edited)",
        "debit": "5.00",
    })

    assert response.status_code == 422
    assert "manually entered" in response.json()["detail"].lower()


def test_update_manual_transaction_rejects_both_debit_and_credit(client):

    account = make_account(client)
    created = create_manual(client, account["id"], debit="10.00").json()

    response = client.put(f"/api/transactions/{created['id']}", json={
        "transaction_date": "2026-09-01",
        "narration": "Snacks",
        "debit": "5.00",
        "credit": "5.00",
    })

    assert response.status_code == 422


def test_update_manual_transaction_404s_on_an_unknown_id(client):

    response = client.put("/api/transactions/999999", json={
        "transaction_date": "2026-09-01",
        "narration": "x",
        "debit": "1.00",
    })

    assert response.status_code == 404


def test_update_manual_transaction_can_change_category_and_note(client):

    account = make_account(client)
    category = make_category(client)
    created = create_manual(client, account["id"], debit="10.00").json()

    response = client.put(f"/api/transactions/{created['id']}", json={
        "transaction_date": "2026-09-01",
        "narration": "Snacks",
        "debit": "10.00",
        "category_id": category["id"],
        "note": "for the road trip",
    })

    body = response.json()
    assert body["category_id"] == category["id"]
    assert body["note"] == "for the road trip"


# --- delete (already existed, confirm it still works for manual rows) ----------------


def test_delete_manual_transaction(client):

    account = make_account(client)
    created = create_manual(client, account["id"], debit="10.00").json()

    response = client.delete(f"/api/transactions/{created['id']}")

    assert response.status_code == 204
    assert client.get("/api/transactions", params={"page_size": 50}).json()["items"] == []
