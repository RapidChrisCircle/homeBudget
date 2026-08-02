from datetime import date
from decimal import Decimal

from app.models import Account, Category, ImportBatch, Transaction, TransactionSplit


def make_account(db_session, name="Joint Everyday", account_number="1111"):

    account = Account(name=name, account_number=account_number)
    db_session.add(account)
    db_session.flush()
    return account


def make_category(client, name="Groceries", kind="expense"):

    return client.post("/api/categories", json={"name": name, "kind": kind}).json()["id"]


def make_transaction(db_session, account_id, debit=None, credit=None, category_id=None,
                      narration="Coles", transaction_date=date(2026, 7, 10)):

    batch = ImportBatch(filename="seed.csv", row_count=0, skipped_duplicate_count=0)
    db_session.add(batch)
    db_session.flush()

    transaction = Transaction(
        import_batch_id=batch.id,
        account_id=account_id,
        category_id=category_id,
        bsb_number=None,
        account_number="1111",
        transaction_date=transaction_date,
        narration=narration,
        cheque_number=None,
        debit=debit,
        credit=credit,
        balance="100.00",
        transaction_type="WDL" if debit is not None else "DEP",
    )
    db_session.add(transaction)
    db_session.flush()
    return transaction


def test_splits_must_sum_to_the_transaction_amount(client, db_session):

    account = make_account(db_session)
    transaction = make_transaction(db_session, account.id, debit=Decimal("-150.00"))
    db_session.commit()

    groceries = make_category(client, "Groceries")
    alcohol = make_category(client, "Alcohol")

    response = client.put(
        f"/api/transactions/{transaction.id}/splits",
        json={"splits": [
            {"category_id": groceries, "amount": "-100.00"},
            {"category_id": alcohol, "amount": "-40.00"},
        ]},
    )

    assert response.status_code == 422


def test_splitting_clears_the_parents_category_id(client, db_session):

    account = make_account(db_session)
    groceries_id = make_category(client, "Groceries")
    transaction = make_transaction(db_session, account.id, debit=Decimal("-150.00"), category_id=groceries_id)
    db_session.commit()

    alcohol_id = make_category(client, "Alcohol")

    response = client.put(
        f"/api/transactions/{transaction.id}/splits",
        json={"splits": [
            {"category_id": groceries_id, "amount": "-100.00"},
            {"category_id": alcohol_id, "amount": "-50.00"},
        ]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["category_id"] is None
    assert body["is_split"] is True
    assert len(body["splits"]) == 2
    assert {s["category_id"] for s in body["splits"]} == {groceries_id, alcohol_id}


def test_an_empty_splits_list_unsplits_the_transaction(client, db_session):

    account = make_account(db_session)
    transaction = make_transaction(db_session, account.id, debit=Decimal("-150.00"))
    db_session.commit()
    groceries_id = make_category(client, "Groceries")
    alcohol_id = make_category(client, "Alcohol")

    client.put(
        f"/api/transactions/{transaction.id}/splits",
        json={"splits": [
            {"category_id": groceries_id, "amount": "-100.00"},
            {"category_id": alcohol_id, "amount": "-50.00"},
        ]},
    )

    response = client.put(f"/api/transactions/{transaction.id}/splits", json={"splits": []})

    assert response.status_code == 200
    body = response.json()
    assert body["is_split"] is False
    assert body["splits"] == []
    assert body["category_id"] is None


def test_directly_categorizing_clears_existing_splits(client, db_session):

    account = make_account(db_session)
    transaction = make_transaction(db_session, account.id, debit=Decimal("-150.00"))
    db_session.commit()
    groceries_id = make_category(client, "Groceries")
    alcohol_id = make_category(client, "Alcohol")

    client.put(
        f"/api/transactions/{transaction.id}/splits",
        json={"splits": [
            {"category_id": groceries_id, "amount": "-100.00"},
            {"category_id": alcohol_id, "amount": "-50.00"},
        ]},
    )

    response = client.patch(f"/api/transactions/{transaction.id}/category", json={"category_id": groceries_id})

    assert response.status_code == 200
    body = response.json()
    assert body["category_id"] == groceries_id
    assert body["is_split"] is False
    assert body["splits"] == []


def test_bulk_categorizing_clears_existing_splits(client, db_session):

    account = make_account(db_session)
    transaction = make_transaction(db_session, account.id, debit=Decimal("-150.00"))
    db_session.commit()
    groceries_id = make_category(client, "Groceries")
    alcohol_id = make_category(client, "Alcohol")

    client.put(
        f"/api/transactions/{transaction.id}/splits",
        json={"splits": [
            {"category_id": groceries_id, "amount": "-100.00"},
            {"category_id": alcohol_id, "amount": "-50.00"},
        ]},
    )

    response = client.post(
        "/api/transactions/bulk-category",
        json={"transaction_ids": [transaction.id], "category_id": groceries_id},
    )

    assert response.status_code == 200

    updated = client.get(f"/api/transactions?page_size=10").json()["items"][0]
    assert updated["category_id"] == groceries_id
    assert updated["splits"] == []


def test_splitting_into_a_category_that_has_children_is_rejected(client, db_session):

    account = make_account(db_session)
    transaction = make_transaction(db_session, account.id, debit=Decimal("-150.00"))
    db_session.commit()

    parent_id = make_category(client, "Housing")
    client.post("/api/categories", json={"name": "Rent", "kind": "expense", "parent_id": parent_id})

    response = client.put(
        f"/api/transactions/{transaction.id}/splits",
        json={"splits": [{"category_id": parent_id, "amount": "-150.00"}]},
    )

    assert response.status_code == 422


def test_deleting_a_transaction_cascades_its_splits(client, db_session):

    account = make_account(db_session)
    transaction = make_transaction(db_session, account.id, debit=Decimal("-150.00"))
    db_session.commit()
    groceries_id = make_category(client, "Groceries")

    client.put(
        f"/api/transactions/{transaction.id}/splits",
        json={"splits": [{"category_id": groceries_id, "amount": "-150.00"}]},
    )

    response = client.delete(f"/api/transactions/{transaction.id}")
    assert response.status_code == 204

    remaining_splits = db_session.query(TransactionSplit).filter(
        TransactionSplit.transaction_id == transaction.id
    ).all()
    assert remaining_splits == []


def test_a_rule_never_touches_a_split_transaction(client, db_session):

    account = make_account(db_session)
    transaction = make_transaction(db_session, account.id, debit=Decimal("-150.00"), narration="Coles Supermarket")
    db_session.commit()

    groceries_id = make_category(client, "Groceries")
    alcohol_id = make_category(client, "Alcohol")
    other_id = make_category(client, "Other")

    client.put(
        f"/api/transactions/{transaction.id}/splits",
        json={"splits": [
            {"category_id": groceries_id, "amount": "-100.00"},
            {"category_id": alcohol_id, "amount": "-50.00"},
        ]},
    )

    client.post("/api/category-rules", json={
        "narration_pattern": "coles",
        "transaction_type": None,
        "min_amount": None,
        "max_amount": None,
        "category_id": other_id,
    })

    response = client.post("/api/category-rules/apply")
    assert response.status_code == 200
    assert response.json()["categorized_count"] == 0

    unchanged = client.get(f"/api/transactions?page_size=10").json()["items"][0]
    assert unchanged["is_split"] is True
    assert unchanged["category_id"] is None


def test_ledger_category_filter_finds_a_transaction_via_its_splits(client, db_session):

    account = make_account(db_session)
    transaction = make_transaction(db_session, account.id, debit=Decimal("-150.00"))
    other_transaction = make_transaction(db_session, account.id, debit=Decimal("-20.00"), narration="Unrelated")
    db_session.commit()

    groceries_id = make_category(client, "Groceries")
    alcohol_id = make_category(client, "Alcohol")

    client.put(
        f"/api/transactions/{transaction.id}/splits",
        json={"splits": [
            {"category_id": groceries_id, "amount": "-100.00"},
            {"category_id": alcohol_id, "amount": "-50.00"},
        ]},
    )

    response = client.get(f"/api/transactions?category_id={alcohol_id}&page_size=10")
    ids = [t["id"] for t in response.json()["items"]]

    assert ids == [transaction.id]
    assert other_transaction.id not in ids


def test_uncategorized_filter_excludes_split_transactions(client, db_session):

    account = make_account(db_session)
    split_transaction = make_transaction(db_session, account.id, debit=Decimal("-150.00"))
    truly_uncategorized = make_transaction(db_session, account.id, debit=Decimal("-20.00"), narration="Mystery")
    db_session.commit()

    groceries_id = make_category(client, "Groceries")
    client.put(
        f"/api/transactions/{split_transaction.id}/splits",
        json={"splits": [{"category_id": groceries_id, "amount": "-150.00"}]},
    )

    response = client.get("/api/transactions?uncategorized=true&page_size=10")
    ids = [t["id"] for t in response.json()["items"]]

    assert ids == [truly_uncategorized.id]


def test_reports_attribute_each_split_to_its_own_category(client, db_session):

    account = make_account(db_session)
    transaction = make_transaction(db_session, account.id, debit=Decimal("-150.00"))
    db_session.commit()

    groceries_id = make_category(client, "Groceries")
    alcohol_id = make_category(client, "Alcohol")

    client.put(
        f"/api/transactions/{transaction.id}/splits",
        json={"splits": [
            {"category_id": groceries_id, "amount": "-100.00"},
            {"category_id": alcohol_id, "amount": "-50.00"},
        ]},
    )

    report = client.get("/api/reports/monthly?year=2026&month=7").json()
    budgets = {b["category_id"]: b for b in report["budgets"]}

    assert budgets[groceries_id]["actual"] == "100.00"
    assert budgets[alcohol_id]["actual"] == "50.00"


def test_note_can_be_set_and_cleared(client, db_session):

    account = make_account(db_session)
    transaction = make_transaction(db_session, account.id, debit=Decimal("-20.00"))
    db_session.commit()

    response = client.patch(f"/api/transactions/{transaction.id}/note", json={"note": "Split with Sam"})
    assert response.status_code == 200
    assert response.json()["note"] == "Split with Sam"

    response = client.patch(f"/api/transactions/{transaction.id}/note", json={"note": None})
    assert response.status_code == 200
    assert response.json()["note"] is None
