from test_transactions import HEADER, list_transactions, upload


def make_category(client, name="Groceries", kind="expense", budget_amount=None):

    return client.post(
        "/api/categories",
        json={"name": name, "kind": kind, "budget_amount": budget_amount},
    ).json()["id"]


def usage_for(client, category_id):

    rows = client.get("/api/categories/usage").json()
    return next(r for r in rows if r["category_id"] == category_id)


def test_never_used_category_reports_zero(client):

    category_id = make_category(client)

    row = usage_for(client, category_id)
    assert row["transaction_count"] == 0
    assert row["rule_count"] == 0


def test_directly_categorized_transaction_counts_as_used(client):

    category_id = make_category(client)
    upload(client, HEADER + ',1111,24/07/2026,"Coffee",,-5.00,,100.00,WDL\n')
    transaction_id = list_transactions(client)[0]["id"]
    client.patch(f"/api/transactions/{transaction_id}/category", json={"category_id": category_id})

    row = usage_for(client, category_id)
    assert row["transaction_count"] == 1


def test_category_used_only_via_a_split_still_counts_as_used(client):
    """The case a naive count(Transaction.category_id) would get wrong - a
    split transaction has NO category_id of its own at all (see
    TransactionSplit's docstring in models.py), so this must read through
    services/allocations.py the same way reporting.py itself does.
    """

    groceries_id = make_category(client, name="Groceries")
    alcohol_id = make_category(client, name="Alcohol")
    upload(client, HEADER + ',1111,24/07/2026,"Coles",,-50.00,,100.00,WDL\n')
    transaction_id = list_transactions(client)[0]["id"]

    client.put(
        f"/api/transactions/{transaction_id}/splits",
        json={"splits": [
            {"category_id": groceries_id, "amount": "-30.00", "note": None},
            {"category_id": alcohol_id, "amount": "-20.00", "note": None},
        ]},
    )

    assert usage_for(client, groceries_id)["transaction_count"] == 1
    assert usage_for(client, alcohol_id)["transaction_count"] == 1


def test_category_used_only_by_a_rule_is_not_reported_as_unused(client):

    category_id = make_category(client)
    client.post(
        "/api/category-rules",
        json={"narration_pattern": "coffee", "category_id": category_id},
    )

    row = usage_for(client, category_id)
    assert row["transaction_count"] == 0
    assert row["rule_count"] == 1


def test_budgeted_but_never_used_category_is_reported_unused_with_its_budget(client):
    """This is exactly the case the Unused card exists for - a preset's
    budgeted category nobody has ever categorized a transaction into.
    Excluding budgeted categories from "unused" would empty that card of
    the rows it's actually meant to surface.
    """

    category_id = make_category(client, budget_amount="800.00")

    row = usage_for(client, category_id)
    assert row["transaction_count"] == 0
    assert row["budget_amount"] == "800.00"


def test_usage_names_a_child_categorys_parent(client):
    """The Unused card lists leaf categories, which is exactly where a bare
    name is least distinguishable - two preset groups each own an
    "Insurance".
    """

    parent_id = make_category(client, name="Food")
    child_id = client.post(
        "/api/categories",
        json={"name": "Groceries", "kind": "expense", "parent_id": parent_id},
    ).json()["id"]

    assert usage_for(client, child_id)["parent_name"] == "Food"
    assert usage_for(client, parent_id)["parent_name"] is None
