from datetime import date
from decimal import Decimal

from app.models import Account, Category, ImportBatch, Transaction, TransactionSplit
from app.services.dashboard_metrics import dashboard_kpis, daily_activity


def make_category(db_session, name="Groceries", kind="expense"):

    category = Category(name=name, kind=kind)
    db_session.add(category)
    db_session.flush()
    return category


def make_transaction(db_session, transaction_date=date(2026, 7, 10), narration="Coffee",
                     debit=None, credit=None, category_id=None, account_number="1111"):

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
        transaction_type="WDL" if debit is not None else "DEP",
    )
    db_session.add(transaction)
    db_session.flush()
    return transaction


def make_account(db_session, name="Everyday", account_type="everyday", account_number="1111"):

    account = Account(name=name, account_type=account_type, account_number=account_number)
    db_session.add(account)
    db_session.flush()
    return account


# --- dashboard_kpis (service) -----------------------------------------------

def test_kpis_sums_income_and_expenses_across_the_window(db_session):

    groceries = make_category(db_session, "Groceries", "expense")
    salary = make_category(db_session, "Salary", "income")

    make_transaction(db_session, date(2026, 6, 5), debit=Decimal("-40.00"), category_id=groceries.id)
    make_transaction(db_session, date(2026, 7, 10), debit=Decimal("-60.00"), category_id=groceries.id)
    make_transaction(db_session, date(2026, 7, 15), credit=Decimal("5000.00"), category_id=salary.id)
    db_session.commit()

    kpis = dashboard_kpis(db_session, 2026, 7, months=2)

    assert kpis["total_expenses"] == Decimal("100.00")
    assert kpis["total_income"] == Decimal("5000.00")
    assert kpis["net_saved"] == Decimal("4900.00")
    assert len(kpis["periods"]) == 2


def test_kpis_avg_per_month_divides_total_expenses_by_the_window_length(db_session):

    groceries = make_category(db_session, "Groceries", "expense")
    make_transaction(db_session, date(2026, 7, 10), debit=Decimal("-90.00"), category_id=groceries.id)
    db_session.commit()

    kpis = dashboard_kpis(db_session, 2026, 7, months=3)

    assert kpis["avg_per_month"] == Decimal("30.00")


def test_kpis_avg_per_transaction_counts_distinct_transactions_not_allocations(db_session):
    """A split transaction's several allocations must count as the ONE
    transaction they belong to - otherwise a split grocery run would
    inflate the average relative to an unsplit one of the same size.
    """

    groceries = make_category(db_session, "Groceries", "expense")
    alcohol = make_category(db_session, "Alcohol", "expense")

    make_transaction(db_session, date(2026, 7, 5), debit=Decimal("-100.00"), category_id=groceries.id)

    split_transaction = make_transaction(db_session, date(2026, 7, 10), debit=Decimal("-100.00"))
    db_session.add(TransactionSplit(transaction_id=split_transaction.id, category_id=groceries.id, amount=Decimal("-60.00")))
    db_session.add(TransactionSplit(transaction_id=split_transaction.id, category_id=alcohol.id, amount=Decimal("-40.00")))
    db_session.commit()

    kpis = dashboard_kpis(db_session, 2026, 7, months=1)

    assert kpis["transaction_count"] == 2
    assert kpis["total_expenses"] == Decimal("200.00")
    assert kpis["avg_per_transaction"] == Decimal("100.00")


def test_kpis_avg_per_transaction_is_none_not_zero_with_no_expenses(db_session):
    """No expense transactions means there is no "typical size" of a thing
    that never happened - None, the same "no data isn't zero" rule an
    account's null balance already follows.
    """

    salary = make_category(db_session, "Salary", "income")
    make_transaction(db_session, date(2026, 7, 15), credit=Decimal("5000.00"), category_id=salary.id)
    db_session.commit()

    kpis = dashboard_kpis(db_session, 2026, 7, months=1)

    assert kpis["transaction_count"] == 0
    assert kpis["avg_per_transaction"] is None


def test_kpis_excludes_transfers(db_session):

    transfer = make_category(db_session, "CC Payment", "transfer")
    make_transaction(db_session, date(2026, 7, 5), debit=Decimal("-500.00"), category_id=transfer.id)
    db_session.commit()

    kpis = dashboard_kpis(db_session, 2026, 7, months=1)

    assert kpis["total_expenses"] == Decimal("0")
    assert kpis["transaction_count"] == 0


# --- savings_rate ------------------------------------------------------------------


def test_kpis_savings_rate_is_net_saved_over_total_income(db_session):

    salary = make_category(db_session, "Salary", "income")
    groceries = make_category(db_session, "Groceries", "expense")
    make_transaction(db_session, date(2026, 7, 1), credit=Decimal("5000.00"), category_id=salary.id)
    make_transaction(db_session, date(2026, 7, 10), debit=Decimal("-1000.00"), category_id=groceries.id)
    db_session.commit()

    kpis = dashboard_kpis(db_session, 2026, 7, months=1)

    # (5000 - 1000) / 5000
    assert kpis["savings_rate"] == Decimal("0.8")


def test_kpis_savings_rate_is_none_not_zero_with_no_income(db_session):
    """You cannot save a percentage of income you didn't have - a household
    living entirely off savings that month has no rate to report, not a
    rate of negative infinity."""

    groceries = make_category(db_session, "Groceries", "expense")
    make_transaction(db_session, date(2026, 7, 10), debit=Decimal("-100.00"), category_id=groceries.id)
    db_session.commit()

    kpis = dashboard_kpis(db_session, 2026, 7, months=1)

    assert kpis["savings_rate"] is None


def test_kpis_savings_rate_can_be_negative_when_spending_exceeds_income(db_session):

    salary = make_category(db_session, "Salary", "income")
    groceries = make_category(db_session, "Groceries", "expense")
    make_transaction(db_session, date(2026, 7, 1), credit=Decimal("1000.00"), category_id=salary.id)
    make_transaction(db_session, date(2026, 7, 10), debit=Decimal("-1500.00"), category_id=groceries.id)
    db_session.commit()

    kpis = dashboard_kpis(db_session, 2026, 7, months=1)

    assert kpis["savings_rate"] == Decimal("-0.5")


def test_kpis_savings_rate_on_a_completely_empty_ledger_is_none(db_session):

    kpis = dashboard_kpis(db_session, 2026, 7, months=1)

    assert kpis["savings_rate"] is None


# --- runway_months -------------------------------------------------------------------


def test_kpis_runway_months_divides_liquid_assets_by_avg_per_month(db_session):

    account = make_account(db_session)
    groceries = make_category(db_session, "Groceries", "expense")
    transaction = make_transaction(db_session, date(2026, 7, 10), debit=Decimal("-1000.00"), category_id=groceries.id)
    transaction.account_id = account.id
    transaction.balance = Decimal("4000.00")
    db_session.commit()

    kpis = dashboard_kpis(db_session, 2026, 7, months=1)

    # avg_per_month here is 1000.00 (one month window); 4000 liquid / 1000 = 4
    assert kpis["avg_per_month"] == Decimal("1000.00")
    assert kpis["runway_months"] == Decimal("4")


def test_kpis_runway_months_is_none_not_zero_with_no_expenses(db_session):
    """Dividing by a zero average monthly spend has no sensible answer -
    None, not "infinite runway" and not zero."""

    account = make_account(db_session)
    salary = make_category(db_session, "Salary", "income")
    transaction = make_transaction(db_session, date(2026, 7, 1), credit=Decimal("5000.00"), category_id=salary.id)
    transaction.account_id = account.id
    transaction.balance = Decimal("5000.00")
    db_session.commit()

    kpis = dashboard_kpis(db_session, 2026, 7, months=1)

    assert kpis["avg_per_month"] == Decimal("0")
    assert kpis["runway_months"] is None


def test_kpis_runway_months_is_zero_with_expenses_but_no_liquid_assets(db_session):

    groceries = make_category(db_session, "Groceries", "expense")
    make_transaction(db_session, date(2026, 7, 10), debit=Decimal("-500.00"), category_id=groceries.id)
    db_session.commit()

    kpis = dashboard_kpis(db_session, 2026, 7, months=1)

    assert kpis["runway_months"] == Decimal("0")


def test_kpis_agrees_with_trends_own_totals_for_the_same_window(db_session):
    """Built on category_grid/monthly_summaries rather than a second
    independent aggregation - this is the equivalence that guarantees it,
    the same property test_trends.py asserts for /trends vs /reports.
    """

    from app.services.reporting import category_grid
    from app.services.trends import monthly_summaries

    groceries = make_category(db_session, "Groceries", "expense")
    salary = make_category(db_session, "Salary", "income")
    make_transaction(db_session, date(2026, 7, 10), debit=Decimal("-60.00"), category_id=groceries.id)
    make_transaction(db_session, date(2026, 7, 15), credit=Decimal("5000.00"), category_id=salary.id)
    db_session.commit()

    kpis = dashboard_kpis(db_session, 2026, 7, months=1)

    periods, grid_rows = category_grid(db_session, 2026, 7, months=1)
    expected = monthly_summaries(periods, grid_rows)[0]

    assert kpis["total_income"] == expected["total_income"]
    assert kpis["total_expenses"] == expected["total_spending"]


# --- daily_activity (service) -----------------------------------------------

def test_daily_activity_groups_by_day_with_positive_magnitudes(db_session):

    groceries = make_category(db_session, "Groceries", "expense")
    salary = make_category(db_session, "Salary", "income")
    make_transaction(db_session, date(2026, 7, 5), debit=Decimal("-40.00"), category_id=groceries.id)
    make_transaction(db_session, date(2026, 7, 5), debit=Decimal("-10.00"), category_id=groceries.id)
    make_transaction(db_session, date(2026, 7, 8), credit=Decimal("2000.00"), category_id=salary.id)
    db_session.commit()

    rows = daily_activity(db_session, date(2026, 7, 1), date(2026, 8, 1))

    by_date = {row["date"]: row for row in rows}
    assert by_date[date(2026, 7, 5)]["total_out"] == Decimal("50.00")
    assert by_date[date(2026, 7, 5)]["total_in"] == Decimal("0")
    assert by_date[date(2026, 7, 5)]["count"] == 2
    assert by_date[date(2026, 7, 8)]["total_in"] == Decimal("2000.00")


def test_daily_activity_counts_a_split_transaction_once(db_session):

    groceries = make_category(db_session, "Groceries", "expense")
    alcohol = make_category(db_session, "Alcohol", "expense")
    transaction = make_transaction(db_session, date(2026, 7, 5), debit=Decimal("-100.00"))
    db_session.add(TransactionSplit(transaction_id=transaction.id, category_id=groceries.id, amount=Decimal("-60.00")))
    db_session.add(TransactionSplit(transaction_id=transaction.id, category_id=alcohol.id, amount=Decimal("-40.00")))
    db_session.commit()

    rows = daily_activity(db_session, date(2026, 7, 1), date(2026, 8, 1))

    assert len(rows) == 1
    assert rows[0]["count"] == 1
    assert rows[0]["total_out"] == Decimal("100.00")


def test_daily_activity_excludes_transfers(db_session):

    transfer = make_category(db_session, "CC Payment", "transfer")
    make_transaction(db_session, date(2026, 7, 5), debit=Decimal("-500.00"), category_id=transfer.id)
    db_session.commit()

    rows = daily_activity(db_session, date(2026, 7, 1), date(2026, 8, 1))

    assert rows == []


def test_daily_activity_excludes_uncategorized_transactions(db_session):
    """Matches the Dashboard's existing Cash Flow chart, itself sourced
    from category_grid - both only ever reflect categorized activity.
    """

    make_transaction(db_session, date(2026, 7, 5), debit=Decimal("-500.00"), category_id=None)
    db_session.commit()

    rows = daily_activity(db_session, date(2026, 7, 1), date(2026, 8, 1))

    assert rows == []


def test_daily_activity_produces_no_row_for_a_day_with_no_activity(db_session):

    groceries = make_category(db_session, "Groceries", "expense")
    make_transaction(db_session, date(2026, 7, 5), debit=Decimal("-40.00"), category_id=groceries.id)
    db_session.commit()

    rows = daily_activity(db_session, date(2026, 7, 1), date(2026, 7, 10))

    assert len(rows) == 1
    assert rows[0]["date"] == date(2026, 7, 5)


def test_daily_activity_respects_the_half_open_end_bound(db_session):

    groceries = make_category(db_session, "Groceries", "expense")
    make_transaction(db_session, date(2026, 8, 1), debit=Decimal("-40.00"), category_id=groceries.id)
    db_session.commit()

    rows = daily_activity(db_session, date(2026, 7, 1), date(2026, 8, 1))

    assert rows == []


# --- API: GET /reports/kpis --------------------------------------------------

def test_kpis_endpoint_shape(client, db_session):

    groceries = make_category(db_session, "Groceries", "expense")
    make_transaction(db_session, date(2026, 7, 10), debit=Decimal("-60.00"), category_id=groceries.id)
    db_session.commit()

    response = client.get("/api/reports/kpis", params={"year": 2026, "month": 7, "months": 1})

    assert response.status_code == 200
    body = response.json()
    assert body["total_expenses"] == "60.00"
    assert body["transaction_count"] == 1
    assert len(body["periods"]) == 1
    assert body["periods"][0]["label"] == "2026-07"
    # No income in this fixture - savings_rate has no denominator, so it's
    # None. There IS an expense, so runway_months has a real (zero) answer:
    # zero liquid assets over a real average monthly spend.
    assert body["savings_rate"] is None
    assert body["runway_months"] == "0E+2"


def test_kpis_endpoint_surfaces_savings_rate_and_runway_months(client, db_session):

    account = Account(name="Everyday", account_type="everyday", account_number="1111")
    db_session.add(account)
    db_session.flush()

    salary = make_category(db_session, "Salary", "income")
    groceries = make_category(db_session, "Groceries", "expense")
    make_transaction(db_session, date(2026, 7, 1), credit=Decimal("2000.00"), category_id=salary.id)
    expense = make_transaction(db_session, date(2026, 7, 10), debit=Decimal("-500.00"), category_id=groceries.id)
    expense.account_id = account.id
    expense.balance = Decimal("2000.00")
    db_session.commit()

    response = client.get("/api/reports/kpis", params={"year": 2026, "month": 7, "months": 1})

    body = response.json()
    assert body["savings_rate"] == "0.75"
    assert body["runway_months"] == "4"


def test_kpis_endpoint_defaults_to_the_backend_default_period(client, db_session):

    groceries = make_category(db_session, "Groceries", "expense")
    make_transaction(db_session, date(2026, 7, 10), debit=Decimal("-60.00"), category_id=groceries.id)
    db_session.commit()

    response = client.get("/api/reports/kpis")

    assert response.status_code == 200
    assert response.json()["periods"][-1]["label"] == "2026-07"


def test_kpis_endpoint_rejects_year_without_month(client):

    response = client.get("/api/reports/kpis", params={"year": 2026})

    assert response.status_code == 422


# --- API: GET /reports/daily --------------------------------------------------

def test_daily_endpoint_shape(client, db_session):

    groceries = make_category(db_session, "Groceries", "expense")
    make_transaction(db_session, date(2026, 7, 10), debit=Decimal("-60.00"), category_id=groceries.id)
    db_session.commit()

    response = client.get("/api/reports/daily", params={"date_from": "2026-07-01", "date_to": "2026-07-31"})

    assert response.status_code == 200
    body = response.json()
    assert body == [{"date": "2026-07-10", "total_in": "0", "total_out": "60.00", "count": 1}]


def test_daily_endpoint_date_to_is_inclusive(client, db_session):
    """Mirrors the ledger's own date filter convention, unlike
    reporting.month_bounds' half-open one.
    """

    groceries = make_category(db_session, "Groceries", "expense")
    make_transaction(db_session, date(2026, 7, 31), debit=Decimal("-60.00"), category_id=groceries.id)
    db_session.commit()

    response = client.get("/api/reports/daily", params={"date_from": "2026-07-01", "date_to": "2026-07-31"})

    assert len(response.json()) == 1


def test_daily_endpoint_rejects_inverted_range(client):

    response = client.get("/api/reports/daily", params={"date_from": "2026-07-31", "date_to": "2026-07-01"})

    assert response.status_code == 422


def test_daily_endpoint_rejects_an_excessively_wide_range(client):

    response = client.get("/api/reports/daily", params={"date_from": "2020-01-01", "date_to": "2026-12-31"})

    assert response.status_code == 422


def test_daily_endpoint_requires_both_dates(client):

    assert client.get("/api/reports/daily", params={"date_from": "2026-07-01"}).status_code == 422
    assert client.get("/api/reports/daily", params={"date_to": "2026-07-31"}).status_code == 422
