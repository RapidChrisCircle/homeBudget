import io
from datetime import date
from decimal import Decimal

from app.models import Category, CategoryBudget, ImportBatch, Transaction
from app.services.reporting import (
    category_grid,
    category_totals_for_period,
    month_bounds,
    monthly_summary,
)
from app.services.trends import budget_totals, monthly_summaries


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


def test_monthly_summaries_agrees_with_reportings_own_single_month_summary(db_session):
    # The invariant this whole module exists to guarantee: /trends and
    # /reports must never be able to disagree about the same month, because
    # both are derived from category_grid()'s rows, not independent queries.
    groceries = make_category(db_session, name="Groceries", kind="expense")
    salary = make_category(db_session, name="Salary", kind="income")

    make_transaction(db_session, transaction_date=date(2026, 7, 10), debit="-60.00", category_id=groceries.id)
    make_transaction(db_session, transaction_date=date(2026, 7, 15), credit="5000.00", category_id=salary.id)
    # Activity in an earlier month too, so the grid spans more than one period.
    make_transaction(db_session, transaction_date=date(2026, 6, 5), debit="-40.00", category_id=groceries.id)
    db_session.commit()

    periods, grid_rows = category_grid(db_session, 2026, 7, months=3)
    summaries = monthly_summaries(periods, grid_rows)
    july_summary = next(s for s in summaries if s["period"] == (2026, 7))

    start, end = month_bounds(2026, 7)
    totals = category_totals_for_period(db_session, start, end)
    expected_income, expected_spending, expected_net = monthly_summary(totals)

    assert july_summary["total_income"] == expected_income
    assert july_summary["total_spending"] == expected_spending
    assert july_summary["net_saved"] == expected_net


def test_monthly_summaries_agrees_even_for_a_month_with_zero_activity(db_session):
    # A budgeted-but-idle category (kept alive in the grid by the outer-join
    # fix) must contribute zero to both, not throw off the comparison.
    make_category(db_session, name="Idle budget", kind="expense", budget_amount="200.00")
    make_transaction(db_session, transaction_date=date(2026, 7, 10), debit="-10.00")
    db_session.commit()

    periods, grid_rows = category_grid(db_session, 2026, 7, months=1)
    summaries = monthly_summaries(periods, grid_rows)

    start, end = month_bounds(2026, 7)
    totals = category_totals_for_period(db_session, start, end)
    expected_income, expected_spending, expected_net = monthly_summary(totals)

    assert summaries[0]["total_income"] == expected_income
    assert summaries[0]["total_spending"] == expected_spending
    assert summaries[0]["net_saved"] == expected_net


def test_budget_totals_counts_only_budgeted_expense_categories(db_session):

    budgeted = make_category(db_session, name="Groceries", kind="expense", budget_amount="500.00")
    unbudgeted = make_category(db_session, name="Entertainment", kind="expense", budget_amount=None)
    income = make_category(db_session, name="Salary", kind="income", budget_amount=None)

    make_transaction(db_session, transaction_date=date(2026, 7, 10), debit="-300.00", category_id=budgeted.id)
    make_transaction(db_session, transaction_date=date(2026, 7, 12), debit="-999.00", category_id=unbudgeted.id)
    make_transaction(db_session, transaction_date=date(2026, 7, 15), credit="5000.00", category_id=income.id)
    db_session.commit()

    periods, grid_rows = category_grid(db_session, 2026, 7, months=1)
    totals = budget_totals(periods, grid_rows)

    assert totals[0]["budgeted"] == Decimal("500.00")
    # Only the budgeted category's spending counts - the unbudgeted $999 and
    # the income are both excluded from "actual" too.
    assert totals[0]["actual"] == Decimal("300.00")


def test_budget_totals_repeats_the_standing_figure_when_no_override_exists(db_session):
    # No override anywhere in the window - every period resolves to the same
    # standing amount, so the line is flat (not because it can't step, but
    # because nothing told it to).
    make_category(db_session, name="Groceries", kind="expense", budget_amount="500.00")
    make_transaction(db_session, transaction_date=date(2026, 5, 1), debit="-10.00")
    db_session.commit()

    periods, grid_rows = category_grid(db_session, 2026, 7, months=3)
    totals = budget_totals(periods, grid_rows)

    assert [t["budgeted"] for t in totals] == [Decimal("500.00")] * 3


def test_budget_totals_steps_when_an_override_changes_mid_window(db_session):
    # This is the test that would fail against the old flat implementation:
    # an override on one month must change ONLY that month's budgeted figure
    # and actual-scope, not the whole window.
    category = make_category(db_session, name="Groceries", kind="expense", budget_amount="500.00")
    db_session.add(CategoryBudget(category_id=category.id, year=2026, month=6, amount=Decimal("800.00")))
    make_transaction(db_session, transaction_date=date(2026, 6, 5), debit="-600.00", category_id=category.id)
    make_transaction(db_session, transaction_date=date(2026, 7, 5), debit="-450.00", category_id=category.id)
    db_session.commit()

    periods, grid_rows = category_grid(db_session, 2026, 7, months=3)  # May, June, July
    totals = budget_totals(periods, grid_rows)

    assert [t["budgeted"] for t in totals] == [Decimal("500.00"), Decimal("800.00"), Decimal("500.00")]
    assert [t["actual"] for t in totals] == [Decimal("0"), Decimal("600.00"), Decimal("450.00")]


def test_budget_totals_actual_only_counts_categories_budgeted_in_that_specific_period(db_session):
    # A category with a budget in only SOME periods of the window must
    # contribute to "actual" only in those periods, not the whole window -
    # this is what makes budget_totals genuinely per-period rather than
    # "budgeted anywhere in the window, applied everywhere".
    category = make_category(db_session, name="Once-off", kind="expense", budget_amount=None)
    db_session.add(CategoryBudget(category_id=category.id, year=2026, month=6, amount=Decimal("200.00")))
    make_transaction(db_session, transaction_date=date(2026, 5, 5), debit="-50.00", category_id=category.id)
    make_transaction(db_session, transaction_date=date(2026, 6, 5), debit="-150.00", category_id=category.id)
    db_session.commit()

    periods, grid_rows = category_grid(db_session, 2026, 7, months=3)  # May, June, July
    totals = budget_totals(periods, grid_rows)

    may, june, july = totals
    assert may["budgeted"] == Decimal("0") and may["actual"] == Decimal("0")
    assert june["budgeted"] == Decimal("200.00") and june["actual"] == Decimal("150.00")
    assert july["budgeted"] == Decimal("0") and july["actual"] == Decimal("0")


def test_periods_stay_contiguous_when_a_middle_month_has_no_transactions_at_all(db_session):

    category = make_category(db_session)
    make_transaction(db_session, transaction_date=date(2026, 5, 1), debit="-10.00", category_id=category.id)
    # June deliberately has no transactions anywhere.
    make_transaction(db_session, transaction_date=date(2026, 7, 1), debit="-20.00", category_id=category.id)
    db_session.commit()

    periods, grid_rows = category_grid(db_session, 2026, 7, months=3)
    summaries = monthly_summaries(periods, grid_rows)
    totals = budget_totals(periods, grid_rows)

    assert periods == [(2026, 5), (2026, 6), (2026, 7)]
    assert [s["period"] for s in summaries] == periods
    assert [t["period"] for t in totals] == periods

    june = next(s for s in summaries if s["period"] == (2026, 6))
    assert june["total_spending"] == Decimal("0")


def test_get_trends_endpoint_returns_periods_categories_monthly_and_budget(client):

    category_id = client.post(
        "/api/categories", json={"name": "Groceries", "kind": "expense", "budget_amount": "500.00"}
    ).json()["id"]

    header = "BSB Number,Account Number,Transaction Date,Narration,Cheque Number,Debit,Credit,Balance,Transaction Type\n"
    row = ',1111,24/07/2026,"Coffee",,-5.00,,100.00,WDL\n'
    client.post(
        "/api/transactions/import",
        files={"file": ("t.csv", io.BytesIO((header + row).encode("utf-8")), "text/csv")},
    )
    transaction_id = client.get("/api/transactions?page_size=1").json()["items"][0]["id"]
    client.patch(f"/api/transactions/{transaction_id}/category", json={"category_id": category_id})

    response = client.get("/api/trends?months=2")

    assert response.status_code == 200
    body = response.json()
    assert len(body["periods"]) == 2
    assert len(body["monthly"]) == 2
    assert len(body["budget"]) == 2
    assert len(body["balances"]) == 2
    assert any(c["category_id"] == category_id for c in body["categories"])
    assert body["balances"][-1] == {"label": "2026-07", "balance": "100.00"}


def test_get_trends_rejects_year_without_month(client):

    response = client.get("/api/trends?year=2026")

    assert response.status_code == 422
