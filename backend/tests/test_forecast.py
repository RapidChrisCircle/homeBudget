from datetime import date, timedelta
from decimal import Decimal

from app.models import RecurringDismissal
from app.services.forecast import daily_run_rates, forecast_periods, project
from app.services.recurring import detect_series, narration_key
from test_recurring import make_account, make_category, make_transaction, monthly_dates, seed_series


def test_forecast_periods_marks_only_the_first_bucket_partial():

    periods = forecast_periods(date(2026, 7, 15), months=3)

    assert periods == [(2026, 7, True), (2026, 8, False), (2026, 9, False), (2026, 10, False)]


def test_forecast_periods_end_of_month_edge_case():

    periods = forecast_periods(date(2026, 1, 31), months=2)

    assert periods == [(2026, 1, True), (2026, 2, False), (2026, 3, False)]


# --- daily_run_rates: the double-counting guard --------------------------------

def test_run_rate_excludes_recurring_and_counts_only_irregular_spending(db_session):
    # A monthly subscription in Jan/Feb/Mar, PLUS irregular (non-recurring)
    # spending in the same three months. as_of lands in April via a separate
    # transaction, so the 3-month lookback is exactly Jan-Mar.
    account_id = seed_series(
        db_session, monthly_dates(date(2026, 1, 15), 3), [20.00] * 3, narration="NETFLIX.COM"
    )
    # Irregular spending: different narrations/dates/amounts, no cadence.
    make_transaction(db_session, account_id, date(2026, 1, 3), "IGA NEWPORT", amount=-100.00)
    make_transaction(db_session, account_id, date(2026, 2, 20), "IGA NEWPORT", amount=-80.00)
    make_transaction(db_session, account_id, date(2026, 3, 9), "IGA NEWPORT", amount=-120.00)
    # Anchors as_of in April, outside the lookback window.
    make_transaction(db_session, account_id, date(2026, 4, 20), "COFFEE HOUSE", amount=-4.50)
    db_session.commit()

    series = detect_series(db_session)
    rates = daily_run_rates(db_session, date(2026, 4, 20), series)

    window_days = (date(2026, 4, 1) - date(2026, 1, 1)).days  # 90
    expected_total = Decimal("-100.00") + Decimal("-80.00") + Decimal("-120.00")
    assert rates[account_id] == expected_total / window_days


def test_run_rate_excludes_the_as_of_month_itself(db_session):
    # A large debit ON as_of's own month must not count - that month is
    # incomplete, and its partial total would skew a rate meant to represent
    # a whole month.
    account_id = make_account(db_session).id
    make_transaction(db_session, account_id, date(2026, 1, 10), "IGA NEWPORT", amount=-50.00)
    make_transaction(db_session, account_id, date(2026, 4, 5), "HUGE ONE-OFF", amount=-9999.00)
    db_session.commit()

    rates = daily_run_rates(db_session, date(2026, 4, 5), [])

    window_days = (date(2026, 4, 1) - date(2026, 1, 1)).days
    assert rates[account_id] == Decimal("-50.00") / window_days


def test_run_rate_counts_uncategorized_transactions(db_session):
    # Deliberate divergence from reporting.py, which excludes uncategorized
    # rows from every total - a forecast is about cash leaving the account,
    # not about categorized totals, so omitting these would understate spend.
    account_id = make_account(db_session).id
    make_transaction(db_session, account_id, date(2026, 1, 10), "UNKNOWN MERCHANT", amount=-75.00, category_id=None)
    make_transaction(db_session, account_id, date(2026, 4, 5), "COFFEE", amount=-4.00)
    db_session.commit()

    rates = daily_run_rates(db_session, date(2026, 4, 5), [])

    window_days = (date(2026, 4, 1) - date(2026, 1, 1)).days
    assert rates[account_id] == Decimal("-75.00") / window_days


def test_run_rate_counts_transfer_category_transactions(db_session):
    # Deliberate divergence from reporting.py, which excludes transfer-kind
    # categories - a credit card payment genuinely reduces the paying
    # account's balance, which is exactly what cash flow needs to reflect.
    transfers = make_category(db_session, name="Transfers", kind="transfer")
    account_id = make_account(db_session).id
    make_transaction(db_session, account_id, date(2026, 1, 10), "CCTrueUp", amount=-500.00, category_id=transfers.id)
    make_transaction(db_session, account_id, date(2026, 4, 5), "COFFEE", amount=-4.00)
    db_session.commit()

    rates = daily_run_rates(db_session, date(2026, 4, 5), [])

    window_days = (date(2026, 4, 1) - date(2026, 1, 1)).days
    assert rates[account_id] == Decimal("-500.00") / window_days


def test_run_rate_reincludes_a_dismissed_series(db_session):
    # A dismissal is the user's own declaration that a pattern is NOT
    # actually recurring - its transactions belong back in "everyday"
    # spending, not excluded as if still counted as a commitment.
    account_id = seed_series(
        db_session, monthly_dates(date(2026, 1, 15), 3), [20.00] * 3, narration="NETFLIX.COM"
    )
    make_transaction(db_session, account_id, date(2026, 4, 20), "COFFEE HOUSE", amount=-4.50)
    db_session.commit()

    db_session.add(RecurringDismissal(account_id=account_id, narration_key=narration_key("NETFLIX.COM")))
    db_session.commit()

    series = detect_series(db_session)  # dismissed excluded by default
    assert series == []  # confirms the dismissal actually took effect

    rates = daily_run_rates(db_session, date(2026, 4, 20), series)

    window_days = (date(2026, 4, 1) - date(2026, 1, 1)).days
    expected_total = Decimal("-20.00") * 3
    assert rates[account_id] == expected_total / window_days


# --- project(): bucket arithmetic -----------------------------------------------

def test_partial_bucket_prorates_the_run_rate_over_remaining_days_only(db_session):
    account_id = make_account(db_session).id
    # Steady -10/day for three whole months, then the anchor on the 20th.
    for i in range(90):
        make_transaction(
            db_session, account_id, date(2026, 1, 1) + timedelta(days=i),
            f"DAILY {i}", amount=-10.00,
        )
    make_transaction(db_session, account_id, date(2026, 4, 20), "ANCHOR", amount=-1.00)
    db_session.commit()

    result = project(db_session, months=1)
    account = next(a for a in result["accounts"] if a["account_id"] == account_id)
    partial_month = account["months"][0]
    whole_month = account["months"][1]

    assert partial_month["is_partial"] is True
    assert whole_month["is_partial"] is False

    # April has 30 days; from the 20th (inclusive) to month end is 11 days.
    days_remaining = (date(2026, 5, 1) - date(2026, 4, 20)).days
    assert days_remaining == 11
    expected_partial_other = (account["daily_run_rate"] * days_remaining).quantize(Decimal("0.01"))
    assert partial_month["estimated_other"] == expected_partial_other

    # May is a whole month (31 days).
    expected_whole_other = (account["daily_run_rate"] * 31).quantize(Decimal("0.01"))
    assert whole_month["estimated_other"] == expected_whole_other


def test_closing_balance_carries_forward_as_the_next_opening(db_session):
    account_id = seed_series(
        db_session, monthly_dates(date(2026, 1, 15), 4), [50.00] * 4, narration="GYM"
    )
    db_session.commit()

    result = project(db_session, months=3)
    account = next(a for a in result["accounts"] if a["account_id"] == account_id)

    for i in range(len(account["months"]) - 1):
        assert account["months"][i]["closing"] == account["months"][i + 1]["opening"]


def test_combined_equals_the_sum_of_per_account_lines(db_session):
    account_a = make_account(db_session, name="A", account_number="AAAA").id
    account_b = make_account(db_session, name="B", account_number="BBBB").id
    make_transaction(db_session, account_a, date(2026, 4, 10), "COFFEE", amount=-5.00, account_number="AAAA")
    make_transaction(db_session, account_b, date(2026, 4, 12), "SALARY", amount=3000.00, credit=True, account_number="BBBB")
    db_session.commit()

    result = project(db_session, months=2)

    for i in range(len(result["periods"])):
        expected_closing = sum(
            (a["months"][i]["closing"] for a in result["accounts"]), Decimal("0")
        )
        assert result["combined"]["months"][i]["closing"] == expected_closing


def test_an_overdue_series_contributes_its_next_occurrence_not_a_stale_one(db_session):
    # Last occurrence in January; nothing since, and as_of is 15 days past
    # next_due_date (2026-04-15) - past the ~6-day grace, so genuinely
    # OVERDUE. Its next contribution must be a future date, not the
    # already-passed next_due_date.
    account_id = seed_series(
        db_session, monthly_dates(date(2026, 1, 15), 3), [50.00] * 3, narration="RENT"
    )
    make_transaction(db_session, account_id, date(2026, 4, 30), "COFFEE", amount=-4.00)
    db_session.commit()

    series = detect_series(db_session)
    rent = next(s for s in series if s.narration_key == "RENT")
    assert rent.status == "overdue"

    result = project(db_session, months=3)
    for entry in result["upcoming"]:
        if entry["merchant"] == "RENT":
            assert entry["due_date"] >= date(2026, 4, 30)


def test_an_ended_series_contributes_nothing(db_session):
    account_id = seed_series(
        db_session, monthly_dates(date(2026, 1, 15), 3), [50.00] * 3, narration="OLD SUBSCRIPTION"
    )
    # Two full intervals past next_due_date (2026-04-15) is "ended".
    make_transaction(db_session, account_id, date(2026, 7, 20), "COFFEE", amount=-4.00)
    db_session.commit()

    series = detect_series(db_session)
    old_sub = next(s for s in series if s.narration_key == "OLD SUBSCRIPTION")
    assert old_sub.status == "ended"

    result = project(db_session, months=3)
    assert all(e["merchant"] != "OLD SUBSCRIPTION" for e in result["upcoming"])


def test_a_dismissed_series_contributes_nothing_to_upcoming(db_session):
    from app.models import RecurringDismissal

    account_id = seed_series(
        db_session, monthly_dates(date(2026, 1, 15), 3), [20.00] * 3, narration="NETFLIX.COM"
    )
    make_transaction(db_session, account_id, date(2026, 4, 20), "COFFEE", amount=-4.00)
    db_session.add(RecurringDismissal(account_id=account_id, narration_key=narration_key("NETFLIX.COM")))
    db_session.commit()

    result = project(db_session, months=3)

    assert all(e["merchant"] != "NETFLIX.COM" for e in result["upcoming"])


def test_inflow_raises_and_outflow_lowers_the_projected_balance(db_session):
    account_id = make_account(db_session).id
    # 3 occurrences (Jan/Feb/Mar 15th) -> next_due_date 2026-04-15. Anchoring
    # as_of on the 10th (before that date) puts the next occurrence inside
    # the partial April bucket being checked below.
    for occurrence_date in monthly_dates(date(2026, 1, 15), 3):
        make_transaction(db_session, account_id, occurrence_date, "SALARY", amount=3000.00, credit=True)
    make_transaction(db_session, account_id, date(2026, 4, 10), "COFFEE", amount=-4.00)
    db_session.commit()

    series = detect_series(db_session)
    salary = next(s for s in series if s.narration_key == "SALARY")
    assert salary.direction == "inflow"

    result = project(db_session, months=1)
    account = next(a for a in result["accounts"] if a["account_id"] == account_id)

    assert account["months"][0]["recurring_in"] > Decimal("0")
    assert account["months"][0]["recurring_out"] == Decimal("0")
    assert account["months"][0]["closing"] > account["months"][0]["opening"]


def test_account_with_no_transactions_is_absent_from_the_forecast(db_session):
    make_account(db_session, name="Empty", account_number="9999")
    account_id = make_account(db_session, name="Active", account_number="1111").id
    make_transaction(db_session, account_id, date(2026, 4, 20), "COFFEE", amount=-4.00)
    db_session.commit()

    result = project(db_session, months=1)

    assert len(result["accounts"]) == 1
    assert result["accounts"][0]["account_id"] == account_id


def test_empty_ledger_returns_empty_forecast_not_an_error(db_session):

    result = project(db_session, months=3)

    assert result == {"as_of": None, "periods": [], "accounts": [], "combined": None, "upcoming": []}
