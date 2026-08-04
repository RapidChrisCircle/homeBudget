from datetime import date
from decimal import Decimal

from app.models import Account, ImportBatch, Transaction
from app.services.reporting import contiguous_periods
from app.services.trends import account_balance_history, combined_balance_history


def make_account(db_session, name="Joint Everyday", account_number="1111"):

    account = Account(name=name, account_number=account_number)
    db_session.add(account)
    db_session.flush()
    return account


def make_transaction(db_session, account_id, transaction_date, balance, narration="Coffee",
                     debit="-5.00", credit=None, account_number="1111"):

    batch = ImportBatch(filename="seed.csv", row_count=0, skipped_duplicate_count=0)
    db_session.add(batch)
    db_session.flush()

    transaction = Transaction(
        import_batch_id=batch.id,
        account_id=account_id,
        bsb_number=None,
        account_number=account_number,
        transaction_date=transaction_date,
        narration=narration,
        cheque_number=None,
        debit=debit,
        credit=credit,
        balance=balance,
        transaction_type="WDL",
    )
    db_session.add(transaction)
    db_session.flush()
    return transaction


def test_closing_balance_picks_latest_by_date_not_highest_id(db_session):
    # The exact same trap ledger.account_balance() guards against, at the
    # per-month level: a later-imported OLDER statement must not overwrite
    # the closing balance of the month it lands in id-order after.
    account = make_account(db_session)

    make_transaction(db_session, account.id, date(2026, 7, 24), balance="-4838.18", narration="Newer")
    # Imported later (higher id) but dated earlier in the same month.
    make_transaction(db_session, account.id, date(2026, 7, 1), balance="-100.00", narration="Older, imported later")
    db_session.commit()

    periods = contiguous_periods(2026, 7, 1)
    history = account_balance_history(db_session, periods)

    assert history[account.id][(2026, 7)] == Decimal("-4838.18")


def test_a_month_with_no_transactions_carries_the_previous_balance_forward(db_session):

    account = make_account(db_session)
    make_transaction(db_session, account.id, date(2026, 5, 10), balance="500.00")
    # June: nothing. July: nothing either.
    db_session.commit()

    periods = contiguous_periods(2026, 7, 3)
    history = account_balance_history(db_session, periods)

    assert history[account.id][(2026, 5)] == Decimal("500.00")
    assert history[account.id][(2026, 6)] == Decimal("500.00")
    assert history[account.id][(2026, 7)] == Decimal("500.00")


def test_months_before_the_first_transaction_are_none_not_zero(db_session):

    account = make_account(db_session)
    make_transaction(db_session, account.id, date(2026, 7, 5), balance="200.00")
    db_session.commit()

    periods = contiguous_periods(2026, 7, 3)
    history = account_balance_history(db_session, periods)

    assert history[account.id][(2026, 5)] is None
    assert history[account.id][(2026, 6)] is None
    assert history[account.id][(2026, 7)] == Decimal("200.00")


def test_carry_forward_uses_history_from_before_the_requested_window(db_session):
    # The window's FIRST period has no transaction of its own, but the
    # account has history from before the window - that must still carry
    # forward, not read as "no data yet".
    account = make_account(db_session)
    make_transaction(db_session, account.id, date(2026, 1, 10), balance="900.00")
    db_session.commit()

    periods = contiguous_periods(2026, 7, 3)  # May, June, July
    history = account_balance_history(db_session, periods)

    assert history[account.id][(2026, 5)] == Decimal("900.00")
    assert history[account.id][(2026, 6)] == Decimal("900.00")
    assert history[account.id][(2026, 7)] == Decimal("900.00")


def test_account_with_no_transactions_is_absent_from_the_history_dict(db_session):

    account = make_account(db_session)
    db_session.commit()

    periods = contiguous_periods(2026, 7, 3)
    history = account_balance_history(db_session, periods)

    assert account.id not in history


def test_two_accounts_are_computed_independently_in_one_call(db_session):

    account_a = make_account(db_session, name="A", account_number="AAAA")
    account_b = make_account(db_session, name="B", account_number="BBBB")

    make_transaction(db_session, account_a.id, date(2026, 7, 1), balance="100.00", account_number="AAAA")
    make_transaction(db_session, account_b.id, date(2026, 7, 1), balance="-50.00", account_number="BBBB")
    db_session.commit()

    periods = contiguous_periods(2026, 7, 1)
    history = account_balance_history(db_session, periods)

    assert history[account_a.id][(2026, 7)] == Decimal("100.00")
    assert history[account_b.id][(2026, 7)] == Decimal("-50.00")


def test_empty_periods_returns_empty_history(db_session):

    assert account_balance_history(db_session, []) == {}


# --- combined_balance_history ---------------------------------------------

def test_combined_balance_sums_every_account_for_the_same_period(db_session):

    account_a = make_account(db_session, name="A", account_number="AAAA")
    account_b = make_account(db_session, name="B", account_number="BBBB")

    make_transaction(db_session, account_a.id, date(2026, 7, 1), balance="100.00", account_number="AAAA")
    make_transaction(db_session, account_b.id, date(2026, 7, 1), balance="-50.00", account_number="BBBB")
    db_session.commit()

    periods = contiguous_periods(2026, 7, 1)
    combined = combined_balance_history(db_session, periods)

    assert combined[(2026, 7)] == Decimal("50.00")


def test_combined_balance_treats_an_unopened_account_as_zero_not_a_gap(db_session):
    """Mirrors DashboardPage's own current-balance figure: an account with
    no transactions YET contributes 0 to the combined total, it does not
    make the whole period unknown - the same reason DashboardPage filters
    out None-balance accounts before summing, rather than bailing out.
    """

    early_account = make_account(db_session, name="Early", account_number="AAAA")
    make_transaction(db_session, early_account.id, date(2026, 5, 1), balance="500.00", account_number="AAAA")

    late_account = make_account(db_session, name="Late", account_number="BBBB")
    make_transaction(db_session, late_account.id, date(2026, 7, 1), balance="200.00", account_number="BBBB")
    db_session.commit()

    periods = contiguous_periods(2026, 7, 3)  # May, June, July
    combined = combined_balance_history(db_session, periods)

    # May and June: only the early account exists yet - late_account's None
    # contributes 0, not a gap.
    assert combined[(2026, 5)] == Decimal("500.00")
    assert combined[(2026, 6)] == Decimal("500.00")
    assert combined[(2026, 7)] == Decimal("700.00")


def test_combined_balance_is_none_only_when_every_account_is_none(db_session):

    account_a = make_account(db_session, name="A", account_number="AAAA")
    account_b = make_account(db_session, name="B", account_number="BBBB")

    make_transaction(db_session, account_a.id, date(2026, 7, 1), balance="100.00", account_number="AAAA")
    make_transaction(db_session, account_b.id, date(2026, 7, 1), balance="-50.00", account_number="BBBB")
    db_session.commit()

    # A window starting well before either account's first transaction.
    periods = contiguous_periods(2026, 7, 6)  # Feb through July
    combined = combined_balance_history(db_session, periods)

    assert combined[(2026, 2)] is None
    assert combined[(2026, 7)] == Decimal("50.00")


def test_combined_balance_empty_periods_returns_empty_dict(db_session):

    assert combined_balance_history(db_session, []) == {}


# --- API level ----------------------------------------------------------------

def test_get_balance_history_endpoint_shape(client, db_session):

    account = make_account(db_session)
    make_transaction(db_session, account.id, date(2026, 7, 5), balance="250.00")
    db_session.commit()

    response = client.get(f"/api/accounts/{account.id}/balance-history?months=3")

    assert response.status_code == 200
    body = response.json()
    assert len(body["periods"]) == 3
    assert body["balances"]["2026-07"] == "250.00"
    assert body["balances"]["2026-05"] is None


def test_get_balance_history_404s_for_unknown_account(client):

    response = client.get("/api/accounts/999999/balance-history")

    assert response.status_code == 404


def test_get_balance_history_for_account_with_no_transactions_is_all_none(client, db_session):

    account = make_account(db_session)
    # A second account WITH transactions, so default_period() has a month to
    # anchor on even though the account under test has none.
    other = make_account(db_session, name="Other", account_number="9999")
    make_transaction(db_session, other.id, date(2026, 7, 5), balance="10.00")
    db_session.commit()

    response = client.get(f"/api/accounts/{account.id}/balance-history?months=2")

    assert response.status_code == 200
    assert all(v is None for v in response.json()["balances"].values())
