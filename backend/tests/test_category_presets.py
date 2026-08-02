from app.services.category_presets import QLD_HOUSEHOLD_PRESET


def total_preset_category_count():
    return sum(1 + len(group["children"]) for group in QLD_HOUSEHOLD_PRESET)


def test_fresh_database_gets_the_full_preset(client):

    response = client.post("/api/categories/preset")

    assert response.status_code == 200
    body = response.json()
    assert body["skipped"] == []
    assert len(body["created"]) == total_preset_category_count()

    categories = client.get("/api/categories").json()
    assert len(categories) == total_preset_category_count()

    housing = next(c for c in categories if c["name"] == "Housing")
    assert housing["parent_id"] is None
    assert housing["kind"] == "expense"
    assert housing["budget_amount"] is None  # a parent groups, it doesn't budget

    rent = next(c for c in categories if c["name"] == "Mortgage/Rent")
    assert rent["parent_id"] == housing["id"]
    assert rent["budget_amount"] == "3000.00"

    salary = next(c for c in categories if c["name"] == "Salary")
    income_parent = next(c for c in categories if c["id"] == salary["parent_id"])
    assert income_parent["name"] == "Income"
    assert income_parent["kind"] == "income"
    assert salary["kind"] == "income"
    assert salary["budget_amount"] is None


def test_running_it_twice_creates_nothing_the_second_time(client):

    client.post("/api/categories/preset")
    response = client.post("/api/categories/preset")

    assert response.status_code == 200
    body = response.json()
    assert body["created"] == []
    assert len(body["skipped"]) == total_preset_category_count()

    categories = client.get("/api/categories").json()
    assert len(categories) == total_preset_category_count()


def test_an_existing_same_named_category_is_skipped_not_duplicated_or_overwritten(client):

    existing = client.post(
        "/api/categories", json={"name": "Groceries", "kind": "expense", "budget_amount": "999"}
    ).json()

    response = client.post("/api/categories/preset")

    assert response.status_code == 200
    assert "Groceries" in response.json()["skipped"]
    assert "Groceries" not in response.json()["created"]

    categories = client.get("/api/categories").json()
    groceries_matches = [c for c in categories if c["name"] == "Groceries"]

    # Not duplicated...
    assert len(groceries_matches) == 1
    # ...and not overwritten - the user's own budget and (lack of) parent survive.
    assert groceries_matches[0]["id"] == existing["id"]
    assert groceries_matches[0]["budget_amount"] == "999.00"
    assert groceries_matches[0]["parent_id"] is None


def test_matching_is_case_insensitive(client):

    client.post("/api/categories", json={"name": "housing", "kind": "expense"})

    response = client.post("/api/categories/preset")

    assert "Housing" in response.json()["skipped"]
    # Its children still get created under the existing (lowercase-named) parent.
    assert "Mortgage/Rent" in response.json()["created"]

    categories = client.get("/api/categories").json()
    assert len([c for c in categories if c["name"].lower() == "housing"]) == 1
