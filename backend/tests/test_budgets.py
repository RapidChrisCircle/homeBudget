from datetime import date
from decimal import Decimal

from app.models import Category, CategoryBudget, ImportBatch, Transaction
from app.services.budgets import (
    copy_budgets,
    effective_budget,
    overrides_for_period,
    overrides_for_periods,
    rollover_available,
    rollover_history,
)


def make_category(db_session, name="Groceries", kind="expense", budget_amount=None,
                   rolls_over=False, rollover_start_year=None, rollover_start_month=None):

    category = Category(
        name=name, kind=kind, budget_amount=budget_amount, rolls_over=rolls_over,
        rollover_start_year=rollover_start_year, rollover_start_month=rollover_start_month,
    )
    db_session.add(category)
    db_session.flush()
    return category


def make_override(db_session, category_id, year, month, amount):

    override = CategoryBudget(category_id=category_id, year=year, month=month, amount=amount)
    db_session.add(override)
    db_session.flush()
    return override


def make_transaction(db_session, transaction_date, debit, category_id, account_number="1111"):

    batch = ImportBatch(filename="seed.csv", row_count=0, skipped_duplicate_count=0)
    db_session.add(batch)
    db_session.flush()

    transaction = Transaction(
        import_batch_id=batch.id,
        category_id=category_id,
        account_number=account_number,
        transaction_date=transaction_date,
        narration="Coffee",
        debit=debit,
        balance="100.00",
        transaction_type="WDL",
    )
    db_session.add(transaction)
    db_session.flush()
    return transaction


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


# --- rollover_history / rollover_available ----------------------------------------

def test_rollover_history_empty_when_category_does_not_roll_over(db_session):

    category = make_category(db_session, budget_amount=Decimal("100.00"))

    assert rollover_history(db_session, category, 2026, 7) == []
    assert rollover_available(db_session, category, 2026, 7) is None


def test_rollover_history_empty_when_rolls_over_but_no_start_recorded(db_session):
    # Defensive - shouldn't happen via the API (which always stamps a start
    # the moment rolls_over is switched on), but a directly-constructed row
    # (fixtures, a future migration) must not explode.
    category = make_category(db_session, budget_amount=Decimal("100.00"), rolls_over=True)

    assert rollover_history(db_session, category, 2026, 7) == []


def test_rollover_history_empty_before_the_recorded_start(db_session):

    category = make_category(
        db_session, budget_amount=Decimal("100.00"),
        rolls_over=True, rollover_start_year=2026, rollover_start_month=7,
    )

    assert rollover_history(db_session, category, 2026, 6) == []


def test_rollover_history_single_month_matches_a_plain_budget(db_session):

    category = make_category(
        db_session, budget_amount=Decimal("100.00"),
        rolls_over=True, rollover_start_year=2026, rollover_start_month=7,
    )
    make_transaction(db_session, date(2026, 7, 10), Decimal("-30.00"), category.id)
    db_session.commit()

    history = rollover_history(db_session, category, 2026, 7)

    assert len(history) == 1
    assert history[0].resolved_budget == Decimal("100.00")
    assert history[0].actual == Decimal("30.00")
    assert history[0].available == Decimal("100.00")
    assert rollover_available(db_session, category, 2026, 7) == Decimal("100.00")


def test_rollover_accumulates_unspent_budget_into_the_next_month(db_session):

    category = make_category(
        db_session, budget_amount=Decimal("100.00"),
        rolls_over=True, rollover_start_year=2026, rollover_start_month=7,
    )
    make_transaction(db_session, date(2026, 7, 10), Decimal("-30.00"), category.id)
    db_session.commit()

    # July: 100 budgeted, 30 spent, 70 left over -> carries into August.
    assert rollover_available(db_session, category, 2026, 8) == Decimal("170.00")


def test_rollover_absorbs_a_sinking_fund_spike_without_reading_as_over_budget(db_session):
    # The exact scenario the roadmap describes: $100/month toward $1,200 of
    # annual car registration. Six quiet months, then the spike.
    category = make_category(
        db_session, budget_amount=Decimal("100.00"),
        rolls_over=True, rollover_start_year=2026, rollover_start_month=1,
    )
    db_session.commit()

    for month in range(1, 7):
        assert rollover_available(db_session, category, 2026, month) == Decimal(f"{100 * month}.00")

    make_transaction(db_session, date(2026, 7, 15), Decimal("-600.00"), category.id)
    db_session.commit()

    # 6 quiet months x $100 = $600 carried in, plus July's own $100 = $700
    # available against a $600 spike - comfortably under, not over.
    assert rollover_available(db_session, category, 2026, 7) == Decimal("700.00")


def test_rollover_overspend_carries_forward_as_a_deficit(db_session):

    category = make_category(
        db_session, budget_amount=Decimal("100.00"),
        rolls_over=True, rollover_start_year=2026, rollover_start_month=7,
    )
    make_transaction(db_session, date(2026, 7, 10), Decimal("-130.00"), category.id)
    db_session.commit()

    # July overspent by 30 -> August starts 30 in the hole before its own
    # budget is even added.
    assert rollover_available(db_session, category, 2026, 8) == Decimal("70.00")


def test_rollover_treats_a_month_with_no_own_budget_as_zero_contribution_not_a_break(db_session):

    category = make_category(
        db_session, budget_amount=None,
        rolls_over=True, rollover_start_year=2026, rollover_start_month=7,
    )
    make_override(db_session, category.id, 2026, 7, Decimal("100.00"))
    make_transaction(db_session, date(2026, 7, 10), Decimal("-40.00"), category.id)
    db_session.commit()

    # August has no override and no standing amount - the walk still
    # carries July's 60 leftover forward, just adds nothing new.
    assert rollover_available(db_session, category, 2026, 8) == Decimal("60.00")


def test_rollover_a_net_refund_month_increases_available(db_session):

    category = make_category(
        db_session, budget_amount=Decimal("100.00"),
        rolls_over=True, rollover_start_year=2026, rollover_start_month=7,
    )
    make_transaction(db_session, date(2026, 7, 5), Decimal("-20.00"), category.id)
    batch = ImportBatch(filename="seed.csv", row_count=0, skipped_duplicate_count=0)
    db_session.add(batch)
    db_session.flush()
    db_session.add(Transaction(
        import_batch_id=batch.id, category_id=category.id, account_number="1111",
        transaction_date=date(2026, 7, 20), narration="Refund", credit=Decimal("50.00"),
        balance="100.00", transaction_type="DEP",
    ))
    db_session.commit()

    # Net for July is +30 (a refund month) -> actual is -30 (a net refund,
    # not clamped to zero - matches CategoryPeriodTotal.actual's own rule),
    # so available carried into August is 100 + 100 - (-30) = 230.
    assert rollover_available(db_session, category, 2026, 8) == Decimal("230.00")
