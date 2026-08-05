from datetime import date
from decimal import Decimal

from app.models import Account, Category, ImportBatch, Transaction
from app.services.categorization import _row_amount
from app.services.ledger import (
    LIST_LOADERS,
    TransactionFilters,
    account_balance,
    account_balances,
    build_transaction_query,
    paginate,
)


def make_account(db_session, name="Joint Everyday", account_number="1111"):

    account = Account(name=name, account_number=account_number)
    db_session.add(account)
    db_session.flush()
    return account


def make_category(db_session, name="Groceries", kind="expense"):

    category = Category(name=name, kind=kind)
    db_session.add(category)
    db_session.flush()
    return category


def make_transaction(db_session, transaction_date=date(2026, 7, 24), narration="Coffee",
                     debit=None, credit=None, transaction_type="WDL", category_id=None,
                     account_id=None, account_number="1111", balance="100.00"):

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
        debit=debit,
        credit=credit,
        balance=balance,
        transaction_type=transaction_type,
    )
    db_session.add(transaction)
    db_session.flush()
    return transaction


def test_filter_by_account_id(db_session):

    account_a = make_account(db_session, account_number="A")
    account_b = make_account(db_session, name="Credit Card", account_number="B")
    make_transaction(db_session, account_id=account_a.id, narration="A txn")
    make_transaction(db_session, account_id=account_b.id, narration="B txn")
    db_session.commit()

    query = build_transaction_query(db_session, TransactionFilters(account_id=account_a.id))
    results = query.all()

    assert len(results) == 1
    assert results[0].narration == "A txn"


def test_filter_by_category_id(db_session):

    groceries = make_category(db_session)
    dining = make_category(db_session, name="Dining")
    make_transaction(db_session, category_id=groceries.id, narration="Groceries txn")
    make_transaction(db_session, category_id=dining.id, narration="Dining txn")
    db_session.commit()

    query = build_transaction_query(db_session, TransactionFilters(category_id=groceries.id))
    results = query.all()

    assert len(results) == 1
    assert results[0].narration == "Groceries txn"


def test_uncategorized_only_excludes_categorized_rows(db_session):

    groceries = make_category(db_session)
    make_transaction(db_session, category_id=groceries.id, narration="Categorized")
    make_transaction(db_session, category_id=None, narration="Uncategorized")
    db_session.commit()

    query = build_transaction_query(db_session, TransactionFilters(uncategorized=True))
    results = query.all()

    assert len(results) == 1
    assert results[0].narration == "Uncategorized"


def test_uncategorized_only_differs_from_no_category_filter(db_session):

    groceries = make_category(db_session)
    make_transaction(db_session, category_id=groceries.id)
    make_transaction(db_session, category_id=None)
    db_session.commit()

    no_filter = build_transaction_query(db_session, TransactionFilters()).all()
    uncategorized_only = build_transaction_query(db_session, TransactionFilters(uncategorized=True)).all()

    assert len(no_filter) == 2
    assert len(uncategorized_only) == 1


def test_date_range_is_inclusive_on_both_ends(db_session):

    make_transaction(db_session, transaction_date=date(2026, 7, 1), narration="First of month")
    make_transaction(db_session, transaction_date=date(2026, 7, 31), narration="Last of month")
    make_transaction(db_session, transaction_date=date(2026, 8, 1), narration="Next month")

    db_session.commit()

    query = build_transaction_query(
        db_session,
        TransactionFilters(date_from=date(2026, 7, 1), date_to=date(2026, 7, 31)),
    )
    narrations = {t.narration for t in query.all()}

    assert narrations == {"First of month", "Last of month"}


def test_search_matches_narration_case_insensitively(db_session):

    make_transaction(db_session, narration="WOOLWORTHS NEWPORT")
    make_transaction(db_session, narration="Coles Newport")
    db_session.commit()

    query = build_transaction_query(db_session, TransactionFilters(search="woolworths"))
    results = query.all()

    assert len(results) == 1
    assert results[0].narration == "WOOLWORTHS NEWPORT"


def test_search_escapes_percent_as_a_literal_character(db_session):

    make_transaction(db_session, narration="Discount 50% off")
    make_transaction(db_session, narration="Some unrelated narration")
    db_session.commit()

    query = build_transaction_query(db_session, TransactionFilters(search="50%"))
    results = query.all()

    assert len(results) == 1
    assert results[0].narration == "Discount 50% off"


def test_filter_by_transaction_type_case_insensitive(db_session):

    make_transaction(db_session, transaction_type="WDL", narration="Withdrawal")
    make_transaction(db_session, transaction_type="DEP", narration="Deposit")
    db_session.commit()

    query = build_transaction_query(db_session, TransactionFilters(transaction_type="wdl"))
    results = query.all()

    assert len(results) == 1
    assert results[0].narration == "Withdrawal"


def test_amount_filter_matches_debit_using_absolute_value(db_session):

    make_transaction(db_session, debit="-98.00", narration="In range")
    make_transaction(db_session, debit="-5.00", narration="Too small")
    db_session.commit()

    query = build_transaction_query(
        db_session,
        TransactionFilters(min_amount=Decimal("50"), max_amount=Decimal("150")),
    )
    results = query.all()

    assert len(results) == 1
    assert results[0].narration == "In range"


def test_amount_filter_agrees_with_categorization_row_amount(db_session):

    transaction = make_transaction(db_session, debit="-98.00")
    db_session.commit()

    python_amount = _row_amount(transaction.debit, transaction.credit)

    query = build_transaction_query(
        db_session,
        TransactionFilters(min_amount=python_amount, max_amount=python_amount),
    )

    assert query.count() == 1


def test_combined_filters_are_anded(db_session):

    groceries = make_category(db_session)
    make_transaction(db_session, category_id=groceries.id, narration="Woolworths", debit="-50.00")
    make_transaction(db_session, category_id=groceries.id, narration="Coles", debit="-50.00")
    make_transaction(db_session, category_id=None, narration="Woolworths", debit="-50.00")
    db_session.commit()

    query = build_transaction_query(
        db_session,
        TransactionFilters(category_id=groceries.id, search="woolworths"),
    )
    results = query.all()

    assert len(results) == 1
    assert results[0].narration == "Woolworths"
    assert results[0].category_id == groceries.id


# --- Sorting -----------------------------------------------------------
# The ledger is PAGINATED, so sorting has to happen in SQL across the whole
# result set - sorting only the rows already on a page would silently lie
# about the full set. Every test here seeds more rows than one page for
# exactly that reason: it's the assertion that fails if sorting were ever
# done client-side instead.

def test_sort_by_amount_ascending_orders_the_whole_result_set_not_just_a_page(db_session):

    # Debits and credits mixed - amount sorting is on the ABSOLUTE value of
    # whichever is populated (the same convention the amount filter uses).
    amounts = [50, 10, 90, 30, 70, 20, 80, 40, 60, 5, 100, 15]
    for i, amount in enumerate(amounts):
        if i % 2 == 0:
            make_transaction(db_session, transaction_date=date(2026, 7, 1), narration=f"Row {i}", debit=f"-{amount}.00")
        else:
            make_transaction(db_session, transaction_date=date(2026, 7, 1), narration=f"Row {i}", credit=f"{amount}.00")
    db_session.commit()

    query = build_transaction_query(db_session, TransactionFilters(), sort="amount", direction="asc")
    page1, total = paginate(query, page=1, page_size=5)

    assert total == len(amounts)
    # The global minimum (5) must be first - would fail if only the DB's
    # insertion/default order were paginated and sorted after the fact.
    assert page1[0].narration == "Row 9"
    page1_amounts = [abs(float(t.debit or t.credit)) for t in page1]
    assert page1_amounts == sorted(amounts)[:5]


def test_sort_by_amount_descending_puts_the_global_maximum_first(db_session):

    amounts = [50, 10, 90, 30, 70, 20, 80, 40, 60, 5, 100, 15]
    for i, amount in enumerate(amounts):
        make_transaction(db_session, transaction_date=date(2026, 7, 1), narration=f"Row {i}", debit=f"-{amount}.00")
    db_session.commit()

    query = build_transaction_query(db_session, TransactionFilters(), sort="amount", direction="desc")
    page1, _ = paginate(query, page=1, page_size=1)

    assert page1[0].narration == "Row 10"  # amount 100, the maximum


def test_sort_id_tiebreak_pages_a_tied_column_without_gaps_or_duplicates(db_session):
    """A user-selectable sort column multiplies the chance of ties (many
    rows sharing the same date) far more than the fixed default order ever
    did - id DESC has to keep resolving them or paging would duplicate or
    drop rows.
    """

    for i in range(9):
        make_transaction(db_session, transaction_date=date(2026, 7, 1), narration=f"Row {i}")
    db_session.commit()

    query = build_transaction_query(db_session, TransactionFilters(), sort="date", direction="asc")
    page1, total = paginate(query, page=1, page_size=4)
    page2, _ = paginate(query, page=2, page_size=4)
    page3, _ = paginate(query, page=3, page_size=4)

    assert total == 9
    all_ids = [t.id for t in page1] + [t.id for t in page2] + [t.id for t in page3]
    assert len(all_ids) == len(set(all_ids)) == 9
    # Tiebreak is id DESC - within the tied date, ids descend.
    assert [t.id for t in page1] == sorted([t.id for t in page1], reverse=True)


def test_sort_by_category_puts_nulls_last_ascending_and_descending(db_session):

    groceries = make_category(db_session, name="Groceries")
    for i in range(3):
        make_transaction(db_session, transaction_date=date(2026, 7, 1), narration=f"Uncategorized {i}", category_id=None)
    make_transaction(db_session, transaction_date=date(2026, 7, 1), narration="Categorized", category_id=groceries.id)
    db_session.commit()

    for direction in ("asc", "desc"):
        query = build_transaction_query(db_session, TransactionFilters(), sort="category", direction=direction)
        results = query.all()
        # The one categorized row never lands after any uncategorized row,
        # in EITHER direction - nulls sort last regardless.
        assert results[-1].category_id is None
        assert results[-2].category_id is None
        assert results[-3].category_id is None
        assert results[0].category_id == groceries.id


def test_sort_by_narration_is_case_insensitive(db_session):

    make_transaction(db_session, transaction_date=date(2026, 7, 1), narration="banana")
    make_transaction(db_session, transaction_date=date(2026, 7, 1), narration="Apple")
    db_session.commit()

    query = build_transaction_query(db_session, TransactionFilters(), sort="narration", direction="asc")
    results = query.all()

    assert [t.narration for t in results] == ["Apple", "banana"]


def test_sort_by_balance_and_type_used_on_the_account_detail_ledger(db_session):
    """Both columns are NOT NULL (unlike account/category), so this is
    mostly a smoke test that the column mapping is wired correctly.
    """

    make_transaction(db_session, transaction_date=date(2026, 7, 1), balance="50.00", transaction_type="DEP")
    make_transaction(db_session, transaction_date=date(2026, 7, 1), balance="10.00", transaction_type="WDL")

    balance_query = build_transaction_query(db_session, TransactionFilters(), sort="balance", direction="asc")
    assert [str(t.balance) for t in balance_query.all()] == ["10.00", "50.00"]

    type_query = build_transaction_query(db_session, TransactionFilters(), sort="type", direction="asc")
    assert [t.transaction_type for t in type_query.all()] == ["DEP", "WDL"]


def test_unrecognized_sort_falls_back_to_the_default_order(db_session):
    """build_transaction_query itself is permissive - the API layer is what
    rejects an invalid `sort` with a 422 (see test_transactions.py), not
    this function, which is also called directly by tests and other
    services that may pass sort=None deliberately.
    """

    make_transaction(db_session, transaction_date=date(2026, 7, 1))
    make_transaction(db_session, transaction_date=date(2026, 7, 2))
    db_session.commit()

    default_query = build_transaction_query(db_session, TransactionFilters())
    garbage_sort_query = build_transaction_query(db_session, TransactionFilters(), sort="not-a-column")

    assert [t.id for t in default_query.all()] == [t.id for t in garbage_sort_query.all()]


def test_pagination_pages_through_results_without_gaps_or_duplicates(db_session):

    for i in range(5):
        make_transaction(db_session, transaction_date=date(2026, 7, 1), narration=f"Row {i}")
    db_session.commit()

    query = build_transaction_query(db_session, TransactionFilters())

    page1, total = paginate(query, page=1, page_size=2)
    page2, _ = paginate(query, page=2, page_size=2)
    page3, _ = paginate(query, page=3, page_size=2)

    assert total == 5
    all_ids = [t.id for t in page1] + [t.id for t in page2] + [t.id for t in page3]
    assert len(all_ids) == len(set(all_ids)) == 5


def test_pagination_loader_options_do_not_change_the_results(db_session):
    """LIST_LOADERS is applied only to the item fetch, not the count. Both
    relationships are many-to-one, so the joins cannot change what comes
    back - this pins that down rather than assuming it.
    """

    account = make_account(db_session)
    groceries = make_category(db_session)

    for i in range(5):
        make_transaction(
            db_session,
            transaction_date=date(2026, 7, 1),
            narration=f"Row {i}",
            account_id=account.id,
            category_id=groceries.id if i % 2 == 0 else None,
        )
    db_session.commit()

    query = build_transaction_query(db_session, TransactionFilters())

    bare_items, bare_total = paginate(query, page=1, page_size=3)
    eager_items, eager_total = paginate(query, page=1, page_size=3, options=LIST_LOADERS)

    assert bare_total == eager_total == 5
    assert [t.id for t in bare_items] == [t.id for t in eager_items]
    # The properties the response schema serializes still resolve.
    assert [t.account_name for t in eager_items] == [account.name] * 3


def test_pagination_beyond_the_end_returns_empty(db_session):

    make_transaction(db_session)
    db_session.commit()

    query = build_transaction_query(db_session, TransactionFilters())
    items, total = paginate(query, page=99, page_size=50)

    assert items == []
    assert total == 1


def test_account_balance_picks_latest_by_date_not_highest_id(db_session):

    account = make_account(db_session)

    # Imported first (lower id), but the newer statement.
    make_transaction(db_session, account_id=account.id, transaction_date=date(2026, 7, 24), balance="-4838.18")
    # Imported second (higher id), but an OLDER, late-imported statement.
    make_transaction(db_session, account_id=account.id, transaction_date=date(2026, 6, 1), balance="-100.00")

    db_session.commit()

    balance, as_of = account_balance(db_session, account.id)

    assert balance == Decimal("-4838.18")
    assert as_of == date(2026, 7, 24)


def test_account_balance_is_none_when_no_transactions(db_session):

    account = make_account(db_session)
    db_session.commit()

    balance, as_of = account_balance(db_session, account.id)

    assert balance is None
    assert as_of is None


def test_account_balances_returns_one_row_per_account(db_session):

    account_a = make_account(db_session, account_number="A")
    account_b = make_account(db_session, name="Credit Card", account_number="B")

    make_transaction(db_session, account_id=account_a.id, transaction_date=date(2026, 7, 1), balance="10.00")
    make_transaction(db_session, account_id=account_a.id, transaction_date=date(2026, 7, 2), balance="20.00")
    make_transaction(db_session, account_id=account_b.id, transaction_date=date(2026, 7, 1), balance="3000.00")

    db_session.commit()

    balances = account_balances(db_session)

    assert balances[account_a.id] == (Decimal("20.00"), date(2026, 7, 2))
    assert balances[account_b.id] == (Decimal("3000.00"), date(2026, 7, 1))
