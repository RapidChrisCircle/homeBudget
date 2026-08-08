from datetime import date
from decimal import Decimal

from app.models import Category, CategoryBudget, ImportBatch, Transaction


def make_category(db_session, name="Groceries", kind="expense", budget_amount=None):

    category = Category(name=name, kind=kind, budget_amount=budget_amount)
    db_session.add(category)
    db_session.flush()
    return category


def make_transaction(db_session, transaction_date, debit, category_id, account_number="1111"):

    batch = ImportBatch(filename="seed.csv", row_count=0, skipped_duplicate_count=0)
    db_session.add(batch)
    db_session.flush()

    db_session.add(Transaction(
        import_batch_id=batch.id,
        category_id=category_id,
        account_number=account_number,
        transaction_date=transaction_date,
        narration="Coffee",
        debit=debit,
        balance="100.00",
        transaction_type="WDL",
    ))
    db_session.flush()


# --- GET /budgets ----------------------------------------------------------------

def test_get_budgets_shape(client, db_session):

    category = make_category(db_session, budget_amount="100.00")
    make_transaction(db_session, date(2026, 7, 10), "-60.00", category.id)
    db_session.commit()

    response = client.get("/api/budgets?year=2026&month=7")

    assert response.status_code == 200
    body = response.json()
    assert body["year"] == 2026
    assert body["month"] == 7
    row = next(c for c in body["categories"] if c["category_id"] == category.id)
    assert row["standing_amount"] == "100.00"
    assert row["override_amount"] is None
    assert row["effective_amount"] == "100.00"
    assert row["is_overridden"] is False
    assert row["actual"] == "60.00"
    assert row["difference"] == "40.00"
    assert body["totals"]["budgeted"] == "100.00"
    assert body["totals"]["actual"] == "60.00"


def test_get_budgets_marks_an_overridden_category(client, db_session):

    category = make_category(db_session, budget_amount="100.00")
    db_session.add(CategoryBudget(category_id=category.id, year=2026, month=7, amount="250.00"))
    db_session.commit()

    body = client.get("/api/budgets?year=2026&month=7").json()
    row = next(c for c in body["categories"] if c["category_id"] == category.id)

    assert row["standing_amount"] == "100.00"
    assert row["override_amount"] == "250.00"
    assert row["effective_amount"] == "250.00"
    assert row["is_overridden"] is True


def test_get_budgets_includes_unbudgeted_expense_categories(client, db_session):

    make_category(db_session, name="Entertainment", budget_amount=None)
    db_session.commit()

    body = client.get("/api/budgets?year=2026&month=7").json()

    assert any(c["category_name"] == "Entertainment" and c["effective_amount"] is None for c in body["categories"])


def test_get_budgets_excludes_income_and_transfer_categories(client, db_session):

    make_category(db_session, name="Salary", kind="income")
    make_category(db_session, name="Transfers", kind="transfer")
    db_session.commit()

    body = client.get("/api/budgets?year=2026&month=7").json()

    assert body["categories"] == []


def test_get_budgets_totals_scoped_to_budgeted_categories_only(client, db_session):
    # Matches trends.budget_totals()'s scoping exactly - an unbudgeted
    # category's spending must not count toward the totals row.
    budgeted = make_category(db_session, name="Groceries", budget_amount="100.00")
    unbudgeted = make_category(db_session, name="Entertainment", budget_amount=None)
    make_transaction(db_session, date(2026, 7, 10), "-60.00", budgeted.id)
    make_transaction(db_session, date(2026, 7, 12), "-999.00", unbudgeted.id)
    db_session.commit()

    body = client.get("/api/budgets?year=2026&month=7").json()

    assert body["totals"]["budgeted"] == "100.00"
    assert body["totals"]["actual"] == "60.00"


def test_get_budgets_defaults_to_the_ledgers_default_period(client, db_session):

    make_category(db_session)
    db_session.commit()

    response = client.get("/api/budgets")

    assert response.status_code == 200


def test_get_budgets_rejects_year_without_month(client):

    response = client.get("/api/budgets?year=2026")

    assert response.status_code == 422


# --- PUT /budgets/{category_id} ---------------------------------------------------

def test_put_creates_an_override(client, db_session):

    category = make_category(db_session, budget_amount="100.00")
    db_session.commit()

    response = client.put(
        f"/api/budgets/{category.id}", json={"year": 2026, "month": 7, "amount": "250.00"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["override_amount"] == "250.00"
    assert body["effective_amount"] == "250.00"
    assert body["is_overridden"] is True

    assert db_session.query(CategoryBudget).filter(
        CategoryBudget.category_id == category.id, CategoryBudget.year == 2026, CategoryBudget.month == 7
    ).one().amount == Decimal("250.00")


def test_put_upserts_an_existing_override_in_place(client, db_session):

    category = make_category(db_session, budget_amount="100.00")
    db_session.add(CategoryBudget(category_id=category.id, year=2026, month=7, amount="200.00"))
    db_session.commit()

    client.put(f"/api/budgets/{category.id}", json={"year": 2026, "month": 7, "amount": "300.00"})

    rows = db_session.query(CategoryBudget).filter(
        CategoryBudget.category_id == category.id, CategoryBudget.year == 2026, CategoryBudget.month == 7
    ).all()
    assert len(rows) == 1
    assert rows[0].amount == Decimal("300.00")


def test_put_accepts_a_zero_override(client, db_session):

    category = make_category(db_session, budget_amount="100.00")
    db_session.commit()

    response = client.put(f"/api/budgets/{category.id}", json={"year": 2026, "month": 7, "amount": "0.00"})

    assert response.status_code == 200
    assert response.json()["effective_amount"] == "0.00"


def test_put_404s_for_unknown_category(client):

    response = client.put("/api/budgets/999999", json={"year": 2026, "month": 7, "amount": "100.00"})

    assert response.status_code == 404


def test_put_422s_for_a_negative_amount(client, db_session):

    category = make_category(db_session)
    db_session.commit()

    response = client.put(f"/api/budgets/{category.id}", json={"year": 2026, "month": 7, "amount": "-5.00"})

    assert response.status_code == 422


def test_put_422s_for_a_non_expense_category(client, db_session):

    category = make_category(db_session, name="Salary", kind="income")
    db_session.commit()

    response = client.put(f"/api/budgets/{category.id}", json={"year": 2026, "month": 7, "amount": "100.00"})

    assert response.status_code == 422


# --- DELETE /budgets/{category_id} ------------------------------------------------

def test_delete_reverts_to_the_standing_amount(client, db_session):

    category = make_category(db_session, budget_amount="100.00")
    db_session.add(CategoryBudget(category_id=category.id, year=2026, month=7, amount="250.00"))
    db_session.commit()

    response = client.delete(f"/api/budgets/{category.id}?year=2026&month=7")

    assert response.status_code == 204
    body = client.get("/api/budgets?year=2026&month=7").json()
    row = next(c for c in body["categories"] if c["category_id"] == category.id)
    assert row["effective_amount"] == "100.00"
    assert row["is_overridden"] is False


def test_delete_is_idempotent_when_there_is_no_override(client, db_session):

    category = make_category(db_session, budget_amount="100.00")
    db_session.commit()

    response = client.delete(f"/api/budgets/{category.id}?year=2026&month=7")

    assert response.status_code == 204


def test_delete_404s_for_unknown_category(client):

    response = client.delete("/api/budgets/999999?year=2026&month=7")

    assert response.status_code == 404


# --- POST /budgets/copy ------------------------------------------------------------

def test_copy_endpoint_returns_the_number_copied(client, db_session):

    make_category(db_session, budget_amount="100.00")
    db_session.commit()

    response = client.post(
        "/api/budgets/copy", json={"from_year": 2026, "from_month": 7, "to_year": 2026, "to_month": 8}
    )

    assert response.status_code == 200
    assert response.json()["copied_count"] == 1


def test_copy_endpoint_written_overrides_are_visible_via_get(client, db_session):

    category = make_category(db_session, budget_amount="100.00")
    db_session.add(CategoryBudget(category_id=category.id, year=2026, month=7, amount="150.00"))
    db_session.commit()

    client.post("/api/budgets/copy", json={"from_year": 2026, "from_month": 7, "to_year": 2026, "to_month": 8})

    body = client.get("/api/budgets?year=2026&month=8").json()
    row = next(c for c in body["categories"] if c["category_id"] == category.id)
    assert row["effective_amount"] == "150.00"
    assert row["is_overridden"] is True


# --- hierarchy -------------------------------------------------------------------

def test_get_budgets_names_a_child_categorys_parent(client, db_session):
    """The Monthly Budgets card renders "Food > Groceries" - a bare leaf
    name is ambiguous the moment two groups both own an "Insurance".
    """

    parent = make_category(db_session, name="Food")
    child = make_category(db_session, name="Groceries", budget_amount="800.00")
    child.parent_id = parent.id
    db_session.commit()

    body = client.get("/api/budgets?year=2026&month=7").json()
    row = next(c for c in body["categories"] if c["category_id"] == child.id)

    assert row["parent_id"] == parent.id
    assert row["parent_name"] == "Food"


def test_get_budgets_leaves_a_top_level_categorys_parent_null(client, db_session):

    category = make_category(db_session, budget_amount="100.00")
    db_session.commit()

    body = client.get("/api/budgets?year=2026&month=7").json()
    row = next(c for c in body["categories"] if c["category_id"] == category.id)

    assert row["parent_id"] is None
    assert row["parent_name"] is None
