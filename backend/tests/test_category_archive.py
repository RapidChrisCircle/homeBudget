from test_transactions import HEADER, list_transactions, upload


def make_category(client, name="Groceries", kind="expense", budget_amount=None, parent_id=None):

    return client.post(
        "/api/categories",
        json={"name": name, "kind": kind, "budget_amount": budget_amount, "parent_id": parent_id},
    ).json()["id"]


def test_archived_category_excluded_from_default_list(client):

    category_id = make_category(client)
    client.post(f"/api/categories/{category_id}/archive")

    names = [c["name"] for c in client.get("/api/categories").json()]
    assert "Groceries" not in names


def test_archived_category_present_with_include_archived(client):

    category_id = make_category(client)
    client.post(f"/api/categories/{category_id}/archive")

    ids = [c["id"] for c in client.get("/api/categories?include_archived=true").json()]
    assert category_id in ids


def test_archiving_a_parent_cascades_to_children_and_restoring_reverses_it(client):

    parent_id = make_category(client, name="Housing")
    child_id = make_category(client, name="Rent", parent_id=parent_id)

    archive_response = client.post(f"/api/categories/{parent_id}/archive")
    assert archive_response.status_code == 200

    ids = [c["id"] for c in client.get("/api/categories").json()]
    assert parent_id not in ids
    assert child_id not in ids

    restore_response = client.post(f"/api/categories/{parent_id}/restore")
    assert restore_response.status_code == 200

    ids_after_restore = [c["id"] for c in client.get("/api/categories").json()]
    assert parent_id in ids_after_restore
    assert child_id in ids_after_restore


def test_archiving_a_lone_child_does_not_touch_its_siblings_or_parent(client):

    parent_id = make_category(client, name="Housing")
    rent_id = make_category(client, name="Rent", parent_id=parent_id)
    rates_id = make_category(client, name="Council Rates", parent_id=parent_id)

    client.post(f"/api/categories/{rent_id}/archive")

    ids = [c["id"] for c in client.get("/api/categories").json()]
    assert rent_id not in ids
    assert parent_id in ids
    assert rates_id in ids


def test_archive_404_when_missing(client):

    assert client.post("/api/categories/999999/archive").status_code == 404


def test_restore_404_when_missing(client):

    assert client.post("/api/categories/999999/restore").status_code == 404


def test_archived_category_keeps_its_name_on_existing_transactions(client):

    category_id = make_category(client)
    upload(client, HEADER + ',1111,24/07/2026,"Coffee",,-5.00,,100.00,WDL\n')
    transaction_id = list_transactions(client)[0]["id"]
    client.patch(f"/api/transactions/{transaction_id}/category", json={"category_id": category_id})

    client.post(f"/api/categories/{category_id}/archive")

    transaction = next(t for t in list_transactions(client) if t["id"] == transaction_id)
    assert transaction["category_name"] == "Groceries"
    assert transaction["category_id"] == category_id


def test_archived_categories_excluded_from_monthly_budgets_editor(client):

    category_id = make_category(client, budget_amount="100.00")
    client.post(f"/api/categories/{category_id}/archive")

    response = client.get("/api/budgets?year=2026&month=7")

    ids = [c["category_id"] for c in response.json()["categories"]]
    assert category_id not in ids


def test_archiving_a_category_with_activity_this_month_does_not_change_total_spending(client):
    """The sharpest risk this feature carries: it would be one line to add
    Category.archived == False to reporting's own SQL filter, and it would
    look correct in every manual check that doesn't happen to involve an
    archived category with real activity. This is that check - archiving
    a category that has money moved through it this month must not change
    total_spending, and the category must still be listed.
    """

    category_id = make_category(client, budget_amount="100.00")
    upload(client, HEADER + ',1111,24/07/2026,"Coffee",,-5.00,,100.00,WDL\n')
    transaction_id = list_transactions(client)[0]["id"]
    client.patch(f"/api/transactions/{transaction_id}/category", json={"category_id": category_id})

    before = client.get("/api/reports/monthly?year=2026&month=7").json()

    client.post(f"/api/categories/{category_id}/archive")

    after = client.get("/api/reports/monthly?year=2026&month=7").json()

    assert after["summary"]["total_spending"] == before["summary"]["total_spending"]

    budget_row = next(b for b in after["budgets"] if b["category_id"] == category_id)
    assert budget_row["archived"] is True
    assert budget_row["actual"] == "5.00"


def test_archiving_a_budgeted_but_never_used_category_drops_it_from_the_report(client):
    """The intended case: an archived category with ZERO activity this
    month is dropped from the budget-vs-actual table even though it still
    carries a standing budget - this is what the Unused/Archive workflow
    is actually for (a preset's budgeted-but-never-touched categories).
    """

    category_id = make_category(client, budget_amount="100.00")
    # Some other category has activity, so the month itself is non-empty.
    other_id = make_category(client, name="Fuel", budget_amount="50.00")
    upload(client, HEADER + ',1111,24/07/2026,"Fuel stop",,-20.00,,100.00,WDL\n')
    transaction_id = list_transactions(client)[0]["id"]
    client.patch(f"/api/transactions/{transaction_id}/category", json={"category_id": other_id})

    client.post(f"/api/categories/{category_id}/archive")

    after = client.get("/api/reports/monthly?year=2026&month=7").json()

    budget_ids = [b["category_id"] for b in after["budgets"]]
    assert category_id not in budget_ids
    assert other_id in budget_ids
