from datetime import date
from decimal import Decimal

from app.models import Account, Category, CategoryBudget, CategoryRule, ImportBatch, Transaction, TransactionSplit


def make_account(db_session, name="Joint Everyday", account_number="1111"):

    account = Account(name=name, account_number=account_number)
    db_session.add(account)
    db_session.flush()
    return account


def make_category(client, name="Groceries", kind="expense", budget_amount=None, parent_id=None):

    payload = {"name": name, "kind": kind, "budget_amount": budget_amount, "parent_id": parent_id}
    return client.post("/api/categories", json=payload).json()["id"]


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


# --- combining -------------------------------------------------------------


def test_merge_moves_transactions_and_deletes_the_source(client, db_session):

    account = make_account(db_session)
    fuel = make_category(client, "Fuel")
    petrol = make_category(client, "Petrol")
    transaction = make_transaction(db_session, account.id, debit=Decimal("-60.00"), category_id=petrol)
    db_session.commit()

    response = client.post("/api/categories/merge", json={"source_ids": [petrol], "target_id": fuel})

    assert response.status_code == 200
    body = response.json()
    assert body["target"]["id"] == fuel
    assert body["merged_category_names"] == ["Petrol"]
    assert body["transactions_moved"] == 1

    db_session.expire_all()
    assert db_session.get(Transaction, transaction.id).category_id == fuel
    assert db_session.get(Category, petrol) is None


def test_merge_never_uncategorizes_history(client, db_session):
    """The reason merge exists at all - deleting the loser instead would
    detach its transactions (api/categories._detach_category).
    """

    account = make_account(db_session)
    fuel = make_category(client, "Fuel")
    petrol = make_category(client, "Petrol")
    make_transaction(db_session, account.id, debit=Decimal("-60.00"), category_id=petrol)
    db_session.commit()

    client.post("/api/categories/merge", json={"source_ids": [petrol], "target_id": fuel})

    db_session.expire_all()
    assert db_session.query(Transaction).filter(Transaction.category_id.is_(None)).count() == 0


def test_merge_moves_split_allocations(client, db_session):

    account = make_account(db_session)
    fuel = make_category(client, "Fuel")
    petrol = make_category(client, "Petrol")
    transaction = make_transaction(db_session, account.id, debit=Decimal("-100.00"))
    db_session.add(TransactionSplit(transaction_id=transaction.id, category_id=petrol, amount=Decimal("-40.00")))
    db_session.add(TransactionSplit(transaction_id=transaction.id, category_id=fuel, amount=Decimal("-60.00")))
    db_session.commit()

    response = client.post("/api/categories/merge", json={"source_ids": [petrol], "target_id": fuel})

    assert response.json()["splits_moved"] == 1

    db_session.expire_all()
    amounts = [
        Decimal(split.amount)
        for split in db_session.query(TransactionSplit).filter(TransactionSplit.category_id == fuel)
    ]
    # Two allocations on one transaction, deliberately left as two rows -
    # every reader sums them, and fusing would drop one of the two notes.
    assert sorted(amounts) == [Decimal("-60.00"), Decimal("-40.00")]


def test_merge_repoints_rules(client, db_session):

    fuel = make_category(client, "Fuel")
    petrol = make_category(client, "Petrol")
    client.post("/api/category-rules", json={"narration_pattern": "BP", "category_id": petrol})

    response = client.post("/api/categories/merge", json={"source_ids": [petrol], "target_id": fuel})

    assert response.json()["rules_moved"] == 1
    assert [rule["category_id"] for rule in client.get("/api/category-rules").json()] == [fuel]


def test_merge_sums_standing_budgets(client):

    fuel = make_category(client, "Fuel", budget_amount="100.00")
    petrol = make_category(client, "Petrol", budget_amount="250.00")

    response = client.post("/api/categories/merge", json={"source_ids": [petrol], "target_id": fuel})

    assert Decimal(response.json()["target"]["budget_amount"]) == Decimal("350.00")


def test_merge_sums_monthly_overrides_for_the_same_month(client, db_session):

    fuel = make_category(client, "Fuel", budget_amount="100.00")
    petrol = make_category(client, "Petrol", budget_amount="100.00")
    client.put(f"/api/budgets/{fuel}", json={"year": 2026, "month": 7, "amount": "120.00"})
    client.put(f"/api/budgets/{petrol}", json={"year": 2026, "month": 7, "amount": "80.00"})
    client.put(f"/api/budgets/{petrol}", json={"year": 2026, "month": 8, "amount": "90.00"})

    response = client.post("/api/categories/merge", json={"source_ids": [petrol], "target_id": fuel})

    assert response.json()["budget_overrides_moved"] == 2

    db_session.expire_all()
    overrides = {
        (row.year, row.month): Decimal(row.amount)
        for row in db_session.query(CategoryBudget).filter(CategoryBudget.category_id == fuel)
    }
    assert overrides == {(2026, 7): Decimal("200.00"), (2026, 8): Decimal("90.00")}
    assert db_session.query(CategoryBudget).filter(CategoryBudget.category_id == petrol).count() == 0


def test_merge_leaves_a_target_with_no_budget_alone(client):
    """Summing against a missing budget would invent a real zero budget -
    "everything is over budget" rather than "no budget set".
    """

    fuel = make_category(client, "Fuel")
    petrol = make_category(client, "Petrol")

    response = client.post("/api/categories/merge", json={"source_ids": [petrol], "target_id": fuel})

    assert response.json()["target"]["budget_amount"] is None


def test_merge_rejects_mixed_kinds(client):

    salary = make_category(client, "Salary", kind="income")
    groceries = make_category(client, "Groceries")

    response = client.post("/api/categories/merge", json={"source_ids": [salary], "target_id": groceries})

    assert response.status_code == 422
    assert "income" in response.json()["detail"]


def test_merge_rejects_a_group_as_the_target(client):

    food = make_category(client, "Food")
    make_category(client, "Groceries", parent_id=food)
    fuel = make_category(client, "Fuel")

    response = client.post("/api/categories/merge", json={"source_ids": [fuel], "target_id": food})

    assert response.status_code == 422


def test_merge_rejects_a_group_as_a_source(client):

    food = make_category(client, "Food")
    make_category(client, "Groceries", parent_id=food)
    fuel = make_category(client, "Fuel")

    response = client.post("/api/categories/merge", json={"source_ids": [food], "target_id": fuel})

    assert response.status_code == 422


def test_merge_rejects_merging_a_category_into_itself(client):

    fuel = make_category(client, "Fuel")

    response = client.post("/api/categories/merge", json={"source_ids": [fuel], "target_id": fuel})

    assert response.status_code == 422


def test_merge_404s_on_an_unknown_category(client):

    fuel = make_category(client, "Fuel")

    assert client.post("/api/categories/merge", json={"source_ids": [999], "target_id": fuel}).status_code == 404
    assert client.post("/api/categories/merge", json={"source_ids": [fuel], "target_id": 999}).status_code == 404


def test_merge_can_absorb_an_archived_category(client, db_session):

    account = make_account(db_session)
    fuel = make_category(client, "Fuel")
    petrol = make_category(client, "Petrol")
    make_transaction(db_session, account.id, debit=Decimal("-60.00"), category_id=petrol)
    db_session.commit()
    client.post(f"/api/categories/{petrol}/archive")

    response = client.post("/api/categories/merge", json={"source_ids": [petrol], "target_id": fuel})

    assert response.status_code == 200
    assert response.json()["transactions_moved"] == 1


def test_merge_accepts_several_sources_at_once(client, db_session):

    account = make_account(db_session)
    fuel = make_category(client, "Fuel")
    petrol = make_category(client, "Petrol")
    servo = make_category(client, "Servo")
    make_transaction(db_session, account.id, debit=Decimal("-60.00"), category_id=petrol)
    make_transaction(db_session, account.id, debit=Decimal("-40.00"), category_id=servo)
    db_session.commit()

    response = client.post("/api/categories/merge", json={"source_ids": [petrol, servo], "target_id": fuel})

    assert response.json()["transactions_moved"] == 2
    assert response.json()["merged_category_names"] == ["Petrol", "Servo"]


# --- splitting -------------------------------------------------------------


def test_split_preview_counts_without_moving_anything(client, db_session):

    account = make_account(db_session)
    groceries = make_category(client, "Groceries")
    make_transaction(db_session, account.id, debit=Decimal("-90.00"), category_id=groceries, narration="COLES 123")
    make_transaction(db_session, account.id, debit=Decimal("-30.00"), category_id=groceries, narration="BWS LIQUOR")
    db_session.commit()

    response = client.post("/api/categories/split/preview", json={
        "category_id": groceries,
        "parts": [{"name": "Alcohol", "pattern": "bws"}],
    })

    assert response.status_code == 200
    body = response.json()
    assert body["parts"][0]["transaction_count"] == 1
    assert Decimal(body["parts"][0]["total"]) == Decimal("-30.00")
    assert body["remaining_count"] == 1

    db_session.expire_all()
    assert db_session.query(Category).count() == 1


def test_split_creates_categories_and_moves_matching_transactions(client, db_session):

    account = make_account(db_session)
    groceries = make_category(client, "Groceries")
    coles = make_transaction(db_session, account.id, debit=Decimal("-90.00"), category_id=groceries, narration="COLES")
    bws = make_transaction(db_session, account.id, debit=Decimal("-30.00"), category_id=groceries, narration="BWS LIQUOR")
    db_session.commit()

    response = client.post("/api/categories/split", json={
        "category_id": groceries,
        "parts": [{"name": "Alcohol", "pattern": "bws"}],
    })

    assert response.status_code == 201
    body = response.json()
    assert body["transactions_moved"] == 1
    alcohol_id = body["created"][0]["id"]

    db_session.expire_all()
    assert db_session.get(Transaction, bws.id).category_id == alcohol_id
    assert db_session.get(Transaction, coles.id).category_id == groceries


def test_split_matches_parts_in_order_first_match_wins(client, db_session):

    account = make_account(db_session)
    groceries = make_category(client, "Groceries")
    transaction = make_transaction(
        db_session, account.id, debit=Decimal("-30.00"), category_id=groceries, narration="BWS LIQUOR BARN"
    )
    db_session.commit()

    body = client.post("/api/categories/split", json={
        "category_id": groceries,
        "parts": [
            {"name": "Alcohol", "pattern": "bws"},
            {"name": "Bottle shop", "pattern": "liquor"},
        ],
    }).json()

    db_session.expire_all()
    assert db_session.get(Transaction, transaction.id).category_id == body["created"][0]["id"]


def test_split_moves_split_allocations_too(client, db_session):

    account = make_account(db_session)
    groceries = make_category(client, "Groceries")
    transaction = make_transaction(db_session, account.id, debit=Decimal("-100.00"), narration="BWS LIQUOR")
    db_session.add(TransactionSplit(transaction_id=transaction.id, category_id=groceries, amount=Decimal("-100.00")))
    db_session.commit()

    body = client.post("/api/categories/split", json={
        "category_id": groceries,
        "parts": [{"name": "Alcohol", "pattern": "bws"}],
    }).json()

    assert body["splits_moved"] == 1

    db_session.expire_all()
    split = db_session.query(TransactionSplit).one()
    assert split.category_id == body["created"][0]["id"]


def test_split_parts_inherit_kind_and_parent(client):

    food = make_category(client, "Food")
    groceries = make_category(client, "Groceries", parent_id=food)

    created = client.post("/api/categories/split", json={
        "category_id": groceries,
        "parts": [{"name": "Alcohol", "pattern": "bws"}],
    }).json()["created"][0]

    assert created["kind"] == "expense"
    assert created["parent_id"] == food
    assert created["parent_name"] == "Food"


def test_split_part_can_carry_its_own_budget_and_leaves_the_sources_alone(client):

    groceries = make_category(client, "Groceries", budget_amount="800.00")

    created = client.post("/api/categories/split", json={
        "category_id": groceries,
        "parts": [{"name": "Alcohol", "pattern": "bws", "budget_amount": "120.00"}],
    }).json()["created"][0]

    assert Decimal(created["budget_amount"]) == Decimal("120.00")

    source = next(c for c in client.get("/api/categories").json() if c["id"] == groceries)
    assert Decimal(source["budget_amount"]) == Decimal("800.00")


def test_split_can_create_a_rule_for_future_imports(client):

    groceries = make_category(client, "Groceries")

    body = client.post("/api/categories/split", json={
        "category_id": groceries,
        "parts": [{"name": "Alcohol", "pattern": "bws", "create_rule": True}],
    }).json()

    assert body["rules_created"] == 1
    rules = client.get("/api/category-rules").json()
    assert rules[0]["narration_pattern"] == "bws"
    assert rules[0]["category_id"] == body["created"][0]["id"]


def test_split_rules_never_outrank_an_existing_rule(client, db_session):

    groceries = make_category(client, "Groceries")
    client.post("/api/category-rules", json={"narration_pattern": "COLES", "category_id": groceries})

    client.post("/api/categories/split", json={
        "category_id": groceries,
        "parts": [{"name": "Alcohol", "pattern": "bws", "create_rule": True}],
    })

    priorities = [rule.priority for rule in db_session.query(CategoryRule).order_by(CategoryRule.id).all()]
    assert priorities[1] > priorities[0]


def test_split_rejects_a_duplicate_name(client):

    make_category(client, "Alcohol")
    groceries = make_category(client, "Groceries")

    response = client.post("/api/categories/split", json={
        "category_id": groceries,
        "parts": [{"name": "Alcohol", "pattern": "bws"}],
    })

    assert response.status_code == 409


def test_split_rejects_a_part_with_no_pattern(client):

    groceries = make_category(client, "Groceries")

    response = client.post("/api/categories/split", json={
        "category_id": groceries,
        "parts": [{"name": "Alcohol", "pattern": "   "}],
    })

    assert response.status_code == 422


def test_split_rejects_no_parts(client):

    groceries = make_category(client, "Groceries")

    response = client.post("/api/categories/split", json={"category_id": groceries, "parts": []})

    assert response.status_code == 422


def test_split_rejects_a_group(client):

    food = make_category(client, "Food")
    make_category(client, "Groceries", parent_id=food)

    response = client.post("/api/categories/split", json={
        "category_id": food,
        "parts": [{"name": "Alcohol", "pattern": "bws"}],
    })

    assert response.status_code == 422


def test_split_preview_agrees_with_what_the_split_moves(client, db_session):
    """Preview and apply run the same matcher - the property
    services/categorization.py maintains for rules, kept here too.
    """

    account = make_account(db_session)
    groceries = make_category(client, "Groceries")
    for narration in ("BWS ONE", "bws two", "COLES", "ALDI"):
        make_transaction(db_session, account.id, debit=Decimal("-10.00"), category_id=groceries, narration=narration)
    db_session.commit()

    parts = [{"name": "Alcohol", "pattern": "BWS"}]
    preview = client.post("/api/categories/split/preview", json={"category_id": groceries, "parts": parts}).json()
    applied = client.post("/api/categories/split", json={"category_id": groceries, "parts": parts}).json()

    assert preview["parts"][0]["transaction_count"] == applied["transactions_moved"] == 2
    assert preview["remaining_count"] == 2
