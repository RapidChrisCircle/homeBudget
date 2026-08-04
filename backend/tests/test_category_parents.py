from datetime import date
from decimal import Decimal

from app.models import Account, ImportBatch, Transaction


def make_account(db_session, name="Joint Everyday", account_number="1111"):

    account = Account(name=name, account_number=account_number)
    db_session.add(account)
    db_session.flush()
    return account


def make_transaction(db_session, account_id, category_id=None, amount=-10.00):

    batch = ImportBatch(filename="seed.csv", row_count=0, skipped_duplicate_count=0)
    db_session.add(batch)
    db_session.flush()

    transaction = Transaction(
        import_batch_id=batch.id,
        account_id=account_id,
        category_id=category_id,
        bsb_number=None,
        account_number="1111",
        transaction_date=date(2026, 7, 1),
        narration="Coles",
        cheque_number=None,
        debit=Decimal(str(amount)),
        credit=None,
        balance="100.00",
        transaction_type="WDL",
    )
    db_session.add(transaction)
    db_session.flush()
    return transaction


def test_child_can_be_created_under_a_parent(client):

    parent_id = client.post("/api/categories", json={"name": "Housing", "kind": "expense"}).json()["id"]

    response = client.post(
        "/api/categories",
        json={"name": "Rent", "kind": "expense", "parent_id": parent_id, "budget_amount": "1500"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["parent_id"] == parent_id
    assert body["parent_name"] == "Housing"
    assert body["budget_amount"] == "1500.00"


def test_creating_a_child_under_a_nonexistent_parent_404s(client):

    response = client.post(
        "/api/categories",
        json={"name": "Rent", "kind": "expense", "parent_id": 999999},
    )

    assert response.status_code == 404


def test_a_two_level_chain_is_rejected(client):

    grandparent_id = client.post("/api/categories", json={"name": "Housing", "kind": "expense"}).json()["id"]
    parent_id = client.post(
        "/api/categories", json={"name": "Rent", "kind": "expense", "parent_id": grandparent_id}
    ).json()["id"]

    response = client.post(
        "/api/categories",
        json={"name": "Rent Increase", "kind": "expense", "parent_id": parent_id},
    )

    assert response.status_code == 422


def test_giving_a_parent_to_a_category_that_already_has_children_is_rejected(client):

    parent_id = client.post("/api/categories", json={"name": "Housing", "kind": "expense"}).json()["id"]
    client.post("/api/categories", json={"name": "Rent", "kind": "expense", "parent_id": parent_id})

    other_id = client.post("/api/categories", json={"name": "Utilities", "kind": "expense"}).json()["id"]

    response = client.put(
        f"/api/categories/{parent_id}",
        json={"name": "Housing", "kind": "expense", "parent_id": other_id},
    )

    assert response.status_code == 422


def test_a_category_cannot_be_its_own_parent(client):

    category_id = client.post("/api/categories", json={"name": "Housing", "kind": "expense"}).json()["id"]

    response = client.put(
        f"/api/categories/{category_id}",
        json={"name": "Housing", "kind": "expense", "parent_id": category_id},
    )

    assert response.status_code == 422


def test_a_parents_budget_amount_is_coerced_to_null(client):

    parent_id = client.post("/api/categories", json={"name": "Housing", "kind": "expense"}).json()["id"]
    client.post("/api/categories", json={"name": "Rent", "kind": "expense", "parent_id": parent_id})

    response = client.put(
        f"/api/categories/{parent_id}",
        json={"name": "Housing", "kind": "expense", "budget_amount": "500"},
    )

    assert response.status_code == 200
    assert response.json()["budget_amount"] is None


def test_assigning_a_transaction_to_a_parent_category_is_rejected(client, db_session):

    account = make_account(db_session)
    transaction = make_transaction(db_session, account.id)
    db_session.commit()

    parent_id = client.post("/api/categories", json={"name": "Housing", "kind": "expense"}).json()["id"]
    client.post("/api/categories", json={"name": "Rent", "kind": "expense", "parent_id": parent_id})

    response = client.patch(
        f"/api/transactions/{transaction.id}/category",
        json={"category_id": parent_id},
    )

    assert response.status_code == 422


def test_bulk_assigning_transactions_to_a_parent_category_is_rejected(client, db_session):

    account = make_account(db_session)
    transaction = make_transaction(db_session, account.id)
    db_session.commit()

    parent_id = client.post("/api/categories", json={"name": "Housing", "kind": "expense"}).json()["id"]
    client.post("/api/categories", json={"name": "Rent", "kind": "expense", "parent_id": parent_id})

    response = client.post(
        "/api/transactions/bulk-category",
        json={"transaction_ids": [transaction.id], "category_id": parent_id},
    )

    assert response.status_code == 422


def test_assigning_a_transaction_to_a_leaf_child_category_succeeds(client, db_session):

    account = make_account(db_session)
    transaction = make_transaction(db_session, account.id)
    db_session.commit()

    parent_id = client.post("/api/categories", json={"name": "Housing", "kind": "expense"}).json()["id"]
    child_id = client.post(
        "/api/categories", json={"name": "Rent", "kind": "expense", "parent_id": parent_id}
    ).json()["id"]

    response = client.patch(
        f"/api/transactions/{transaction.id}/category",
        json={"category_id": child_id},
    )

    assert response.status_code == 200
    assert response.json()["category_id"] == child_id


def test_deleting_a_parent_promotes_its_children_instead_of_deleting_them(client):

    parent_id = client.post("/api/categories", json={"name": "Housing", "kind": "expense"}).json()["id"]
    child_id = client.post(
        "/api/categories", json={"name": "Rent", "kind": "expense", "parent_id": parent_id}
    ).json()["id"]

    response = client.delete(f"/api/categories/{parent_id}")
    assert response.status_code == 204

    child = next(c for c in client.get("/api/categories").json() if c["id"] == child_id)
    assert child["parent_id"] is None


def test_cascade_delete_removes_a_parent_and_its_children(client):

    parent_id = client.post("/api/categories", json={"name": "Housing", "kind": "expense"}).json()["id"]
    child_id = client.post(
        "/api/categories", json={"name": "Rent", "kind": "expense", "parent_id": parent_id}
    ).json()["id"]

    response = client.delete(f"/api/categories/{parent_id}?cascade=true")
    assert response.status_code == 204

    remaining_ids = {c["id"] for c in client.get("/api/categories").json()}
    assert parent_id not in remaining_ids
    assert child_id not in remaining_ids


def test_cascade_delete_untags_transactions_categorized_under_a_child(client, db_session):

    parent_id = client.post("/api/categories", json={"name": "Housing", "kind": "expense"}).json()["id"]
    child_id = client.post(
        "/api/categories", json={"name": "Rent", "kind": "expense", "parent_id": parent_id}
    ).json()["id"]

    account = make_account(db_session)
    transaction = make_transaction(db_session, account.id, category_id=child_id)
    transaction_id = transaction.id

    response = client.delete(f"/api/categories/{parent_id}?cascade=true")
    assert response.status_code == 204

    db_session.expire_all()
    assert db_session.get(Transaction, transaction_id).category_id is None


def test_cascade_defaults_to_false_and_still_promotes(client):
    """cascade is opt-in - an existing caller that never sends the query
    param must keep getting today's promote-children behaviour."""

    parent_id = client.post("/api/categories", json={"name": "Housing", "kind": "expense"}).json()["id"]
    child_id = client.post(
        "/api/categories", json={"name": "Rent", "kind": "expense", "parent_id": parent_id}
    ).json()["id"]

    response = client.delete(f"/api/categories/{parent_id}")
    assert response.status_code == 204

    remaining_ids = {c["id"] for c in client.get("/api/categories").json()}
    assert parent_id not in remaining_ids
    assert child_id in remaining_ids


def test_bulk_delete_removes_every_listed_category(client, db_session):

    grocery_id = client.post("/api/categories", json={"name": "Groceries", "kind": "expense"}).json()["id"]
    fuel_id = client.post("/api/categories", json={"name": "Fuel", "kind": "expense"}).json()["id"]

    account = make_account(db_session)
    transaction = make_transaction(db_session, account.id, category_id=grocery_id)
    transaction_id = transaction.id

    response = client.post("/api/categories/bulk-delete", json={"category_ids": [grocery_id, fuel_id]})

    assert response.status_code == 200
    assert response.json()["deleted_count"] == 2

    remaining_ids = {c["id"] for c in client.get("/api/categories").json()}
    assert grocery_id not in remaining_ids
    assert fuel_id not in remaining_ids

    db_session.expire_all()
    assert db_session.get(Transaction, transaction_id).category_id is None


def test_bulk_delete_skips_ids_that_do_not_exist(client):

    real_id = client.post("/api/categories", json={"name": "Groceries", "kind": "expense"}).json()["id"]

    response = client.post("/api/categories/bulk-delete", json={"category_ids": [real_id, 999999]})

    assert response.status_code == 200
    assert response.json()["deleted_count"] == 1


def test_bulk_delete_promotes_children_not_named_in_the_request(client):
    """A parent included in the bulk request, whose child is NOT included,
    must promote that child exactly like a single non-cascade delete does -
    bulk delete never cascades."""

    parent_id = client.post("/api/categories", json={"name": "Housing", "kind": "expense"}).json()["id"]
    child_id = client.post(
        "/api/categories", json={"name": "Rent", "kind": "expense", "parent_id": parent_id}
    ).json()["id"]

    response = client.post("/api/categories/bulk-delete", json={"category_ids": [parent_id]})
    assert response.status_code == 200
    assert response.json()["deleted_count"] == 1

    child = next(c for c in client.get("/api/categories").json() if c["id"] == child_id)
    assert child["parent_id"] is None
