from datetime import date
from decimal import Decimal

from app.models import Account, Category, ImportBatch, Transaction, TransactionSplit
from app.services.transfer_matching import transfer_candidates, unmatched_transfer_legs


def make_account(db_session, name="Everyday", account_number="1111"):

    account = Account(name=name, account_number=account_number, account_type="everyday")
    db_session.add(account)
    db_session.flush()
    return account


def make_category(db_session, name="Card Payment", kind="transfer"):

    category = Category(name=name, kind=kind)
    db_session.add(category)
    db_session.flush()
    return category


def make_transaction(db_session, account, transaction_date, debit=None, credit=None,
                      category_id=None, narration="Transfer"):

    batch = ImportBatch(filename="seed.csv", row_count=0, skipped_duplicate_count=0)
    db_session.add(batch)
    db_session.flush()

    transaction = Transaction(
        import_batch_id=batch.id,
        account_id=account.id,
        category_id=category_id,
        account_number=account.account_number,
        transaction_date=transaction_date,
        narration=narration,
        debit=debit,
        credit=credit,
        balance="100.00",
        transaction_type="WDL" if debit is not None else "DEP",
    )
    db_session.add(transaction)
    db_session.flush()
    return transaction


# --- transfer_candidates -----------------------------------------------------------

def test_matches_an_equal_and_opposite_pair_across_accounts(db_session):

    everyday = make_account(db_session, "Everyday", "1111")
    savings = make_account(db_session, "Savings", "2222")
    debit = make_transaction(db_session, everyday, date(2026, 1, 5), debit=Decimal("-200.00"))
    credit = make_transaction(db_session, savings, date(2026, 1, 6), credit=Decimal("200.00"))
    db_session.commit()

    matches = transfer_candidates(db_session)

    assert len(matches) == 1
    match = matches[0]
    assert {match.leg_a_id, match.leg_b_id} == {debit.id, credit.id}
    assert match.amount == Decimal("200.00")
    assert match.both_categorized_as_transfer is False


def test_does_not_match_a_coincidental_same_amount_pair_within_one_account(db_session):

    everyday = make_account(db_session)
    make_transaction(db_session, everyday, date(2026, 1, 5), debit=Decimal("-50.00"))
    make_transaction(db_session, everyday, date(2026, 1, 6), credit=Decimal("50.00"))
    db_session.commit()

    assert transfer_candidates(db_session) == []


def test_does_not_match_beyond_the_date_window(db_session):

    everyday = make_account(db_session, "Everyday", "1111")
    savings = make_account(db_session, "Savings", "2222")
    make_transaction(db_session, everyday, date(2026, 1, 1), debit=Decimal("-75.00"))
    make_transaction(db_session, savings, date(2026, 1, 10), credit=Decimal("75.00"))
    db_session.commit()

    assert transfer_candidates(db_session, window_days=3) == []


def test_matches_within_a_custom_window(db_session):

    everyday = make_account(db_session, "Everyday", "1111")
    savings = make_account(db_session, "Savings", "2222")
    make_transaction(db_session, everyday, date(2026, 1, 1), debit=Decimal("-75.00"))
    make_transaction(db_session, savings, date(2026, 1, 4), credit=Decimal("75.00"))
    db_session.commit()

    assert len(transfer_candidates(db_session, window_days=3)) == 1


def test_both_categorized_as_transfer_is_true_when_both_legs_are(db_session):

    everyday = make_account(db_session, "Everyday", "1111")
    savings = make_account(db_session, "Savings", "2222")
    transfer_category = make_category(db_session)
    make_transaction(db_session, everyday, date(2026, 1, 5), debit=Decimal("-200.00"), category_id=transfer_category.id)
    make_transaction(db_session, savings, date(2026, 1, 5), credit=Decimal("200.00"), category_id=transfer_category.id)
    db_session.commit()

    match = transfer_candidates(db_session)[0]

    assert match.both_categorized_as_transfer is True


def test_both_categorized_as_transfer_is_false_when_one_leg_is_mis_categorized(db_session):

    everyday = make_account(db_session, "Everyday", "1111")
    savings = make_account(db_session, "Savings", "2222")
    transfer_category = make_category(db_session)
    expense_category = make_category(db_session, name="Groceries", kind="expense")
    make_transaction(db_session, everyday, date(2026, 1, 5), debit=Decimal("-200.00"), category_id=expense_category.id)
    make_transaction(db_session, savings, date(2026, 1, 5), credit=Decimal("200.00"), category_id=transfer_category.id)
    db_session.commit()

    match = transfer_candidates(db_session)[0]

    assert match.both_categorized_as_transfer is False


def test_excludes_split_transactions(db_session):

    everyday = make_account(db_session, "Everyday", "1111")
    savings = make_account(db_session, "Savings", "2222")
    category = make_category(db_session, name="Groceries", kind="expense")
    split_txn = make_transaction(db_session, everyday, date(2026, 1, 5), debit=Decimal("-100.00"))
    db_session.add(TransactionSplit(transaction_id=split_txn.id, category_id=category.id, amount=Decimal("-100.00")))
    make_transaction(db_session, savings, date(2026, 1, 5), credit=Decimal("100.00"))
    db_session.commit()

    assert transfer_candidates(db_session) == []


def test_excludes_transactions_with_no_account(db_session):

    everyday = make_account(db_session, "Everyday", "1111")
    batch = ImportBatch(filename="seed.csv", row_count=0, skipped_duplicate_count=0)
    db_session.add(batch)
    db_session.flush()
    unlinked = Transaction(
        import_batch_id=batch.id, account_id=None, account_number="9999",
        transaction_date=date(2026, 1, 5), narration="Mystery", credit=Decimal("100.00"),
        balance="100.00", transaction_type="DEP",
    )
    db_session.add(unlinked)
    make_transaction(db_session, everyday, date(2026, 1, 5), debit=Decimal("-100.00"))
    db_session.commit()

    assert transfer_candidates(db_session) == []


def test_each_transaction_is_used_in_at_most_one_pair(db_session):

    everyday = make_account(db_session, "Everyday", "1111")
    savings = make_account(db_session, "Savings", "2222")
    third = make_account(db_session, "Third", "3333")
    debit = make_transaction(db_session, everyday, date(2026, 1, 5), debit=Decimal("-100.00"))
    make_transaction(db_session, savings, date(2026, 1, 5), credit=Decimal("100.00"))
    make_transaction(db_session, third, date(2026, 1, 6), credit=Decimal("100.00"))
    db_session.commit()

    matches = transfer_candidates(db_session)

    assert len(matches) == 1
    assert matches[0].leg_a_id == debit.id


# --- unmatched_transfer_legs ---------------------------------------------------

def test_unmatched_transfer_leg_is_reported(db_session):

    everyday = make_account(db_session, "Everyday", "1111")
    transfer_category = make_category(db_session)
    lonely = make_transaction(
        db_session, everyday, date(2026, 1, 5), debit=Decimal("-300.00"), category_id=transfer_category.id
    )
    db_session.commit()

    unmatched = unmatched_transfer_legs(db_session)

    assert [t.id for t in unmatched] == [lonely.id]


def test_matched_transfer_leg_is_not_reported_as_unmatched(db_session):

    everyday = make_account(db_session, "Everyday", "1111")
    savings = make_account(db_session, "Savings", "2222")
    transfer_category = make_category(db_session)
    make_transaction(db_session, everyday, date(2026, 1, 5), debit=Decimal("-300.00"), category_id=transfer_category.id)
    make_transaction(db_session, savings, date(2026, 1, 5), credit=Decimal("300.00"), category_id=transfer_category.id)
    db_session.commit()

    assert unmatched_transfer_legs(db_session) == []


def test_non_transfer_category_is_never_reported_as_unmatched(db_session):

    everyday = make_account(db_session, "Everyday", "1111")
    expense_category = make_category(db_session, name="Groceries", kind="expense")
    make_transaction(db_session, everyday, date(2026, 1, 5), debit=Decimal("-40.00"), category_id=expense_category.id)
    db_session.commit()

    assert unmatched_transfer_legs(db_session) == []


# --- API -------------------------------------------------------------------------

def test_get_transfers_shape(client, db_session):

    everyday = make_account(db_session, "Everyday", "1111")
    savings = make_account(db_session, "Savings", "2222")
    make_transaction(db_session, everyday, date(2026, 1, 5), debit=Decimal("-200.00"))
    make_transaction(db_session, savings, date(2026, 1, 6), credit=Decimal("200.00"))
    db_session.commit()

    body = client.get("/api/transfers").json()

    assert len(body["matches"]) == 1
    match = body["matches"][0]
    assert match["amount"] == "200.00"
    assert match["leg_a_account_name"] == "Everyday"
    assert match["leg_b_account_name"] == "Savings"
    assert match["both_categorized_as_transfer"] is False
    assert body["unmatched"] == []


def test_get_transfers_reports_an_unmatched_leg(client, db_session):

    everyday = make_account(db_session, "Everyday", "1111")
    transfer_category = make_category(db_session)
    make_transaction(
        db_session, everyday, date(2026, 1, 5), debit=Decimal("-300.00"),
        category_id=transfer_category.id, narration="Lonely Transfer",
    )
    db_session.commit()

    body = client.get("/api/transfers").json()

    assert body["matches"] == []
    assert len(body["unmatched"]) == 1
    unmatched = body["unmatched"][0]
    assert unmatched["account_name"] == "Everyday"
    assert unmatched["narration"] == "Lonely Transfer"
    assert unmatched["amount"] == "-300.00"
