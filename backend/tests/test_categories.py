from datetime import date

from app.models import Category, CategoryRule, ImportBatch, Transaction


def test_create_category(client):

    response = client.post("/api/categories", json={"name": "Groceries"})

    assert response.status_code == 201
    assert response.json()["name"] == "Groceries"


def test_create_category_duplicate_name_rejected(client):

    client.post("/api/categories", json={"name": "Groceries"})
    response = client.post("/api/categories", json={"name": "Groceries"})

    assert response.status_code == 409


def test_list_categories_sorted_by_name(client):

    client.post("/api/categories", json={"name": "Zeta"})
    client.post("/api/categories", json={"name": "Alpha"})

    names = [c["name"] for c in client.get("/api/categories").json()]
    assert names == ["Alpha", "Zeta"]


def test_update_category(client):

    category_id = client.post("/api/categories", json={"name": "Groceries"}).json()["id"]

    response = client.put(f"/api/categories/{category_id}", json={"name": "Food"})

    assert response.status_code == 200
    assert response.json()["name"] == "Food"


def test_update_category_404_when_missing(client):

    response = client.put("/api/categories/999", json={"name": "Food"})

    assert response.status_code == 404


def test_create_category_defaults_to_expense_kind(client):

    response = client.post("/api/categories", json={"name": "Groceries"})

    assert response.json()["kind"] == "expense"
    assert response.json()["budget_amount"] is None


def test_create_category_with_kind_and_budget(client):

    response = client.post(
        "/api/categories",
        json={"name": "Groceries", "kind": "expense", "budget_amount": "800.00"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["kind"] == "expense"
    assert body["budget_amount"] == "800.00"


def test_create_category_rejects_unknown_kind(client):

    response = client.post("/api/categories", json={"name": "Groceries", "kind": "bogus"})

    assert response.status_code == 422


def test_create_category_rejects_negative_budget(client):

    response = client.post(
        "/api/categories",
        json={"name": "Groceries", "kind": "expense", "budget_amount": "-5.00"},
    )

    assert response.status_code == 422


def test_budget_amount_cleared_for_non_expense_kind(client):

    response = client.post(
        "/api/categories",
        json={"name": "Salary", "kind": "income", "budget_amount": "500.00"},
    )

    assert response.status_code == 201
    assert response.json()["budget_amount"] is None


def test_update_category_changes_kind_and_budget(client):

    category_id = client.post("/api/categories", json={"name": "Groceries"}).json()["id"]

    response = client.put(
        f"/api/categories/{category_id}",
        json={"name": "Groceries", "kind": "expense", "budget_amount": "900.00"},
    )

    assert response.status_code == 200
    assert response.json()["budget_amount"] == "900.00"


def test_delete_category_404_when_missing(client):

    response = client.delete("/api/categories/999")

    assert response.status_code == 404


def test_delete_category_untags_linked_transactions(client, db_session):

    category = Category(name="Groceries")
    db_session.add(category)
    db_session.flush()

    batch = ImportBatch(filename="seed.csv", row_count=1, skipped_duplicate_count=0)
    db_session.add(batch)
    db_session.flush()

    transaction = Transaction(
        import_batch_id=batch.id,
        category_id=category.id,
        bsb_number=None,
        account_number="1111",
        transaction_date=date(2026, 7, 24),
        narration="Coffee",
        cheque_number=None,
        debit="-5.00",
        credit=None,
        balance="100.00",
        transaction_type="WDL",
    )
    db_session.add(transaction)
    db_session.commit()
    transaction_id = transaction.id

    response = client.delete(f"/api/categories/{category.id}")

    assert response.status_code == 204

    db_session.expire_all()
    assert db_session.get(Transaction, transaction_id).category_id is None


def test_delete_category_removes_its_rules_and_clears_markers(client, db_session):

    category = Category(name="Groceries")
    db_session.add(category)
    db_session.flush()

    rule = CategoryRule(narration_pattern="coffee", category_id=category.id, priority=0)
    db_session.add(rule)
    db_session.flush()

    batch = ImportBatch(filename="seed.csv", row_count=1, skipped_duplicate_count=0)
    db_session.add(batch)
    db_session.flush()

    transaction = Transaction(
        import_batch_id=batch.id,
        category_id=category.id,
        categorized_by_rule_id=rule.id,
        bsb_number=None,
        account_number="1111",
        transaction_date=date(2026, 7, 24),
        narration="Coffee",
        cheque_number=None,
        debit="-5.00",
        credit=None,
        balance="100.00",
        transaction_type="WDL",
    )
    db_session.add(transaction)
    db_session.commit()
    transaction_id = transaction.id

    response = client.delete(f"/api/categories/{category.id}")

    assert response.status_code == 204
    assert db_session.query(CategoryRule).count() == 0

    db_session.expire_all()
    updated = db_session.get(Transaction, transaction_id)
    assert updated.category_id is None
    assert updated.categorized_by_rule_id is None
