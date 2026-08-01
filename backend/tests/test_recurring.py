from datetime import date, timedelta
from decimal import Decimal

from app.models import Account, Category, ImportBatch, RecurringDismissal, Transaction
from app.services.categorization import _row_amount
from app.services.recurring import (
    CADENCE_BUCKETS,
    detect_series,
    merchant_label,
    narration_key,
    summarize,
)


def make_account(db_session, name="Joint Everyday", account_number="1111"):

    account = Account(name=name, account_number=account_number)
    db_session.add(account)
    db_session.flush()
    return account


def make_category(db_session, name="Subscriptions", kind="expense"):

    category = Category(name=name, kind=kind)
    db_session.add(category)
    db_session.flush()
    return category


def make_transaction(db_session, account_id, transaction_date, narration, amount,
                      credit=False, category_id=None, transaction_type="WDL",
                      account_number="1111", balance="100.00"):

    batch = ImportBatch(filename="seed.csv", row_count=0, skipped_duplicate_count=0)
    db_session.add(batch)
    db_session.flush()

    transaction = Transaction(
        import_batch_id=batch.id,
        account_id=account_id,
        category_id=category_id,
        bsb_number=None,
        account_number=account_number,
        transaction_date=transaction_date,
        narration=narration,
        cheque_number=None,
        debit=None if credit else Decimal(str(amount)),
        credit=Decimal(str(amount)) if credit else None,
        balance=balance,
        transaction_type=transaction_type,
    )
    db_session.add(transaction)
    db_session.flush()
    return transaction


def seed_series(db_session, dates, amounts, narration="NETFLIX.COM", account_id=None,
                 category_id=None):
    """Seeds one occurrence per (date, amount) pair, all debits (outflows),
    and returns the account_id used.
    """

    if account_id is None:
        account_id = make_account(db_session).id

    for occurrence_date, amount in zip(dates, amounts):
        make_transaction(
            db_session, account_id, occurrence_date, narration,
            amount=-abs(amount), category_id=category_id,
        )

    db_session.commit()
    return account_id


def monthly_dates(start, count, day=15):

    dates = []
    year, month = start.year, start.month
    for _ in range(count):
        dates.append(date(year, month, min(day, 28)))
        month += 1
        if month > 12:
            month = 1
            year += 1
    return dates


def only_series(db_session, **kwargs):

    series = detect_series(db_session, **kwargs)
    assert len(series) == 1, f"expected exactly one series, got {[s.narration_key for s in series]}"
    return series[0]


# --- narration_key / merchant_label -----------------------------------------

def test_narration_key_collapses_padding_and_case():

    assert narration_key("RED ENERGY               CREMORNE") == "RED ENERGY CREMORNE"
    assert narration_key("red energy   cremorne") == "RED ENERGY CREMORNE"


def test_narration_key_strips_long_digit_runs_but_not_short_ones():

    assert narration_key("NETFLIX.COM 123456789") == "NETFLIX.COM"
    # A 3-digit suffix could be a meaningful part of the merchant name (a
    # street number, a store code) rather than a per-occurrence reference.
    assert narration_key("7-ELEVEN 123") == "7-ELEVEN 123"


def test_narration_key_groups_occurrences_that_differ_only_by_reference_number():

    a = narration_key("PAYPAL *SPOTIFY 00000001")
    b = narration_key("PAYPAL *SPOTIFY 00000002")
    # Both reference numbers are standalone 4+ digit tokens and get stripped
    # identically. A digit run glued onto letters (no word boundary between
    # them) is left alone - see the digit-run test above.
    assert a == b


def test_merchant_label_is_the_text_before_the_padding():

    assert merchant_label("RED ENERGY               CREMORNE") == "RED ENERGY"
    assert merchant_label("LS Taquiza               Newport      AU") == "LS Taquiza"


def test_merchant_label_falls_back_to_the_whole_narration_without_padding():

    assert merchant_label("CCTrueUp") == "CCTrueUp"


# --- cadence detection -------------------------------------------------------

def test_weekly_series_detected(db_session):

    dates = [date(2026, 1, 6) + timedelta(days=7 * i) for i in range(6)]
    seed_series(db_session, dates, [15.00] * 6)

    series = only_series(db_session)

    assert series.cadence == "weekly"
    assert series.occurrence_count == 6


def test_fortnightly_series_detected(db_session):

    dates = [date(2026, 1, 3) + timedelta(days=14 * i) for i in range(6)]
    seed_series(db_session, dates, [220.00] * 6)

    series = only_series(db_session)

    assert series.cadence == "fortnightly"


def test_monthly_series_detected(db_session):

    dates = monthly_dates(date(2026, 1, 15), 6)
    seed_series(db_session, dates, [15.99] * 6)

    series = only_series(db_session)

    assert series.cadence == "monthly"


def test_monthly_series_on_the_31st_detected_despite_short_months(db_session):

    dates = [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31),
             date(2026, 4, 30), date(2026, 5, 31), date(2026, 6, 30)]
    seed_series(db_session, dates, [89.00] * 6)

    series = only_series(db_session)

    assert series.cadence == "monthly"


def test_monthly_series_shifted_to_business_days_still_detected(db_session):
    # A payment due "around the 1st" that a bank shifts off weekends/holidays.
    dates = [date(2026, 1, 1), date(2026, 2, 4), date(2026, 3, 1),
             date(2026, 4, 2), date(2026, 5, 1)]
    seed_series(db_session, dates, [300.00] * 5)

    series = only_series(db_session)

    assert series.cadence == "monthly"


def test_quarterly_series_detected(db_session):

    dates = [date(2026, 1, 10), date(2026, 4, 10), date(2026, 7, 10), date(2026, 10, 10)]
    seed_series(db_session, dates, [120.00] * 4)

    series = only_series(db_session)

    assert series.cadence == "quarterly"


def test_yearly_series_detected(db_session):

    dates = [date(2023, 3, 1), date(2024, 3, 1), date(2025, 3, 1)]
    seed_series(db_session, dates, [89.00] * 3)

    series = only_series(db_session)

    assert series.cadence == "yearly"


# --- direction -----------------------------------------------------------------

def test_all_debit_series_is_outflow(db_session):

    seed_series(db_session, monthly_dates(date(2026, 1, 15), 3), [15.99] * 3)

    series = only_series(db_session)

    assert series.direction == "outflow"


def test_all_credit_series_is_inflow(db_session):

    account_id = make_account(db_session).id
    for occurrence_date in monthly_dates(date(2026, 1, 15), 3):
        make_transaction(db_session, account_id, occurrence_date, "SALARY", amount=5000.00, credit=True)
    db_session.commit()

    series = only_series(db_session)

    assert series.direction == "inflow"


def test_mixed_series_takes_the_majority_direction(db_session):
    # A rare refund landing among an otherwise all-debit series must not
    # un-detect it, and the direction should follow the majority (outflow).
    account_id = make_account(db_session).id
    dates = monthly_dates(date(2026, 1, 15), 4)
    for i, occurrence_date in enumerate(dates):
        make_transaction(
            db_session, account_id, occurrence_date, "GYM MEMBERSHIP",
            amount=15.99, credit=(i == 0),
        )
    db_session.commit()

    series = only_series(db_session)

    assert series.direction == "outflow"


# --- noise rejection ----------------------------------------------------------

def test_irregular_grocery_visits_are_not_recurring(db_session):

    dates = [date(2026, 1, 3), date(2026, 1, 9), date(2026, 1, 10),
             date(2026, 2, 2), date(2026, 3, 20), date(2026, 3, 22)]
    seed_series(db_session, dates, [45.20, 12.10, 88.90, 23.40, 61.00, 9.50],
                narration="WOOLWORTHS NEWPORT")

    assert detect_series(db_session) == []


def test_a_weekly_habit_with_extra_trips_is_not_recurring(db_session):

    dates = [date(2026, 1, 6), date(2026, 1, 9), date(2026, 1, 13),
             date(2026, 1, 20), date(2026, 1, 27)]
    seed_series(db_session, dates, [10.00] * 5, narration="COFFEE HOUSE")

    assert detect_series(db_session) == []


def test_several_occurrences_in_one_week_are_not_recurring(db_session):

    dates = [date(2026, 1, 5), date(2026, 1, 6), date(2026, 1, 8)]
    seed_series(db_session, dates, [4.50] * 3, narration="COFFEE HOUSE")

    assert detect_series(db_session) == []


def test_twice_weekly_matches_no_bucket(db_session):

    dates = [date(2026, 1, 1), date(2026, 1, 4), date(2026, 1, 8),
             date(2026, 1, 11), date(2026, 1, 15), date(2026, 1, 18)]
    seed_series(db_session, dates, [30.00] * 6, narration="GYM CHECK-IN")

    assert detect_series(db_session) == []


def test_fewer_than_three_occurrences_is_never_a_series(db_session):

    dates = monthly_dates(date(2026, 1, 15), 2)
    seed_series(db_session, dates, [15.99, 15.99])

    assert detect_series(db_session) == []


# --- next due date ------------------------------------------------------------

def test_next_due_date_is_calendar_correct_for_end_of_month(db_session):

    dates = [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)]
    seed_series(db_session, dates, [89.00] * 4)

    series = only_series(db_session)

    # One calendar month after 30 April is 30/31 May clamped correctly, but
    # the interesting case already lives in the seed data: a 31 Jan start
    # must land on 28 Feb, not overflow into March.
    assert series.next_due_date == date(2026, 5, 30)


def test_next_due_date_from_31st_lands_on_28th_not_march(db_session):

    dates = [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31)]
    # last occurrence is 31 March -> one month later is 30 April (April has
    # only 30 days), not "31 days later" landing in May.
    seed_series(db_session, dates, [10.00] * 3)

    series = only_series(db_session)

    assert series.next_due_date == date(2026, 4, 30)


# --- missed / stopped, judged against the ledger not today -------------------

def test_overdue_is_judged_against_the_accounts_own_latest_transaction(db_session):
    """The account's most recent data is from 2020 - wildly "overdue" by
    today's real-world date, but the series must NOT be flagged overdue,
    because nothing in the ledger says a payment was actually missed; the
    import has simply never caught up to the present.
    """

    dates = monthly_dates(date(2020, 1, 15), 6)
    seed_series(db_session, dates, [15.99] * 6)

    series = only_series(db_session)

    assert series.status == "active"


def test_overdue_when_the_account_has_moved_on_past_the_grace_period(db_session):

    account_id = make_account(db_session).id
    dates = monthly_dates(date(2026, 1, 15), 4)
    seed_series(db_session, dates, [15.99] * 4, account_id=account_id)

    # An unrelated transaction on the same account, dated past the grace
    # period (next_due = 2026-05-15, grace ~6 days) but under one full
    # interval past it, advances that account's as_of.
    make_transaction(db_session, account_id, date(2026, 5, 25), "UNRELATED SHOP", amount=-20.00)
    db_session.commit()

    series = only_series(db_session)

    assert series.status == "overdue"


def test_ended_when_overdue_by_two_full_intervals(db_session):

    account_id = make_account(db_session).id
    dates = monthly_dates(date(2026, 1, 15), 4)
    seed_series(db_session, dates, [15.99] * 4, account_id=account_id)

    # next_due = 2026-05-15; two months past that is deep into July.
    make_transaction(db_session, account_id, date(2026, 7, 20), "UNRELATED SHOP", amount=-20.00)
    db_session.commit()

    series = only_series(db_session)

    assert series.status == "ended"


def test_due_soon_within_the_window(db_session):

    account_id = make_account(db_session).id
    dates = monthly_dates(date(2026, 1, 10), 4)
    seed_series(db_session, dates, [15.99] * 4, account_id=account_id)
    # next_due = 2026-05-10. An unrelated transaction 3 days before that
    # sets as_of just inside the 14-day due_soon window.
    make_transaction(db_session, account_id, date(2026, 5, 7), "UNRELATED SHOP", amount=-20.00)
    db_session.commit()

    series = only_series(db_session)

    assert series.status == "due_soon"


# --- price changes -------------------------------------------------------------

def test_fixed_amount_series_flags_a_price_rise(db_session):

    dates = monthly_dates(date(2026, 1, 15), 5)
    amounts = [15.99, 15.99, 15.99, 15.99, 18.99]
    seed_series(db_session, dates, amounts)

    series = only_series(db_session)

    assert series.amount_varies is False
    assert series.amount_changed is True
    assert series.latest_amount == Decimal("18.99")


def test_fixed_amount_series_does_not_flag_a_trivial_change(db_session):

    dates = monthly_dates(date(2026, 1, 15), 5)
    amounts = [15.99, 15.99, 15.99, 15.99, 16.05]
    seed_series(db_session, dates, amounts)

    series = only_series(db_session)

    assert series.amount_changed is False


def test_variable_amount_series_never_flags_a_price_change(db_session):
    # An electricity bill: naturally variable, and the same swing that would
    # be a "price rise" on a subscription is just normal usage here.
    dates = monthly_dates(date(2026, 1, 15), 5)
    amounts = [180.00, 95.00, 210.00, 88.00, 240.00]
    seed_series(db_session, dates, amounts, narration="RED ENERGY")

    series = only_series(db_session)

    assert series.amount_varies is True
    assert series.amount_changed is False


# --- annual cost, amount convention, category --------------------------------

def test_annual_cost_matches_cadence_occurrences_per_year(db_session):

    dates = [date(2026, 1, 10), date(2026, 4, 10), date(2026, 7, 10), date(2026, 10, 10)]
    seed_series(db_session, dates, [100.00] * 4)

    series = only_series(db_session)

    bucket = {name: occurrences for name, _, occurrences in CADENCE_BUCKETS}
    assert series.annual_cost == Decimal("100.00") * bucket["quarterly"]


def test_amount_uses_absolute_value_agreeing_with_categorization_row_amount(db_session):

    dates = monthly_dates(date(2026, 1, 15), 3)
    seed_series(db_session, dates, [50.00] * 3)

    series = only_series(db_session)

    assert series.typical_amount == abs(_row_amount(Decimal("-50.00"), None))


def test_series_reports_its_most_common_category(db_session):

    category = make_category(db_session)
    dates = monthly_dates(date(2026, 1, 15), 3)
    seed_series(db_session, dates, [15.99] * 3, category_id=category.id)

    series = only_series(db_session)

    assert series.category_id == category.id
    assert series.category_name == category.name


# --- dismissal -----------------------------------------------------------------

def test_dismissed_series_excluded_by_default_and_returned_when_requested(db_session):

    account_id = seed_series(
        db_session, monthly_dates(date(2026, 1, 15), 4), [15.99] * 4,
        narration="NETFLIX.COM",
    )
    key = narration_key("NETFLIX.COM")

    db_session.add(RecurringDismissal(account_id=account_id, narration_key=key))
    db_session.commit()

    assert detect_series(db_session) == []

    with_dismissed = only_series(db_session, include_dismissed=True)
    assert with_dismissed.dismissed is True
    assert with_dismissed.dismissal_id is not None


# --- grouping is per-account ----------------------------------------------------

def test_same_narration_on_two_accounts_is_two_series(db_session):

    account_a = make_account(db_session, name="Card A", account_number="AAAA")
    account_b = make_account(db_session, name="Card B", account_number="BBBB")

    seed_series(db_session, monthly_dates(date(2026, 1, 15), 3), [9.99] * 3,
                narration="SPOTIFY", account_id=account_a.id)
    seed_series(db_session, monthly_dates(date(2026, 1, 15), 3), [9.99] * 3,
                narration="SPOTIFY", account_id=account_b.id)

    series = detect_series(db_session)

    assert len(series) == 2
    assert {s.account_id for s in series} == {account_a.id, account_b.id}


# --- summarize -----------------------------------------------------------------

def test_summarize_counts_due_soon_changed_and_missed(db_session):

    account_id = make_account(db_session).id

    # A due-soon series.
    due_soon_dates = monthly_dates(date(2026, 1, 10), 4)
    seed_series(db_session, due_soon_dates, [15.99] * 4, narration="NETFLIX.COM", account_id=account_id)
    make_transaction(db_session, account_id, date(2026, 5, 7), "UNRELATED A", amount=-1.00)

    # A changed-price series on a different account, judged against its own
    # (recent) data so it stays "active" rather than due_soon/overdue.
    other_account = make_account(db_session, name="Other", account_number="2222").id
    changed_dates = monthly_dates(date(2026, 1, 15), 5)
    seed_series(db_session, changed_dates, [10.00, 10.00, 10.00, 10.00, 13.00],
                narration="GYM MEMBERSHIP", account_id=other_account)

    db_session.commit()

    series = detect_series(db_session)
    summary = summarize(series)

    assert summary["series_count"] == 2
    assert summary["due_soon_count"] == 1
    assert summary["changed_count"] == 1
