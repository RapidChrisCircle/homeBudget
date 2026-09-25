from datetime import date
from decimal import Decimal

from app.models import Account, ImportBatch, Transaction
from app.services.coverage import account_coverage_gaps


def make_account(db_session, name="Joint Everyday", account_number="1111", group_id=None):

    account = Account(name=name, account_number=account_number, group_id=group_id)
    db_session.add(account)
    db_session.flush()
    return account


def make_transaction(db_session, account_id, transaction_date, balance,
                     debit=None, credit=None, narration="Coffee", account_number="1111"):

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
        transaction_type="WDL" if debit is not None else "DEP",
    )
    db_session.add(transaction)
    db_session.flush()
    return transaction


def test_a_clean_account_has_no_gaps(db_session):

    account = make_account(db_session)
    make_transaction(db_session, account.id, date(2026, 7, 1), balance="100.00", credit=Decimal("100.00"))
    make_transaction(db_session, account.id, date(2026, 7, 5), balance="80.00", debit=Decimal("-20.00"))
    make_transaction(db_session, account.id, date(2026, 7, 10), balance="130.00", credit=Decimal("50.00"))
    db_session.commit()

    assert account_coverage_gaps(db_session, account.id) == []


def test_an_account_with_a_single_transaction_has_no_gaps(db_session):
    """The very first transaction has nothing before it to check against -
    that's the start of recorded history, not a break."""

    account = make_account(db_session)
    make_transaction(db_session, account.id, date(2026, 7, 1), balance="100.00", credit=Decimal("100.00"))
    db_session.commit()

    assert account_coverage_gaps(db_session, account.id) == []


def test_an_account_with_no_transactions_has_no_gaps(db_session):

    account = make_account(db_session)
    db_session.commit()

    assert account_coverage_gaps(db_session, account.id) == []


def test_a_missing_statement_period_is_detected_with_its_range_and_amount(db_session):
    """A whole statement never imported: the balance jumps between two
    transactions by more than their own recorded amount explains."""

    account = make_account(db_session)
    make_transaction(db_session, account.id, date(2026, 6, 30), balance="500.00", credit=Decimal("500.00"))
    # A missing month's worth of activity: the next imported row's balance
    # doesn't follow from its own -50.00 alone.
    make_transaction(db_session, account.id, date(2026, 8, 1), balance="200.00", debit=Decimal("-50.00"))
    db_session.commit()

    gaps = account_coverage_gaps(db_session, account.id)

    assert len(gaps) == 1
    gap = gaps[0]
    assert gap.before_date == date(2026, 6, 30)
    assert gap.before_balance == Decimal("500.00")
    assert gap.after_date == date(2026, 8, 1)
    assert gap.after_balance == Decimal("200.00")
    assert gap.after_amount == Decimal("-50.00")
    assert gap.expected_balance == Decimal("450.00")
    assert gap.discrepancy == Decimal("-250.00")


def test_a_duplicate_or_out_of_order_import_is_also_detected(db_session):
    """The check doesn't care WHY the arithmetic broke - a duplicate row or
    a corrupted balance produces the identical signature as a missing
    statement, and is reported the same way."""

    account = make_account(db_session)
    make_transaction(db_session, account.id, date(2026, 7, 1), balance="100.00", credit=Decimal("100.00"))
    make_transaction(db_session, account.id, date(2026, 7, 2), balance="999.00", debit=Decimal("-10.00"))
    db_session.commit()

    gaps = account_coverage_gaps(db_session, account.id)

    assert len(gaps) == 1
    assert gaps[0].discrepancy == Decimal("909.00")


def test_multiple_gaps_are_each_reported(db_session):

    account = make_account(db_session)
    make_transaction(db_session, account.id, date(2026, 5, 1), balance="100.00", credit=Decimal("100.00"))
    make_transaction(db_session, account.id, date(2026, 6, 1), balance="500.00", credit=Decimal("50.00"))
    make_transaction(db_session, account.id, date(2026, 7, 1), balance="900.00", credit=Decimal("50.00"))
    db_session.commit()

    gaps = account_coverage_gaps(db_session, account.id)

    assert len(gaps) == 2
    assert gaps[0].before_date == date(2026, 5, 1)
    assert gaps[1].before_date == date(2026, 6, 1)


def test_same_day_transactions_are_never_checked_against_each_other(db_session):
    """Same-day file order isn't guaranteed to match import id order, so
    same-day rows must never be flagged just because they don't chain
    correctly against each other - only cross-day transitions are checked."""

    account = make_account(db_session)
    make_transaction(db_session, account.id, date(2026, 7, 1), balance="100.00", credit=Decimal("100.00"))
    # The cross-day transition into 7/5 is itself consistent (100 - 20 =
    # 80); it's the relationship BETWEEN the two same-day rows that looks
    # broken (a real bank would never produce this - the point is it must
    # not matter, since same-day pairs are never checked against each other).
    make_transaction(db_session, account.id, date(2026, 7, 5), balance="80.00", debit=Decimal("-20.00"))
    make_transaction(db_session, account.id, date(2026, 7, 5), balance="9999.00", debit=Decimal("-5.00"))
    db_session.commit()

    assert account_coverage_gaps(db_session, account.id) == []


def test_same_day_tolerance_does_not_hide_a_real_gap_on_the_next_day(db_session):

    account = make_account(db_session)
    make_transaction(db_session, account.id, date(2026, 7, 1), balance="100.00", credit=Decimal("100.00"))
    make_transaction(db_session, account.id, date(2026, 7, 1), balance="80.00", debit=Decimal("-20.00"))
    # A genuine gap starting the day after the same-day pair.
    make_transaction(db_session, account.id, date(2026, 8, 1), balance="1000.00", debit=Decimal("-10.00"))
    db_session.commit()

    gaps = account_coverage_gaps(db_session, account.id)

    assert len(gaps) == 1
    assert gaps[0].before_date == date(2026, 7, 1)
    assert gaps[0].after_date == date(2026, 8, 1)


def test_a_grouped_accounts_handover_never_reads_as_a_gap(db_session):
    """Each member of an account group is a genuinely different bank
    account - checked purely on its own transactions, never stitched to
    its group-mates."""

    from app.models import AccountGroup

    group = AccountGroup(name="Card succession")
    db_session.add(group)
    db_session.flush()

    old_card = make_account(db_session, name="Old Card", account_number="OLD", group_id=group.id)
    new_card = make_account(db_session, name="New Card", account_number="NEW", group_id=group.id)

    make_transaction(db_session, old_card.id, date(2026, 6, 1), balance="-500.00", debit=Decimal("-500.00"),
                     account_number="OLD")
    # The new card's own opening balance has no arithmetic relation to the
    # old card's closing one - a completely different starting number.
    make_transaction(db_session, new_card.id, date(2026, 7, 1), balance="-50.00", debit=Decimal("-50.00"),
                     account_number="NEW")
    db_session.commit()

    assert account_coverage_gaps(db_session, old_card.id) == []
    assert account_coverage_gaps(db_session, new_card.id) == []
