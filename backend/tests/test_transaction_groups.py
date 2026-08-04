from datetime import date
from decimal import Decimal

from app.models import Account, Category, ImportBatch, Transaction, TransactionSplit
from app.services.ledger import MIN_GROUP_SIZE, TransactionFilters, transaction_groups


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


def no_filters(**overrides):
    return TransactionFilters(**overrides)


def test_singleton_narration_is_excluded(db_session):

    account = make_account(db_session)
    make_transaction(db_session, account.id, date(2026, 7, 1), "IGA NEWPORT              NEWPORT", -4.45)

    groups = transaction_groups(db_session, no_filters())

    assert groups == []


def test_matching_occurrences_form_a_group_across_accounts(db_session):

    a = make_account(db_session, name="Joint Everyday", account_number="1111")
    b = make_account(db_session, name="Credit Card", account_number="2222")

    make_transaction(db_session, a.id, date(2026, 7, 1), "RED ENERGY               CREMORNE  1234", -50.00, account_number="1111")
    make_transaction(db_session, b.id, date(2026, 7, 15), "RED ENERGY               CREMORNE  5678", -55.00, account_number="2222")

    groups = transaction_groups(db_session, no_filters())

    assert len(groups) == 1
    group = groups[0]
    assert group.merchant == "RED ENERGY"
    assert group.transaction_count == 2
    assert group.total_amount == Decimal("105.00")
    assert group.direction == "outflow"
    assert group.first_date == date(2026, 7, 1)
    assert group.last_date == date(2026, 7, 15)
    assert sorted(group.account_names) == ["Credit Card", "Joint Everyday"]
    assert len(group.transaction_ids) == 2


def test_categorized_rows_are_excluded_from_grouping(db_session):

    account = make_account(db_session)
    category = make_category(db_session)

    make_transaction(db_session, account.id, date(2026, 7, 1), "IGA NEWPORT              NEWPORT", -4.45)
    make_transaction(
        db_session, account.id, date(2026, 7, 8), "IGA NEWPORT              NEWPORT", -5.00,
        category_id=category.id,
    )

    groups = transaction_groups(db_session, no_filters())

    # Only one still-uncategorized row remains for this key - below MIN_GROUP_SIZE.
    assert MIN_GROUP_SIZE == 2
    assert groups == []


def test_ledger_filters_scope_the_group(db_session):

    account = make_account(db_session)

    make_transaction(db_session, account.id, date(2026, 6, 1), "IGA NEWPORT              NEWPORT", -4.45)
    make_transaction(db_session, account.id, date(2026, 6, 8), "IGA NEWPORT              NEWPORT", -5.00)
    make_transaction(db_session, account.id, date(2026, 7, 1), "IGA NEWPORT              NEWPORT", -6.00)

    all_groups = transaction_groups(db_session, no_filters())
    assert all_groups[0].transaction_count == 3

    june_only = transaction_groups(
        db_session, no_filters(date_from=date(2026, 6, 1), date_to=date(2026, 6, 30))
    )
    assert len(june_only) == 1
    assert june_only[0].transaction_count == 2
    assert june_only[0].total_amount == Decimal("9.45")


def test_an_incoming_category_filter_is_overridden_by_the_grouped_view(db_session):
    """category_id/uncategorized on the incoming filters must not leak
    through - a group is always computed over uncategorized rows only,
    regardless of what the caller's ledger view was scoped to.
    """

    account = make_account(db_session)
    other_category = make_category(db_session, name="Other", kind="expense")

    make_transaction(db_session, account.id, date(2026, 7, 1), "IGA NEWPORT              NEWPORT", -4.45)
    make_transaction(db_session, account.id, date(2026, 7, 8), "IGA NEWPORT              NEWPORT", -5.00)

    groups = transaction_groups(db_session, no_filters(category_id=other_category.id))

    assert len(groups) == 1
    assert groups[0].transaction_count == 2


def test_direction_is_majority_with_ties_going_to_outflow(db_session):

    account = make_account(db_session)

    make_transaction(db_session, account.id, date(2026, 7, 1), "MIXED MERCHANT           SUBURB", -10.00)
    make_transaction(db_session, account.id, date(2026, 7, 8), "MIXED MERCHANT           SUBURB", 10.00, credit=True)

    groups = transaction_groups(db_session, no_filters())

    assert groups[0].direction == "outflow"


def test_groups_sort_by_count_then_total_descending(db_session):

    account = make_account(db_session)

    # Two occurrences, larger total.
    make_transaction(db_session, account.id, date(2026, 7, 1), "BIG SUBSCRIPTION         CITY", -100.00)
    make_transaction(db_session, account.id, date(2026, 7, 8), "BIG SUBSCRIPTION         CITY", -100.00)

    # Three occurrences, smaller total - should still sort first on count.
    make_transaction(db_session, account.id, date(2026, 7, 1), "SMALL COFFEE             CITY", -4.00)
    make_transaction(db_session, account.id, date(2026, 7, 8), "SMALL COFFEE             CITY", -4.00)
    make_transaction(db_session, account.id, date(2026, 7, 15), "SMALL COFFEE             CITY", -4.00)

    groups = transaction_groups(db_session, no_filters())

    assert [g.merchant for g in groups] == ["SMALL COFFEE", "BIG SUBSCRIPTION"]


def test_sample_narration_is_the_most_recent_occurrence(db_session):

    account = make_account(db_session)

    make_transaction(db_session, account.id, date(2026, 7, 1), "IGA NEWPORT              NEWPORT  1111", -4.45)
    make_transaction(db_session, account.id, date(2026, 7, 20), "IGA NEWPORT              NEWPORT  9999", -5.00)

    groups = transaction_groups(db_session, no_filters())

    assert groups[0].sample_narration == "IGA NEWPORT              NEWPORT  9999"


def test_groups_endpoint_returns_the_same_shape(client, db_session):

    account = make_account(db_session)

    make_transaction(db_session, account.id, date(2026, 7, 1), "IGA NEWPORT              NEWPORT", -4.45)
    make_transaction(db_session, account.id, date(2026, 7, 8), "IGA NEWPORT              NEWPORT", -5.00)
    db_session.commit()

    response = client.get("/api/transactions/groups")

    assert response.status_code == 200
    body = response.json()
    assert len(body["groups"]) == 1
    group = body["groups"][0]
    assert group["merchant"] == "IGA NEWPORT"
    assert group["transaction_count"] == 2
    assert len(group["transaction_ids"]) == 2
    assert group["uncategorized_count"] == 2
    assert group["category_names"] == []
    assert group["split_count"] == 0


def test_uncategorized_count_counts_only_rows_with_no_category(db_session):

    account = make_account(db_session)
    category = make_category(db_session)

    make_transaction(db_session, account.id, date(2026, 7, 1), "IGA NEWPORT              NEWPORT", -4.45)
    make_transaction(
        db_session, account.id, date(2026, 7, 8), "IGA NEWPORT              NEWPORT", -5.00,
        category_id=category.id,
    )

    groups = transaction_groups(db_session, no_filters(), include_categorized=True)

    assert len(groups) == 1
    assert groups[0].uncategorized_count == 1
    assert groups[0].category_names == ["Groceries"]
    assert groups[0].split_count == 0


def test_split_row_counts_toward_split_count_never_uncategorized(db_session):
    """A split transaction's own category_id is NULL, but it IS categorized
    via its allocations (see TransactionSplit's docstring) - it must never
    be reported as uncategorized, the same distinction the ledger's own
    `uncategorized` filter and categorization.py already make.
    """

    account = make_account(db_session)
    category = make_category(db_session)

    split_transaction = make_transaction(
        db_session, account.id, date(2026, 7, 1), "IGA NEWPORT              NEWPORT", -10.00,
    )
    db_session.add(TransactionSplit(
        transaction_id=split_transaction.id, category_id=category.id, amount=Decimal("-6.00")
    ))
    db_session.add(TransactionSplit(
        transaction_id=split_transaction.id, category_id=None, amount=Decimal("-4.00")
    ))
    make_transaction(db_session, account.id, date(2026, 7, 8), "IGA NEWPORT              NEWPORT", -5.00)

    groups = transaction_groups(db_session, no_filters(), include_categorized=True)

    assert len(groups) == 1
    assert groups[0].split_count == 1
    assert groups[0].uncategorized_count == 1  # only the second, genuinely uncategorized row


def test_category_names_lists_distinct_categories_sorted(db_session):

    account = make_account(db_session)
    groceries = make_category(db_session, name="Groceries")
    dining = make_category(db_session, name="Dining")

    make_transaction(
        db_session, account.id, date(2026, 7, 1), "MIXED MERCHANT           SUBURB", -4.45,
        category_id=groceries.id,
    )
    make_transaction(
        db_session, account.id, date(2026, 7, 8), "MIXED MERCHANT           SUBURB", -5.00,
        category_id=dining.id,
    )

    groups = transaction_groups(db_session, no_filters(), include_categorized=True)

    assert groups[0].category_names == ["Dining", "Groceries"]


def test_default_mode_still_reports_every_row_uncategorized(db_session):
    """include_categorized=False (the default) already forces uncategorized-
    only, so every returned row's own uncategorized_count naturally equals
    its transaction_count - a sanity check that the new fields agree with
    the pre-existing filter override rather than contradicting it.
    """

    account = make_account(db_session)

    make_transaction(db_session, account.id, date(2026, 7, 1), "IGA NEWPORT              NEWPORT", -4.45)
    make_transaction(db_session, account.id, date(2026, 7, 8), "IGA NEWPORT              NEWPORT", -5.00)

    groups = transaction_groups(db_session, no_filters())

    assert groups[0].uncategorized_count == groups[0].transaction_count == 2
    assert groups[0].category_names == []


def test_include_categorized_covers_categorized_rows_too(db_session):

    account = make_account(db_session)
    category = make_category(db_session)

    make_transaction(db_session, account.id, date(2026, 7, 1), "IGA NEWPORT              NEWPORT", -4.45)
    make_transaction(
        db_session, account.id, date(2026, 7, 8), "IGA NEWPORT              NEWPORT", -5.00,
        category_id=category.id,
    )

    default_groups = transaction_groups(db_session, no_filters())
    assert default_groups == []

    all_groups = transaction_groups(db_session, no_filters(), include_categorized=True)
    assert len(all_groups) == 1
    assert all_groups[0].transaction_count == 2


def test_include_categorized_does_not_override_an_incoming_category_filter(db_session):
    """Unlike the default (uncategorized-only) mode, include_categorized=True
    passes the caller's own category_id/uncategorized filters through
    untouched rather than overriding them.
    """

    account = make_account(db_session)
    category = make_category(db_session)
    other_category = make_category(db_session, name="Other", kind="expense")

    make_transaction(
        db_session, account.id, date(2026, 7, 1), "IGA NEWPORT              NEWPORT", -4.45,
        category_id=category.id,
    )
    make_transaction(
        db_session, account.id, date(2026, 7, 8), "IGA NEWPORT              NEWPORT", -5.00,
        category_id=other_category.id,
    )

    groups = transaction_groups(
        db_session, no_filters(category_id=category.id), include_categorized=True
    )

    assert len(groups) == 0  # only 1 row matches category_id=category.id - below MIN_GROUP_SIZE


def test_groups_endpoint_include_categorized_query_param(client, db_session):

    account = make_account(db_session)
    category = make_category(db_session)

    make_transaction(db_session, account.id, date(2026, 7, 1), "IGA NEWPORT              NEWPORT", -4.45)
    make_transaction(
        db_session, account.id, date(2026, 7, 8), "IGA NEWPORT              NEWPORT", -5.00,
        category_id=category.id,
    )
    db_session.commit()

    default_response = client.get("/api/transactions/groups")
    assert default_response.json()["groups"] == []

    included_response = client.get("/api/transactions/groups", params={"include_categorized": "true"})
    assert len(included_response.json()["groups"]) == 1


def test_groups_endpoint_rejects_inverted_date_range(client):

    response = client.get(
        "/api/transactions/groups",
        params={"date_from": "2026-07-31", "date_to": "2026-07-01"},
    )

    assert response.status_code == 422


# --- Filter pass-through with include_categorized=True -----------------------
# The bug this whole file gained a section for: without forwarding these,
# "Uncategorized only" + grouping showed groups spanning categorized rows,
# and an account-group filter was silently ignored by the grouped view.

def test_groups_endpoint_honours_uncategorized_only_with_include_categorized(client, db_session):

    account = make_account(db_session)
    category = make_category(db_session)

    make_transaction(db_session, account.id, date(2026, 7, 1), "IGA NEWPORT              NEWPORT", -4.45)
    make_transaction(
        db_session, account.id, date(2026, 7, 8), "IGA NEWPORT              NEWPORT", -5.00,
        category_id=category.id,
    )
    db_session.commit()

    response = client.get("/api/transactions/groups", params={
        "include_categorized": "true", "uncategorized": "true",
    })

    assert response.status_code == 200
    groups = response.json()["groups"]
    # Below MIN_GROUP_SIZE once the categorized row is excluded by the filter.
    assert groups == []


def test_groups_endpoint_honours_category_id_with_include_categorized(client, db_session):

    account = make_account(db_session)
    groceries = make_category(db_session, name="Groceries")
    dining = make_category(db_session, name="Dining")

    make_transaction(
        db_session, account.id, date(2026, 7, 1), "IGA NEWPORT              NEWPORT", -4.45,
        category_id=groceries.id,
    )
    make_transaction(
        db_session, account.id, date(2026, 7, 8), "IGA NEWPORT              NEWPORT", -5.00,
        category_id=dining.id,
    )
    db_session.commit()

    response = client.get("/api/transactions/groups", params={
        "include_categorized": "true", "category_id": groceries.id,
    })

    assert response.status_code == 200
    # Only 1 row matches category_id=groceries.id - below MIN_GROUP_SIZE.
    assert response.json()["groups"] == []


def test_groups_endpoint_honours_account_group_id(client, db_session):

    from app.models import AccountGroup

    group = AccountGroup(name="Visa")
    db_session.add(group)
    db_session.flush()

    in_group = make_account(db_session, name="Old Visa", account_number="AAAA")
    in_group.group_id = group.id
    other = make_account(db_session, name="Other Card", account_number="BBBB")

    make_transaction(db_session, in_group.id, date(2026, 7, 1), "IGA NEWPORT              NEWPORT", -4.45, account_number="AAAA")
    make_transaction(db_session, in_group.id, date(2026, 7, 8), "IGA NEWPORT              NEWPORT", -5.00, account_number="AAAA")
    make_transaction(db_session, other.id, date(2026, 7, 8), "IGA NEWPORT              NEWPORT", -6.00, account_number="BBBB")
    db_session.commit()

    response = client.get("/api/transactions/groups", params={"account_group_id": group.id})

    assert response.status_code == 200
    groups = response.json()["groups"]
    assert len(groups) == 1
    assert groups[0]["transaction_count"] == 2  # only the grouped account's rows


def test_groups_endpoint_rejects_uncategorized_with_category_id(client):

    response = client.get("/api/transactions/groups", params={"uncategorized": "true", "category_id": 1})

    assert response.status_code == 422


def test_groups_endpoint_rejects_account_id_with_account_group_id(client):

    response = client.get("/api/transactions/groups", params={"account_id": 1, "account_group_id": 1})

    assert response.status_code == 422
