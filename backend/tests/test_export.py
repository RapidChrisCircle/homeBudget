import csv
import io
import json
from datetime import date
from decimal import Decimal

from app.models import Account, CategoryBudget, CategoryRule, ImportBatch, Transaction, TransactionSplit


def make_account(client, name="Cash", account_number="CASH"):

    return client.post("/api/accounts", json={"name": name, "account_number": account_number}).json()


def make_category(client, name="Groceries", kind="expense"):

    return client.post("/api/categories", json={"name": name, "kind": kind}).json()


def create_manual(client, account_id, transaction_date="2026-09-01", narration="Snacks",
                   debit=None, credit=None, category_id=None, note=None):

    payload = {
        "account_id": account_id, "transaction_date": transaction_date, "narration": narration,
        "debit": debit, "credit": credit, "category_id": category_id, "note": note,
    }
    return client.post("/api/transactions", json=payload).json()


def parse_csv(text):

    return list(csv.DictReader(io.StringIO(text)))


# --- filtered CSV export ----------------------------------------------------------


def test_export_csv_has_the_expected_columns_and_content_type(client):

    account = make_account(client)
    create_manual(client, account["id"], debit="12.50", note="for the trip")

    response = client.get("/api/transactions/export")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert response.headers["content-disposition"] == 'attachment; filename="transactions.csv"'

    rows = parse_csv(response.text)
    assert list(rows[0].keys()) == ["Date", "Account", "Narration", "Category", "Debit", "Credit", "Balance", "Type", "Note"]
    assert rows[0]["Note"] == "for the trip"
    assert rows[0]["Debit"] == "-12.50"


def test_export_csv_contains_exactly_the_rows_the_ledger_shows_for_the_same_filter(client):

    account = make_account(client)
    groceries = make_category(client, "Groceries")
    fuel = make_category(client, "Fuel")
    create_manual(client, account["id"], transaction_date="2026-09-01", debit="30.00", category_id=groceries["id"])
    create_manual(client, account["id"], transaction_date="2026-09-02", debit="40.00", category_id=fuel["id"])

    ledger = client.get("/api/transactions", params={"category_id": groceries["id"]}).json()
    export_rows = parse_csv(client.get("/api/transactions/export", params={"category_id": groceries["id"]}).text)

    assert len(export_rows) == ledger["total"] == 1
    assert export_rows[0]["Narration"] == ledger["items"][0]["narration"]


def test_export_csv_is_not_paginated_even_with_many_rows(client):

    account = make_account(client)
    for i in range(15):
        create_manual(client, account["id"], transaction_date=f"2026-09-{i + 1:02d}", narration=f"Row {i}", debit="1.00")

    rows = parse_csv(client.get("/api/transactions/export").text)

    assert len(rows) == 15


def test_export_csv_flattens_a_split_transactions_categories_into_one_cell(client, db_session):

    account = make_account(client)
    groceries = make_category(client, "Groceries")
    alcohol = make_category(client, "Alcohol")
    transaction = create_manual(client, account["id"], debit="50.00")
    client.put(f"/api/transactions/{transaction['id']}/splits", json={"splits": [
        {"category_id": groceries["id"], "amount": "-30.00"},
        {"category_id": alcohol["id"], "amount": "-20.00"},
    ]})

    rows = parse_csv(client.get("/api/transactions/export").text)

    assert rows[0]["Category"] == "Groceries: -30.00; Alcohol: -20.00"


def test_export_csv_uncategorized_transaction_reads_uncategorized(client):

    account = make_account(client)
    create_manual(client, account["id"], debit="10.00")

    rows = parse_csv(client.get("/api/transactions/export").text)

    assert rows[0]["Category"] == "Uncategorized"


def test_export_csv_rejects_contradictory_filters_the_same_as_the_ledger(client):
    """Proof the two endpoints share validation - see
    api/transactions._validated_ledger_query."""

    response = client.get("/api/transactions/export", params={"uncategorized": "true", "category_id": 1})

    assert response.status_code == 422
    assert "contradictory" in response.json()["detail"]


def test_export_csv_on_an_empty_ledger_has_only_the_header(client):

    rows = parse_csv(client.get("/api/transactions/export").text)

    assert rows == []


# --- whole-database JSON export ---------------------------------------------------


def test_export_database_has_the_expected_content_type_and_filename(client):

    response = client.get("/api/export/database")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.headers["content-disposition"].startswith('attachment; filename="homebudget-backup-')


def test_export_database_includes_every_table(client):

    response = client.get("/api/export/database")
    body = json.loads(response.text)

    assert set(body.keys()) == {
        "account_groups", "accounts", "categories", "category_rules", "category_budgets",
        "import_batches", "transactions", "csv_format_mappings", "savings_goals",
        "dashboard_widgets", "recurring_dismissals", "pay_schedule",
    }


def test_export_database_account_matches_the_accounts_endpoint(client, db_session):

    account = make_account(client)
    create_manual(client, account["id"], debit="10.00")

    live = client.get(f"/api/accounts/{account['id']}").json()
    body = json.loads(client.get("/api/export/database").text)

    assert body["accounts"][0] == live


def test_export_database_transaction_matches_the_ledger_endpoint(client):

    account = make_account(client)
    category = make_category(client)
    create_manual(client, account["id"], debit="10.00", category_id=category["id"], note="a note")

    live = client.get("/api/transactions", params={"page_size": 50}).json()["items"][0]
    body = json.loads(client.get("/api/export/database").text)

    assert body["transactions"][0] == live


def test_export_database_goal_matches_the_goals_endpoint(client):

    account = make_account(client)
    client.post("/api/goals", json={
        "name": "Holiday", "target_amount": "1000.00", "mode": "envelope",
        "account_id": account["id"], "allocated_amount": "200.00",
    })

    live = client.get("/api/goals").json()["goals"][0]
    body = json.loads(client.get("/api/export/database").text)

    assert body["savings_goals"][0] == live


def test_export_database_includes_categories_rules_and_budgets(client, db_session):

    category = make_category(client)
    client.put(f"/api/categories/{category['id']}", json={"name": "Groceries", "kind": "expense", "budget_amount": "800.00"})
    client.post("/api/category-rules", json={"narration_pattern": "coles", "category_id": category["id"]})
    db_session.add(CategoryBudget(category_id=category["id"], year=2026, month=9, amount=Decimal("750.00")))
    db_session.commit()

    body = json.loads(client.get("/api/export/database").text)

    assert body["categories"][0]["name"] == "Groceries"
    assert body["category_rules"][0]["narration_pattern"] == "coles"
    assert body["category_budgets"] == [{"category_id": category["id"], "year": 2026, "month": 9, "amount": "750.00"}]


def test_export_database_includes_archived_categories(client):
    """A partial backup is a false sense of security - archived rows must
    not be silently dropped."""

    category = make_category(client)
    client.post(f"/api/categories/{category['id']}/archive")

    body = json.loads(client.get("/api/export/database").text)

    assert any(c["id"] == category["id"] and c["archived"] for c in body["categories"])


def test_export_database_includes_import_batches(client):

    account = make_account(client)
    create_manual(client, account["id"], debit="5.00")

    body = json.loads(client.get("/api/export/database").text)

    assert len(body["import_batches"]) == 1
    assert body["import_batches"][0]["filename"] == "Manually added"


def test_export_database_on_an_empty_database_has_empty_lists(client):

    body = json.loads(client.get("/api/export/database").text)

    assert body == {
        "account_groups": [], "accounts": [], "categories": [], "category_rules": [],
        "category_budgets": [], "import_batches": [], "transactions": [], "csv_format_mappings": [],
        "savings_goals": [], "dashboard_widgets": [], "recurring_dismissals": [], "pay_schedule": None,
    }


def test_export_database_includes_the_pay_schedule_when_configured(client):

    client.put("/api/pay-schedule", json={"anchor_date": "2026-01-02"})

    body = json.loads(client.get("/api/export/database").text)

    assert body["pay_schedule"] == {"anchor_date": "2026-01-02"}
