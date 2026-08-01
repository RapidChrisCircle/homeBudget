from datetime import date
from decimal import Decimal

import pytest
from app.models import Category, CategoryBudget, ImportBatch, Transaction
from app.services.reporting import (
    available_periods,
    build_monthly_report,
    category_grid,
    category_totals_for_period,
    default_period,
    month_bounds,
    monthly_summary,
    uncategorized_summary,
)


def make_category(db_session, name="Groceries", kind="expense", budget_amount=None):

    category = Category(name=name, kind=kind, budget_amount=budget_amount)
    db_session.add(category)
    db_session.flush()
    return category


def make_transaction(db_session, transaction_date=date(2026, 7, 24), narration="Coffee",
                     debit=None, credit=None, transaction_type="WDL", category_id=None,
                     account_number="1111"):

    batch = ImportBatch(filename="seed.csv", row_count=0, skipped_duplicate_count=0)
    db_session.add(batch)
    db_session.flush()

    transaction = Transaction(
        import_batch_id=batch.id,
        category_id=category_id,
        bsb_number=None,
        account_number=account_number,
        transaction_date=transaction_date,
        narration=narration,
        cheque_number=None,
        debit=debit,
        credit=credit,
        balance="100.00",
        transaction_type=transaction_type,
    )
    db_session.add(transaction)
    db_session.flush()
    return transaction


def test_month_bounds_is_half_open():

    start, end = month_bounds(2026, 7)

    assert start == date(2026, 7, 1)
    assert end == date(2026, 8, 1)


def test_month_bounds_rolls_december_to_next_january():

    start, end = month_bounds(2026, 12)

    assert start == date(2026, 12, 1)
    assert end == date(2027, 1, 1)


def test_category_total_is_net_of_debits_and_credits(db_session):

    category = make_category(db_session)
    make_transaction(db_session, debit="-98.00", category_id=category.id)
    make_transaction(db_session, credit="50.00", category_id=category.id)
    db_session.commit()

    start, end = month_bounds(2026, 7)
    totals = category_totals_for_period(db_session, start, end)

    groceries = next(t for t in totals if t.category_id == category.id)
    assert groceries.net == Decimal("-48.00")


def test_expense_category_actual_is_positive_spent(db_session):

    category = make_category(db_session, kind="expense")
    make_transaction(db_session, debit="-98.00", category_id=category.id)
    db_session.commit()

    start, end = month_bounds(2026, 7)
    totals = category_totals_for_period(db_session, start, end)

    groceries = next(t for t in totals if t.category_id == category.id)
    assert groceries.actual == Decimal("98.00")


def test_income_category_actual_is_positive_received(db_session):

    category = make_category(db_session, name="Salary", kind="income")
    make_transaction(db_session, credit="5000.00", category_id=category.id)
    db_session.commit()

    start, end = month_bounds(2026, 7)
    totals = category_totals_for_period(db_session, start, end)

    salary = next(t for t in totals if t.category_id == category.id)
    assert salary.actual == Decimal("5000.00")


def test_expense_category_that_nets_positive_reports_negative_spent(db_session):

    category = make_category(db_session, kind="expense")
    make_transaction(db_session, debit="-50.00", category_id=category.id)
    make_transaction(db_session, credit="80.00", category_id=category.id)
    db_session.commit()

    start, end = month_bounds(2026, 7)
    totals = category_totals_for_period(db_session, start, end)

    groceries = next(t for t in totals if t.category_id == category.id)
    assert groceries.actual == Decimal("-30.00")

    _, total_spending, _ = monthly_summary(totals)
    assert total_spending == Decimal("-30.00")


def test_transfer_category_excluded_from_every_section(db_session):

    transfers = make_category(db_session, name="Transfers", kind="transfer")

    # The real CCTrueUp pair: a credit into one account, a debit out of another.
    make_transaction(db_session, narration="CCTrueUp", credit="3365.49",
                     transaction_type="DEP", category_id=transfers.id, account_number="A")
    make_transaction(db_session, narration="CCTrueUp", debit="-3365.49",
                     transaction_type="TFD", category_id=transfers.id, account_number="B")
    db_session.commit()

    start, end = month_bounds(2026, 7)
    totals = category_totals_for_period(db_session, start, end)

    assert all(t.category_id != transfers.id for t in totals)

    total_income, total_spending, _ = monthly_summary(totals)
    assert total_income == Decimal("0")
    assert total_spending == Decimal("0")

    periods, grid_rows = category_grid(db_session, 2026, 7)
    assert all(r["category_id"] != transfers.id for r in grid_rows)

    review = uncategorized_summary(db_session, start, end)
    assert review["uncategorized_count"] == 0


def test_categorizing_transfer_pair_removes_it_from_income_and_spending(db_session):

    start, end = month_bounds(2026, 7)

    make_transaction(db_session, narration="CCTrueUp", credit="3365.49",
                     transaction_type="DEP", category_id=None, account_number="A")

    db_session.commit()
    review_before = uncategorized_summary(db_session, start, end)
    assert review_before["total_in"] == Decimal("3365.49")

    transfers = make_category(db_session, name="Transfers", kind="transfer")
    transaction = db_session.query(Transaction).one()
    transaction.category_id = transfers.id
    db_session.commit()

    totals = category_totals_for_period(db_session, start, end)
    total_income, _, _ = monthly_summary(totals)
    assert total_income == Decimal("0")


def test_uncategorized_excluded_from_category_rows_but_counted_in_review(db_session):

    make_transaction(db_session, debit="-20.00", category_id=None)
    db_session.commit()

    start, end = month_bounds(2026, 7)

    totals = category_totals_for_period(db_session, start, end)
    assert totals == []

    review = uncategorized_summary(db_session, start, end)
    assert review["uncategorized_count"] == 1
    assert review["transaction_count"] == 1
    assert review["total_out"] == Decimal("-20.00")


def test_budget_difference_is_budget_minus_actual(db_session):

    category = make_category(db_session, kind="expense", budget_amount="100.00")
    make_transaction(db_session, debit="-60.00", category_id=category.id)
    db_session.commit()

    start, end = month_bounds(2026, 7)
    totals = category_totals_for_period(db_session, start, end)
    groceries = next(t for t in totals if t.category_id == category.id)

    assert groceries.difference == Decimal("40.00")


def test_over_budget_difference_is_negative(db_session):

    category = make_category(db_session, kind="expense", budget_amount="100.00")
    make_transaction(db_session, debit="-150.00", category_id=category.id)
    db_session.commit()

    start, end = month_bounds(2026, 7)
    totals = category_totals_for_period(db_session, start, end)
    groceries = next(t for t in totals if t.category_id == category.id)

    assert groceries.difference == Decimal("-50.00")


def test_budgeted_expense_category_with_no_activity_still_appears(db_session):

    make_category(db_session, kind="expense", budget_amount="100.00")
    db_session.commit()

    start, end = month_bounds(2026, 7)
    totals = category_totals_for_period(db_session, start, end)

    assert len(totals) == 1
    assert totals[0].net == Decimal("0")
    assert totals[0].actual == Decimal("0")


def test_an_override_for_the_month_wins_over_the_standing_budget(db_session):

    category = make_category(db_session, kind="expense", budget_amount="100.00")
    db_session.add(CategoryBudget(category_id=category.id, year=2026, month=7, amount=Decimal("250.00")))
    db_session.commit()

    start, end = month_bounds(2026, 7)
    totals = category_totals_for_period(db_session, start, end)

    assert totals[0].budget_amount == Decimal("250.00")


def test_an_override_on_a_different_month_does_not_apply(db_session):

    category = make_category(db_session, kind="expense", budget_amount="100.00")
    db_session.add(CategoryBudget(category_id=category.id, year=2026, month=8, amount=Decimal("250.00")))
    db_session.commit()

    start, end = month_bounds(2026, 7)
    totals = category_totals_for_period(db_session, start, end)

    assert totals[0].budget_amount == Decimal("100.00")


def test_category_totals_for_period_rejects_a_non_month_aligned_start(db_session):

    make_category(db_session, kind="expense", budget_amount="100.00")
    db_session.commit()

    with pytest.raises(ValueError):
        category_totals_for_period(db_session, date(2026, 7, 15), date(2026, 8, 1))


def test_expense_category_with_no_budget_and_no_activity_is_omitted(db_session):

    make_category(db_session, kind="expense", budget_amount=None)
    db_session.commit()

    start, end = month_bounds(2026, 7)
    totals = category_totals_for_period(db_session, start, end)

    from app.services.reporting import budget_lines
    assert budget_lines(totals) == []


def test_grid_covers_contiguous_months_including_empty_ones(db_session):

    category = make_category(db_session)
    make_transaction(db_session, transaction_date=date(2026, 3, 1), debit="-10.00", category_id=category.id)
    make_transaction(db_session, transaction_date=date(2026, 7, 1), debit="-20.00", category_id=category.id)
    db_session.commit()

    periods, rows = category_grid(db_session, 2026, 7, months=6)

    assert periods == [(2026, 2), (2026, 3), (2026, 4), (2026, 5), (2026, 6), (2026, 7)]

    row = rows[0]
    assert row["amounts"][(2026, 3)] == Decimal("10.00")
    assert row["amounts"][(2026, 4)] == Decimal("0")
    assert row["amounts"][(2026, 7)] == Decimal("20.00")


def test_grid_includes_a_budgeted_category_with_zero_activity_in_the_whole_window(db_session):
    # Mirrors test_budgeted_expense_category_with_no_activity_still_appears
    # at the grid level: a budgeted category must not silently vanish from
    # a "total budgeted" figure derived from these rows just because it saw
    # no matching transactions anywhere in the window.
    category = make_category(db_session, budget_amount="100.00")
    db_session.commit()

    periods, rows = category_grid(db_session, 2026, 7, months=3)

    assert len(rows) == 1
    row = rows[0]
    assert row["category_id"] == category.id
    assert all(row["budgets"][p] == Decimal("100.00") for p in periods)
    assert all(row["amounts"][p] == Decimal("0") for p in periods)
    assert row["total"] == Decimal("0")


def test_grid_steps_between_the_standing_amount_and_a_mid_window_override(db_session):
    # An override on one month must not leak into its neighbours - the grid
    # is what the /trends budget-vs-actual chart is built from, and a leak
    # here would make the chart's "step" silently disappear.
    category = make_category(db_session, budget_amount="100.00")
    db_session.add(CategoryBudget(category_id=category.id, year=2026, month=6, amount=Decimal("250.00")))
    db_session.commit()

    periods, rows = category_grid(db_session, 2026, 7, months=3)  # May, June, July
    row = rows[0]

    assert row["budgets"][(2026, 5)] == Decimal("100.00")
    assert row["budgets"][(2026, 6)] == Decimal("250.00")
    assert row["budgets"][(2026, 7)] == Decimal("100.00")


def test_grid_omits_an_unbudgeted_category_with_zero_activity_in_the_whole_window(db_session):
    # The outer join exists to catch budgeted-but-idle categories, not to
    # flood the grid with every category ever created - an unbudgeted,
    # never-used category has nothing to show across a multi-month window.
    make_category(db_session, name="Unused", budget_amount=None)
    db_session.commit()

    _, rows = category_grid(db_session, 2026, 7, months=3)

    assert rows == []


def test_grid_cell_matches_budget_actual_for_selected_month(db_session):

    category = make_category(db_session, budget_amount="100.00")
    make_transaction(db_session, transaction_date=date(2026, 7, 15), debit="-42.00", category_id=category.id)
    db_session.commit()

    start, end = month_bounds(2026, 7)
    totals = category_totals_for_period(db_session, start, end)
    groceries = next(t for t in totals if t.category_id == category.id)

    _, rows = category_grid(db_session, 2026, 7)
    grid_row = next(r for r in rows if r["category_id"] == category.id)

    assert grid_row["amounts"][(2026, 7)] == groceries.actual


def test_available_periods_includes_uncategorized_only_months(db_session):

    make_transaction(db_session, transaction_date=date(2026, 5, 1), category_id=None)
    db_session.commit()

    periods = available_periods(db_session)

    assert (2026, 5, 1) in periods


def test_available_periods_sorted_newest_first(db_session):

    make_transaction(db_session, transaction_date=date(2026, 3, 1))
    make_transaction(db_session, transaction_date=date(2026, 7, 1))
    db_session.commit()

    periods = available_periods(db_session)

    assert [(p[0], p[1]) for p in periods] == [(2026, 7), (2026, 3)]


def test_default_period_is_most_recent_month_with_transactions(db_session):

    make_transaction(db_session, transaction_date=date(2026, 3, 1))
    make_transaction(db_session, transaction_date=date(2026, 7, 1))
    db_session.commit()

    assert default_period(db_session) == (2026, 7)


def test_default_period_falls_back_to_current_month_when_empty(db_session):

    year, month = default_period(db_session)
    today = date.today()

    assert (year, month) == (today.year, today.month)


def test_period_year_and_month_are_ints_not_decimals(db_session):

    make_transaction(db_session, transaction_date=date(2026, 7, 1))
    db_session.commit()

    year, month, _count = available_periods(db_session)[0]

    assert isinstance(year, int)
    assert isinstance(month, int)


def test_build_monthly_report_returns_all_four_sections(db_session):

    category = make_category(db_session, budget_amount="100.00")
    make_transaction(db_session, debit="-42.00", category_id=category.id)
    db_session.commit()

    report = build_monthly_report(db_session, 2026, 7)

    assert report["year"] == 2026
    assert report["month"] == 7
    assert "summary" in report
    assert "budgets" in report
    assert "grid" in report
    assert "uncategorized" in report
