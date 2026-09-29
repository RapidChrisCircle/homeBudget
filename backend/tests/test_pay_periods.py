from datetime import date
from decimal import Decimal

from app.models import Category, ImportBatch, PaySchedule, Transaction
from app.services.pay_periods import (
    fortnightly_pace,
    get_schedule,
    last_business_day,
    next_payday,
    pace,
    pay_period_bounds,
    pay_period_category_totals,
    pay_period_lines,
    pay_period_summary,
    set_schedule,
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


# --- last_business_day / next_payday (T5.4) ----------------------------------------

def test_last_business_day_is_the_last_day_itself_on_a_weekday():
    # 2026-04-30 is a Thursday.
    assert last_business_day(2026, 4) == date(2026, 4, 30)


def test_last_business_day_steps_back_from_a_saturday():
    # 2026-08-31 is a Monday, so pick a month that ends on a weekend instead:
    # 2026-05-31 is a Sunday.
    assert last_business_day(2026, 5) == date(2026, 5, 29)  # Friday


def test_last_business_day_steps_back_from_a_sunday():
    # 2026-11-30 is a Monday; 2027-01-31 is a Sunday.
    assert last_business_day(2027, 1) == date(2027, 1, 29)  # Friday


def test_next_payday_returns_this_months_own_payday_when_still_ahead():
    assert next_payday(date(2026, 4, 1)) == date(2026, 4, 30)


def test_next_payday_returns_reference_itself_when_reference_is_payday():
    # "On or after" - checking ON payday itself is 0 days away, not a month out.
    assert next_payday(date(2026, 4, 30)) == date(2026, 4, 30)


def test_next_payday_rolls_to_next_month_once_this_months_has_passed():
    assert next_payday(date(2026, 5, 30)) == date(2026, 6, 30)  # 2026-05-29 already passed


def test_next_payday_crosses_a_year_boundary():
    # 2028-12-31 is a Sunday, so December's own payday rolls back to the
    # 29th - checking on the 31st (after that payday has passed) must roll
    # forward into January of the FOLLOWING year, not December again.
    assert last_business_day(2028, 12) == date(2028, 12, 29)
    assert next_payday(date(2028, 12, 31)) == date(2029, 1, 31)


# --- pace / fortnightly_pace --------------------------------------------------------

def test_fortnightly_pace_rescales_a_monthly_figure():

    assert fortnightly_pace(Decimal("100.00")) == (Decimal("100.00") * 12 / 26).quantize(Decimal("0.01"))


def test_fortnightly_pace_of_none_is_none():

    assert fortnightly_pace(None) is None


def test_pace_fortnightly_agrees_with_the_dedicated_alias():

    assert pace(Decimal("100.00"), "fortnightly") == fortnightly_pace(Decimal("100.00"))


def test_pace_monthly_is_a_one_to_one_passthrough():

    assert pace(Decimal("100.00"), "monthly") == Decimal("100.00")


def test_pace_monthly_of_none_is_none():

    assert pace(None, "monthly") is None


# --- get_schedule / set_schedule ----------------------------------------------------

def test_get_schedule_is_none_when_never_set(db_session):

    assert get_schedule(db_session) is None


def test_set_schedule_then_get_schedule_round_trips_fortnightly(db_session):

    set_schedule(db_session, "fortnightly", date(2026, 1, 2))

    assert get_schedule(db_session) == ("fortnightly", date(2026, 1, 2))


def test_set_schedule_round_trips_monthly_with_no_anchor(db_session):

    set_schedule(db_session, "monthly", None)

    assert get_schedule(db_session) == ("monthly", None)


def test_set_schedule_upserts_a_single_row(db_session):

    set_schedule(db_session, "fortnightly", date(2026, 1, 2))
    set_schedule(db_session, "fortnightly", date(2026, 2, 13))

    assert get_schedule(db_session) == ("fortnightly", date(2026, 2, 13))
    assert db_session.query(PaySchedule).count() == 1


def test_set_schedule_switches_frequency_on_the_same_row(db_session):

    set_schedule(db_session, "fortnightly", date(2026, 1, 2))
    set_schedule(db_session, "monthly", None)

    assert get_schedule(db_session) == ("monthly", None)
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


def test_pay_period_category_totals_defaults_to_fortnightly_pacing(db_session):

    category = make_category(db_session, budget_amount=Decimal("100.00"))
    db_session.commit()

    totals = pay_period_category_totals(db_session, date(2026, 1, 1), date(2026, 1, 15))
    row = next(t for t in totals if t.category_id == category.id)

    assert row.pace == fortnightly_pace(Decimal("100.00"))


def test_pay_period_category_totals_monthly_pacing_is_the_standing_amount(db_session):

    category = make_category(db_session, budget_amount=Decimal("100.00"))
    make_transaction(db_session, date(2026, 4, 5), category.id, debit=Decimal("-20.00"))
    db_session.commit()

    totals = pay_period_category_totals(
        db_session, date(2026, 4, 1), date(2026, 5, 1), frequency="monthly"
    )
    row = next(t for t in totals if t.category_id == category.id)

    assert row.pace == Decimal("100.00")
    assert row.actual == Decimal("20.00")


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

    assert body == {"configured": False, "frequency": None, "anchor_date": None}


def test_put_pay_schedule_sets_a_fortnightly_anchor(client):

    body = client.put(
        "/api/pay-schedule", json={"frequency": "fortnightly", "anchor_date": "2026-01-02"}
    ).json()

    assert body == {"configured": True, "frequency": "fortnightly", "anchor_date": "2026-01-02"}
    assert client.get("/api/pay-schedule").json() == body


def test_put_pay_schedule_sets_a_monthly_schedule_with_no_anchor(client):

    body = client.put("/api/pay-schedule", json={"frequency": "monthly"}).json()

    assert body == {"configured": True, "frequency": "monthly", "anchor_date": None}
    assert client.get("/api/pay-schedule").json() == body


def test_put_pay_schedule_ignores_an_anchor_sent_alongside_monthly(client):

    body = client.put(
        "/api/pay-schedule", json={"frequency": "monthly", "anchor_date": "2026-01-02"}
    ).json()

    assert body["anchor_date"] is None


def test_put_pay_schedule_rejects_fortnightly_without_an_anchor(client):

    response = client.put("/api/pay-schedule", json={"frequency": "fortnightly"})

    assert response.status_code == 422


def test_put_pay_schedule_rejects_an_unknown_frequency(client):

    response = client.put(
        "/api/pay-schedule", json={"frequency": "weekly", "anchor_date": "2026-01-02"}
    )

    assert response.status_code == 422


def test_get_pay_period_reports_not_configured_without_a_schedule(client):

    body = client.get("/api/pay-periods").json()

    assert body["configured"] is False
    assert body["categories"] == []
    assert body["summary"] is None


def test_get_pay_period_uses_the_reference_date(client, db_session):

    client.put("/api/pay-schedule", json={"frequency": "fortnightly", "anchor_date": "2026-01-01"})
    category = make_category(db_session, budget_amount=Decimal("100.00"))
    make_transaction(db_session, date(2026, 1, 5), category.id, debit=Decimal("-20.00"))
    db_session.commit()

    body = client.get("/api/pay-periods", params={"reference_date": "2026-01-05"}).json()

    assert body["configured"] is True
    assert body["frequency"] == "fortnightly"
    assert body["start_date"] == "2026-01-01"
    assert body["end_date"] == "2026-01-15"
    assert body["payday"] == "2026-01-15"  # the next period's own start
    row = next(c for c in body["categories"] if c["category_id"] == category.id)
    assert row["actual"] == "20.00"
    assert row["pace"] == str(fortnightly_pace(Decimal("100.00")))
    assert body["summary"]["total_spending"] == "20.00"


def test_get_pay_period_defaults_to_today_when_no_reference_date_given(client):

    client.put("/api/pay-schedule", json={"frequency": "fortnightly", "anchor_date": "2026-01-01"})

    response = client.get("/api/pay-periods")

    assert response.status_code == 200
    assert response.json()["configured"] is True


def test_get_pay_period_monthly_covers_the_calendar_month(client, db_session):

    client.put("/api/pay-schedule", json={"frequency": "monthly"})
    category = make_category(db_session, budget_amount=Decimal("300.00"))
    make_transaction(db_session, date(2026, 4, 10), category.id, debit=Decimal("-50.00"))
    # Outside April - must not count toward this period.
    make_transaction(db_session, date(2026, 5, 1), category.id, debit=Decimal("-999.00"))
    db_session.commit()

    body = client.get("/api/pay-periods", params={"reference_date": "2026-04-15"}).json()

    assert body["configured"] is True
    assert body["frequency"] == "monthly"
    assert body["start_date"] == "2026-04-01"
    assert body["end_date"] == "2026-05-01"
    assert body["payday"] == "2026-04-30"
    assert body["days_until_next_payday"] == 15
    row = next(c for c in body["categories"] if c["category_id"] == category.id)
    assert row["actual"] == "50.00"
    assert row["pace"] == "300.00"  # 1:1 passthrough for monthly
