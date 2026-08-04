from datetime import date
from decimal import Decimal

from app.models import Account, ImportBatch, Transaction
from app.services.net_worth import net_worth_history, net_worth_now, signed_balance
from app.services.reporting import contiguous_periods


def make_account(db_session, name="Joint Everyday", account_number="1111",
                  account_type="everyday", balance_sign="natural"):

    account = Account(
        name=name, account_number=account_number, account_type=account_type, balance_sign=balance_sign
    )
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


# --- signed_balance ---------------------------------------------------------

def test_signed_balance_is_none_for_an_unclassified_account(db_session):

    account = make_account(db_session, account_type=None)

    assert signed_balance(account, Decimal("100.00")) is None


def test_signed_balance_is_none_when_balance_is_none():

    account = Account(name="A", account_number="1", account_type="everyday", balance_sign="natural")

    assert signed_balance(account, None) is None


def test_signed_balance_natural_liability_subtracts_a_negative_balance():
    """This app's own sample data convention - ANZ's credit card already
    reports debt as negative - so "natural" liability balances need no
    further inversion to be correct."""

    card = Account(name="Card", account_number="1", account_type="credit_card", balance_sign="natural")

    assert signed_balance(card, Decimal("-300.50")) == Decimal("-300.50")


def test_signed_balance_inverted_liability_negates_a_positive_owed_balance():
    """The other real-world convention: a bank that reports a credit
    card's amount owed as a positive number must be negated to correctly
    subtract from net worth."""

    card = Account(name="Card", account_number="1", account_type="credit_card", balance_sign="inverted")

    assert signed_balance(card, Decimal("300.50")) == Decimal("-300.50")


def test_signed_balance_asset_always_adds():

    everyday = Account(name="Everyday", account_number="1", account_type="everyday", balance_sign="natural")

    assert signed_balance(everyday, Decimal("1200.50")) == Decimal("1200.50")


# --- net_worth_now -----------------------------------------------------------

def test_net_worth_now_nets_an_asset_against_a_natural_liability(db_session):

    everyday = make_account(db_session, name="Everyday", account_number="AAAA", account_type="everyday")
    card = make_account(db_session, name="Card", account_number="BBBB", account_type="credit_card")

    make_transaction(db_session, everyday.id, date(2026, 7, 24), balance="1200.50", account_number="AAAA")
    make_transaction(db_session, card.id, date(2026, 7, 24), balance="-300.50", account_number="BBBB")
    db_session.commit()

    result = net_worth_now(db_session)

    assert result["assets"] == Decimal("1200.50")
    assert result["liabilities"] == Decimal("300.50")
    assert result["net"] == Decimal("900.00")
    assert result["unclassified_count"] == 0


def test_net_worth_now_matches_regardless_of_which_sign_convention_the_liability_uses(db_session):
    """The whole point of the sign field: an inverted liability reporting
    +300.50 as "amount owed" must produce the EXACT same net worth as a
    natural one reporting -300.50 for the same debt."""

    everyday = make_account(db_session, name="Everyday", account_number="AAAA", account_type="everyday")
    card = make_account(
        db_session, name="Card", account_number="BBBB", account_type="credit_card", balance_sign="inverted"
    )

    make_transaction(db_session, everyday.id, date(2026, 7, 24), balance="1200.50", account_number="AAAA")
    make_transaction(db_session, card.id, date(2026, 7, 24), balance="300.50", account_number="BBBB")
    db_session.commit()

    result = net_worth_now(db_session)

    assert result["net"] == Decimal("900.00")


def test_net_worth_now_excludes_an_unclassified_account_and_counts_it(db_session):
    """The load-bearing test: an unclassified account must NEVER be
    silently treated as an asset (or anything else) - it is excluded from
    the total entirely and reported separately."""

    everyday = make_account(db_session, name="Everyday", account_number="AAAA", account_type="everyday")
    mystery = make_account(db_session, name="Mystery", account_number="BBBB", account_type=None)

    make_transaction(db_session, everyday.id, date(2026, 7, 24), balance="1000.00", account_number="AAAA")
    make_transaction(db_session, mystery.id, date(2026, 7, 24), balance="5000.00", account_number="BBBB")
    db_session.commit()

    result = net_worth_now(db_session)

    # If the unclassified $5000 account were silently added as an asset,
    # net worth would read 6000.00 - it must not.
    assert result["net"] == Decimal("1000.00")
    assert result["assets"] == Decimal("1000.00")
    assert result["unclassified_count"] == 1


def test_net_worth_now_does_not_count_an_unclassified_account_with_no_transactions(db_session):
    """unclassified_count should reflect accounts that actually HAVE a
    balance being excluded, not every unclassified account regardless -
    one with no transactions yet has nothing to exclude."""

    make_account(db_session, account_type=None)
    db_session.commit()

    result = net_worth_now(db_session)

    assert result["unclassified_count"] == 0


# --- net_worth_history ---------------------------------------------------

def test_net_worth_history_sums_sign_aware_per_period(db_session):

    everyday = make_account(db_session, name="Everyday", account_number="AAAA", account_type="everyday")
    card = make_account(db_session, name="Card", account_number="BBBB", account_type="credit_card")

    make_transaction(db_session, everyday.id, date(2026, 7, 1), balance="1200.50", account_number="AAAA")
    make_transaction(db_session, card.id, date(2026, 7, 1), balance="-300.50", account_number="BBBB")
    db_session.commit()

    periods = contiguous_periods(2026, 7, 1)
    history = net_worth_history(db_session, periods)

    assert history[(2026, 7)] == Decimal("900.00")


def test_net_worth_history_excludes_an_unclassified_account(db_session):

    everyday = make_account(db_session, name="Everyday", account_number="AAAA", account_type="everyday")
    mystery = make_account(db_session, name="Mystery", account_number="BBBB", account_type=None)

    make_transaction(db_session, everyday.id, date(2026, 7, 1), balance="1000.00", account_number="AAAA")
    make_transaction(db_session, mystery.id, date(2026, 7, 1), balance="5000.00", account_number="BBBB")
    db_session.commit()

    periods = contiguous_periods(2026, 7, 1)
    history = net_worth_history(db_session, periods)

    assert history[(2026, 7)] == Decimal("1000.00")


def test_net_worth_history_treats_an_unopened_account_as_zero_not_a_gap(db_session):

    early = make_account(db_session, name="Early", account_number="AAAA", account_type="everyday")
    make_transaction(db_session, early.id, date(2026, 5, 1), balance="500.00", account_number="AAAA")

    late = make_account(db_session, name="Late", account_number="BBBB", account_type="everyday")
    make_transaction(db_session, late.id, date(2026, 7, 1), balance="200.00", account_number="BBBB")
    db_session.commit()

    periods = contiguous_periods(2026, 7, 3)  # May, June, July
    history = net_worth_history(db_session, periods)

    assert history[(2026, 5)] == Decimal("500.00")
    assert history[(2026, 6)] == Decimal("500.00")
    assert history[(2026, 7)] == Decimal("700.00")


def test_net_worth_history_is_none_only_when_every_classified_account_is_none(db_session):

    account_a = make_account(db_session, name="A", account_number="AAAA", account_type="everyday")
    account_b = make_account(db_session, name="B", account_number="BBBB", account_type="credit_card")

    make_transaction(db_session, account_a.id, date(2026, 7, 1), balance="100.00", account_number="AAAA")
    make_transaction(db_session, account_b.id, date(2026, 7, 1), balance="-50.00", account_number="BBBB")
    db_session.commit()

    periods = contiguous_periods(2026, 7, 6)  # Feb through July
    history = net_worth_history(db_session, periods)

    assert history[(2026, 2)] is None
    assert history[(2026, 7)] == Decimal("50.00")


def test_net_worth_history_empty_periods_returns_empty_dict(db_session):

    assert net_worth_history(db_session, []) == {}


# --- API level ----------------------------------------------------------------

def test_get_net_worth_endpoint_shape(client, db_session):

    everyday = make_account(db_session, name="Everyday", account_number="AAAA", account_type="everyday")
    card = make_account(db_session, name="Card", account_number="BBBB", account_type="credit_card")

    make_transaction(db_session, everyday.id, date(2026, 7, 24), balance="1200.50", account_number="AAAA")
    make_transaction(db_session, card.id, date(2026, 7, 24), balance="-300.50", account_number="BBBB")
    db_session.commit()

    response = client.get("/api/net-worth")

    assert response.status_code == 200
    assert response.json() == {
        "assets": "1200.50",
        "liabilities": "300.50",
        "net": "900.00",
        "unclassified_count": 0,
    }


def test_get_net_worth_endpoint_surfaces_unclassified_count(client, db_session):

    everyday = make_account(db_session, name="Everyday", account_number="AAAA", account_type="everyday")
    mystery = make_account(db_session, name="Mystery", account_number="BBBB", account_type=None)

    make_transaction(db_session, everyday.id, date(2026, 7, 24), balance="1000.00", account_number="AAAA")
    make_transaction(db_session, mystery.id, date(2026, 7, 24), balance="5000.00", account_number="BBBB")
    db_session.commit()

    response = client.get("/api/net-worth")

    assert response.status_code == 200
    body = response.json()
    assert body["net"] == "1000.00"
    assert body["unclassified_count"] == 1


def test_get_net_worth_endpoint_on_an_empty_ledger(client):

    response = client.get("/api/net-worth")

    assert response.status_code == 200
    assert response.json() == {
        "assets": "0",
        "liabilities": "0",
        "net": "0",
        "unclassified_count": 0,
    }
