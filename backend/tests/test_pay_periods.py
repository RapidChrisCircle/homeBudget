from datetime import date
from decimal import Decimal

from app.models import Category, ImportBatch, PaySchedule, Transaction
from app.services.pay_periods import (
    fortnightly_pace,
    get_anchor,
    pay_period_bounds,
    pay_period_category_totals,
    pay_period_lines,
    pay_period_summary,
    set_anchor,
    shift_period,
)


def make_category(db_session, name="Groceries", kind="expense", budget_amount=None):

    category = Category(name=name, kind=kind, budget_amount=budget_amount)
    db_session.add(category)
    db_session.flush()
    return category


def make_transaction(db_session, transaction_date, category_id=None, debit=None, credit=None):

    batch = ImportBatch(filename="seed.csv", row_count=0, skipped_duplicate_count=0)
    db_session.add(batch)
    db_session.flush()

    transaction = Transaction(
        import_batch_id=batch.id,
        category_id=category_id,
        account_number="1111",
        transaction_date=transaction_date,
        narration="Coffee",
        debit=debit,
        credit=credit,
        balance="100.00",
        transaction_type="WDL",
    )
    db_session.add(transaction)
    db_session.flush()
    return transaction


# --- pay_period_bounds -------------------------------------------------------------

def test_bounds_anchor_itself_is_the_start_of_its_own_period():

    anchor = date(2026, 1, 1)
    start, end = pay_period_bounds(anchor, anchor)

    assert start == date(2026, 1, 1)
    assert end == date(2026, 1, 15)


def test_bounds_a_date_mid_period():

    anchor = date(2026, 1, 1)
    start, end = pay_period_bounds(anchor, date(2026, 1, 10))

    assert (start, end) == (date(2026, 1, 1), date(2026, 1, 15))


def test_bounds_a_date_before_the_anchor():

    anchor = date(2026, 1, 15)
    start, end = pay_period_bounds(anchor, date(2026, 1, 1))

    assert (start, end) == (date(2026, 1, 1), date(2026, 1, 15))


def test_bounds_a_three_pay_month():
    # An anchor of Jan 1 2026 makes May 2026 a three-pay-cycle month:
    # periods start Apr 23, May 7, and May 21.
    anchor = date(2026, 1, 1)

    assert pay_period_bounds(anchor, date(2026, 5, 1)) == (date(2026, 4, 23), date(2026, 5, 7))
    assert pay_period_bounds(anchor, date(2026, 5, 10)) == (date(2026, 5, 7), date(2026, 5, 21))
    assert pay_period_bounds(anchor, date(2026, 5, 25)) == (date(2026, 5, 21), date(2026, 6, 4))


def test_bounds_across_a_year_boundary():

    anchor = date(2025, 12, 25)

    assert pay_period_bounds(anchor, date(2026, 1, 5)) == (date(2025, 12, 25), date(2026, 1, 8))
    assert pay_period_bounds(anchor, date(2026, 1, 10)) == (date(2026, 1, 8), date(2026, 1, 22))


def test_shift_period_moves_by_whole_fortnights():

    start = date(2026, 1, 1)

    assert shift_period(start, 1) == date(2026, 1, 15)
    assert shift_period(start, -1) == date(2025, 12, 18)


# --- fortnightly_pace ----------------------------------------------------------

def test_fortnightly_pace_rescales_a_monthly_figure():

    assert fortnightly_pace(Decimal("100.00")) == (Decimal("100.00") * 12 / 26).quantize(Decimal("0.01"))


def test_fortnightly_pace_of_none_is_none():

    assert fortnightly_pace(None) is None


# --- get_anchor / set_anchor ----------------------------------------------------

def test_get_anchor_is_none_when_never_set(db_session):

    assert get_anchor(db_session) is None


def test_set_anchor_then_get_anchor_round_trips(db_session):

    set_anchor(db_session, date(2026, 1, 2))

    assert get_anchor(db_session) == date(2026, 1, 2)


def test_set_anchor_upserts_a_single_row(db_session):

    set_anchor(db_session, date(2026, 1, 2))
    set_anchor(db_session, date(2026, 2, 13))

    assert get_anchor(db_session) == date(2026, 2, 13)
    assert db_session.query(PaySchedule).count() == 1


# --- pay_period_category_totals / lines / summary -------------------------------

def test_pay_period_category_totals_only_counts_activity_in_the_window(db_session):

    category = make_category(db_session, budget_amount=Decimal("100.00"))
    make_transaction(db_session, date(2026, 1, 5), category.id, debit=Decimal("-20.00"))
    make_transaction(db_session, date(2026, 1, 20), category.id, debit=Decimal("-999.00"))
    db_session.commit()

    totals = pay_period_category_totals(db_session, date(2026, 1, 1), date(2026, 1, 15))
    row = next(t for t in totals if t.category_id == category.id)

    assert row.actual == Decimal("20.00")
    assert row.standing_budget == Decimal("100.00")
    assert row.pace == fortnightly_pace(Decimal("100.00"))
    assert row.difference == row.pace - Decimal("20.00")


def test_pay_period_category_totals_excludes_transfers(db_session):

    transfer = make_category(db_session, name="Card Payment", kind="transfer")
    make_transaction(db_session, date(2026, 1, 5), transfer.id, debit=Decimal("-500.00"))
    db_session.commit()

    totals = pay_period_category_totals(db_session, date(2026, 1, 1), date(2026, 1, 15))

    assert all(t.category_id != transfer.id for t in totals)


def test_pay_period_lines_drops_unbudgeted_zero_activity_categories(db_session):

    make_category(db_session, name="Unused", budget_amount=None)
    db_session.commit()

    totals = pay_period_category_totals(db_session, date(2026, 1, 1), date(2026, 1, 15))

    assert pay_period_lines(totals) == []


def test_pay_period_summary_matches_income_and_spending(db_session):

    expense = make_category(db_session, name="Groceries", kind="expense")
    income = make_category(db_session, name="Salary", kind="income")
    make_transaction(db_session, date(2026, 1, 5), expense.id, debit=Decimal("-60.00"))
    make_transaction(db_session, date(2026, 1, 6), income.id, credit=Decimal("2000.00"))
    db_session.commit()

    totals = pay_period_category_totals(db_session, date(2026, 1, 1), date(2026, 1, 15))
    total_income, total_spending, net_saved = pay_period_summary(totals)

    assert total_income == Decimal("2000.00")
    assert total_spending == Decimal("60.00")
    assert net_saved == Decimal("1940.00")


# --- API -------------------------------------------------------------------------

def test_get_pay_schedule_reports_not_configured_by_default(client):

    body = client.get("/api/pay-schedule").json()

    assert body == {"configured": False, "anchor_date": None}


def test_put_pay_schedule_sets_the_anchor(client):

    body = client.put("/api/pay-schedule", json={"anchor_date": "2026-01-02"}).json()

    assert body == {"configured": True, "anchor_date": "2026-01-02"}
    assert client.get("/api/pay-schedule").json() == {"configured": True, "anchor_date": "2026-01-02"}


def test_get_pay_period_reports_not_configured_without_a_schedule(client):

    body = client.get("/api/pay-periods").json()

    assert body["configured"] is False
    assert body["categories"] == []
    assert body["summary"] is None


def test_get_pay_period_uses_the_reference_date(client, db_session):

    client.put("/api/pay-schedule", json={"anchor_date": "2026-01-01"})
    category = make_category(db_session, budget_amount=Decimal("100.00"))
    make_transaction(db_session, date(2026, 1, 5), category.id, debit=Decimal("-20.00"))
    db_session.commit()

    body = client.get("/api/pay-periods", params={"reference_date": "2026-01-05"}).json()

    assert body["configured"] is True
    assert body["start_date"] == "2026-01-01"
    assert body["end_date"] == "2026-01-15"
    row = next(c for c in body["categories"] if c["category_id"] == category.id)
    assert row["actual"] == "20.00"
    assert row["pace"] == str(fortnightly_pace(Decimal("100.00")))
    assert body["summary"]["total_spending"] == "20.00"


def test_get_pay_period_defaults_to_today_when_no_reference_date_given(client):

    client.put("/api/pay-schedule", json={"anchor_date": "2026-01-01"})

    response = client.get("/api/pay-periods")

    assert response.status_code == 200
    assert response.json()["configured"] is True
