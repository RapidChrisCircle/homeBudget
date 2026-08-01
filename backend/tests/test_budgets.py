from decimal import Decimal

from app.models import Category, CategoryBudget
from app.services.budgets import copy_budgets, effective_budget, overrides_for_period, overrides_for_periods


def make_category(db_session, name="Groceries", kind="expense", budget_amount=None):

    category = Category(name=name, kind=kind, budget_amount=budget_amount)
    db_session.add(category)
    db_session.flush()
    return category


def make_override(db_session, category_id, year, month, amount):

    override = CategoryBudget(category_id=category_id, year=year, month=month, amount=amount)
    db_session.add(override)
    db_session.flush()
    return override


# --- effective_budget ----------------------------------------------------------

def test_override_wins_over_standing():

    assert effective_budget(Decimal("100.00"), Decimal("150.00")) == Decimal("150.00")


def test_standing_applies_when_no_override():

    assert effective_budget(Decimal("100.00"), None) == Decimal("100.00")


def test_none_when_neither_is_set():

    assert effective_budget(None, None) is None


def test_zero_override_resolves_to_zero_not_to_standing():
    # The bug a truthiness check (`override or standing`) would introduce -
    # Decimal("0.00") is falsy, so `override or standing` would wrongly fall
    # through to the standing amount.
    assert effective_budget(Decimal("100.00"), Decimal("0.00")) == Decimal("0.00")


# --- overrides_for_period(s) ----------------------------------------------------

def test_overrides_for_period_returns_only_that_months_overrides(db_session):

    category = make_category(db_session)
    make_override(db_session, category.id, 2026, 7, Decimal("120.00"))
    make_override(db_session, category.id, 2026, 8, Decimal("90.00"))
    db_session.commit()

    overrides = overrides_for_period(db_session, 2026, 7)

    assert overrides == {category.id: Decimal("120.00")}


def test_overrides_for_period_empty_when_none_set(db_session):

    make_category(db_session)
    db_session.commit()

    assert overrides_for_period(db_session, 2026, 7) == {}


def test_overrides_for_periods_spans_multiple_months(db_session):

    category = make_category(db_session)
    make_override(db_session, category.id, 2026, 6, Decimal("50.00"))
    make_override(db_session, category.id, 2026, 8, Decimal("70.00"))
    db_session.commit()

    overrides = overrides_for_periods(db_session, [(2026, 6), (2026, 7), (2026, 8)])

    assert overrides == {
        (category.id, (2026, 6)): Decimal("50.00"),
        (category.id, (2026, 8)): Decimal("70.00"),
    }


def test_overrides_for_periods_empty_periods_list_returns_empty(db_session):

    assert overrides_for_periods(db_session, []) == {}


# --- copy_budgets ---------------------------------------------------------------

def test_copy_writes_the_effective_budget_as_an_override(db_session):
    # Standing 100, no override in July - copying to August must write an
    # explicit override of 100, not leave August pointing back at standing.
    category = make_category(db_session, budget_amount="100.00")
    db_session.commit()

    written = copy_budgets(db_session, (2026, 7), (2026, 8))

    assert written == 1
    august_override = (
        db_session.query(CategoryBudget)
        .filter(CategoryBudget.category_id == category.id, CategoryBudget.year == 2026, CategoryBudget.month == 8)
        .one()
    )
    assert august_override.amount == Decimal("100.00")


def test_copy_prefers_the_source_months_override_over_its_standing(db_session):

    category = make_category(db_session, budget_amount="100.00")
    make_override(db_session, category.id, 2026, 7, Decimal("150.00"))
    db_session.commit()

    copy_budgets(db_session, (2026, 7), (2026, 8))

    august = overrides_for_period(db_session, 2026, 8)
    assert august[category.id] == Decimal("150.00")


def test_copying_a_change_to_the_standing_amount_afterward_does_not_affect_the_copy(db_session):
    # The whole point of writing an override rather than a reference.
    category = make_category(db_session, budget_amount="100.00")
    db_session.commit()

    copy_budgets(db_session, (2026, 7), (2026, 8))

    category.budget_amount = Decimal("500.00")
    db_session.commit()

    august = overrides_for_period(db_session, 2026, 8)
    assert august[category.id] == Decimal("100.00")


def test_copy_overwrites_an_existing_target_month_override(db_session):

    category = make_category(db_session, budget_amount="100.00")
    make_override(db_session, category.id, 2026, 8, Decimal("999.00"))
    db_session.commit()

    copy_budgets(db_session, (2026, 7), (2026, 8))

    august = overrides_for_period(db_session, 2026, 8)
    assert august[category.id] == Decimal("100.00")
    # Overwritten in place, not duplicated.
    assert db_session.query(CategoryBudget).filter(
        CategoryBudget.category_id == category.id, CategoryBudget.year == 2026, CategoryBudget.month == 8
    ).count() == 1


def test_copying_a_month_with_no_budgets_at_all_writes_nothing(db_session):

    make_category(db_session, budget_amount=None)
    db_session.commit()

    written = copy_budgets(db_session, (2026, 7), (2026, 8))

    assert written == 0
    assert db_session.query(CategoryBudget).count() == 0


def test_copy_skips_categories_with_no_effective_budget_but_copies_the_rest(db_session):

    budgeted = make_category(db_session, name="Groceries", budget_amount="100.00")
    make_category(db_session, name="Entertainment", budget_amount=None)
    db_session.commit()

    written = copy_budgets(db_session, (2026, 7), (2026, 8))

    assert written == 1
    august = overrides_for_period(db_session, 2026, 8)
    assert list(august.keys()) == [budgeted.id]


def test_copy_ignores_income_and_transfer_categories(db_session):

    make_category(db_session, name="Salary", kind="income", budget_amount=None)
    make_category(db_session, name="Transfers", kind="transfer", budget_amount=None)
    db_session.commit()

    written = copy_budgets(db_session, (2026, 7), (2026, 8))

    assert written == 0


# --- cascade ---------------------------------------------------------------------

def test_budgets_cascade_when_their_category_is_deleted(client, db_session):

    category_id = client.post(
        "/api/categories", json={"name": "Groceries", "kind": "expense", "budget_amount": "100.00"}
    ).json()["id"]
    make_override(db_session, category_id, 2026, 7, Decimal("150.00"))
    db_session.commit()

    response = client.delete(f"/api/categories/{category_id}")

    assert response.status_code == 204
    assert db_session.query(CategoryBudget).filter(CategoryBudget.category_id == category_id).count() == 0
