from datetime import date
from decimal import Decimal

from app.models import Category, ImportBatch, Transaction, TransactionSplit
from app.services.allocations import allocation_subquery
from app.services.reporting import category_totals_for_period, month_bounds


def make_category(db_session, name="Groceries", kind="expense"):

    category = Category(name=name, kind=kind)
    db_session.add(category)
    db_session.flush()
    return category


def make_transaction(db_session, transaction_date=date(2026, 7, 24), narration="Coles",
                      debit=None, credit=None, category_id=None):

    batch = ImportBatch(filename="seed.csv", row_count=0, skipped_duplicate_count=0)
    db_session.add(batch)
    db_session.flush()

    transaction = Transaction(
        import_batch_id=batch.id,
        category_id=category_id,
        bsb_number=None,
        account_number="1111",
        transaction_date=transaction_date,
        narration=narration,
        cheque_number=None,
        debit=debit,
        credit=credit,
        balance="100.00",
        transaction_type="WDL",
    )
    db_session.add(transaction)
    db_session.flush()
    return transaction


def fetch_allocations(db_session):
    alloc = allocation_subquery(db_session)
    rows = db_session.query(alloc).all()
    return {(r.transaction_id, r.category_id): r.amount for r in rows}


def test_an_unsplit_categorized_transaction_contributes_one_allocation(db_session):

    category = make_category(db_session)
    transaction = make_transaction(db_session, debit=Decimal("-50.00"), category_id=category.id)
    db_session.commit()

    allocations = fetch_allocations(db_session)

    assert allocations == {(transaction.id, category.id): Decimal("-50.00")}


def test_an_unsplit_uncategorized_transaction_contributes_no_allocation(db_session):

    make_transaction(db_session, debit=Decimal("-50.00"), category_id=None)
    db_session.commit()

    assert fetch_allocations(db_session) == {}


def test_a_split_transaction_contributes_one_allocation_per_split(db_session):

    groceries = make_category(db_session, name="Groceries")
    alcohol = make_category(db_session, name="Alcohol")
    transaction = make_transaction(db_session, debit=Decimal("-150.00"), category_id=None)
    db_session.add_all([
        TransactionSplit(transaction_id=transaction.id, category_id=groceries.id, amount=Decimal("-100.00")),
        TransactionSplit(transaction_id=transaction.id, category_id=alcohol.id, amount=Decimal("-50.00")),
    ])
    db_session.commit()

    allocations = fetch_allocations(db_session)

    assert allocations == {
        (transaction.id, groceries.id): Decimal("-100.00"),
        (transaction.id, alcohol.id): Decimal("-50.00"),
    }


def test_a_split_allocation_with_no_category_contributes_nothing(db_session):

    groceries = make_category(db_session)
    transaction = make_transaction(db_session, debit=Decimal("-150.00"), category_id=None)
    db_session.add_all([
        TransactionSplit(transaction_id=transaction.id, category_id=groceries.id, amount=Decimal("-100.00")),
        TransactionSplit(transaction_id=transaction.id, category_id=None, amount=Decimal("-50.00")),
    ])
    db_session.commit()

    allocations = fetch_allocations(db_session)

    assert allocations == {(transaction.id, groceries.id): Decimal("-100.00")}


def test_splitting_a_transaction_does_not_change_the_reported_total_for_its_category(db_session):
    """The equivalence case the whole feature rests on: the same category
    total before and after a transaction is split into two halves of the
    SAME category it already belonged to.
    """

    category = make_category(db_session)
    start, end = month_bounds(2026, 7)

    whole = make_transaction(
        db_session, transaction_date=date(2026, 7, 10), debit=Decimal("-150.00"), category_id=category.id
    )
    db_session.commit()

    before = category_totals_for_period(db_session, start, end)
    before_net = next(t.net for t in before if t.category_id == category.id)
    assert before_net == Decimal("-150.00")

    # Re-express the same transaction as two splits of the same category.
    whole.category_id = None
    db_session.add_all([
        TransactionSplit(transaction_id=whole.id, category_id=category.id, amount=Decimal("-100.00")),
        TransactionSplit(transaction_id=whole.id, category_id=category.id, amount=Decimal("-50.00")),
    ])
    db_session.commit()

    after = category_totals_for_period(db_session, start, end)
    after_net = next(t.net for t in after if t.category_id == category.id)
    assert after_net == before_net == Decimal("-150.00")
