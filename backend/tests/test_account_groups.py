from datetime import date
from decimal import Decimal

from app.models import Account, AccountGroup, ImportBatch, Transaction
from app.services.net_worth import net_worth_history, net_worth_now
from app.services.reporting import contiguous_periods


def make_account(db_session, name, account_number, account_type="credit_card", balance_sign="natural", group_id=None):

    account = Account(
        name=name, account_number=account_number, account_type=account_type,
        balance_sign=balance_sign, group_id=group_id,
    )
    db_session.add(account)
    db_session.flush()
    return account


def make_transaction(db_session, account_id, transaction_date, balance, account_number, narration="Statement"):

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
        debit="-5.00",
        credit=None,
        balance=balance,
        transaction_type="WDL",
    )
    db_session.add(transaction)
    db_session.flush()
    return transaction


def make_group(db_session, name="Visa"):

    group = AccountGroup(name=name)
    db_session.add(group)
    db_session.flush()
    return group


# --- The double-count regression --------------------------------------------

def test_group_prevents_double_counting_old_and_replacement_card(db_session):

    group = make_group(db_session)
    old_card = make_account(db_session, "Old Visa", "AAAA", group_id=group.id)
    new_card = make_account(db_session, "New Visa", "BBBB", group_id=group.id)

    make_transaction(db_session, old_card.id, date(2026, 1, 1), balance="-500.00", account_number="AAAA")
    make_transaction(db_session, new_card.id, date(2026, 7, 1), balance="-500.00", account_number="BBBB")
    db_session.commit()

    result = net_worth_now(db_session)

    assert result["liabilities"] == Decimal("500.00")
    assert result["net"] == Decimal("-500.00")


def test_group_contribution_switches_to_the_newer_member_without_double_counting_in_history(db_session):
    """The newest member whose first transaction has started is the sole
    contributor at each period - proven with DIFFERENT balances either
    side of the handover, so a naive sum (which would double-count as
    -1100.00 in July) is distinguishable from the correct -600.00.
    """

    group = make_group(db_session)
    old_card = make_account(db_session, "Old Visa", "AAAA", group_id=group.id)
    new_card = make_account(db_session, "New Visa", "BBBB", group_id=group.id)

    make_transaction(db_session, old_card.id, date(2026, 5, 1), balance="-500.00", account_number="AAAA")
    make_transaction(db_session, new_card.id, date(2026, 7, 1), balance="-600.00", account_number="BBBB")
    db_session.commit()

    periods = contiguous_periods(2026, 7, 3)  # May, June, July
    history = net_worth_history(db_session, periods)

    assert history[(2026, 5)] == Decimal("-500.00")
    assert history[(2026, 6)] == Decimal("-500.00")  # old card carries forward - new hasn't started
    assert history[(2026, 7)] == Decimal("-600.00")  # new card takes over, not -1100.00


def test_ungrouped_account_contributes_normally_alongside_a_group(db_session):

    group = make_group(db_session)
    old_card = make_account(db_session, "Old Visa", "AAAA", group_id=group.id)
    new_card = make_account(db_session, "New Visa", "BBBB", group_id=group.id)
    everyday = make_account(db_session, "Everyday", "CCCC", account_type="everyday")

    make_transaction(db_session, old_card.id, date(2026, 5, 1), balance="-500.00", account_number="AAAA")
    make_transaction(db_session, new_card.id, date(2026, 7, 1), balance="-500.00", account_number="BBBB")
    make_transaction(db_session, everyday.id, date(2026, 7, 1), balance="1000.00", account_number="CCCC")
    db_session.commit()

    result = net_worth_now(db_session)

    assert result["assets"] == Decimal("1000.00")
    assert result["liabilities"] == Decimal("500.00")
    assert result["net"] == Decimal("500.00")


def test_group_member_that_has_not_started_yet_contributes_nothing(db_session):

    group = make_group(db_session)
    old_card = make_account(db_session, "Old Visa", "AAAA", group_id=group.id)
    make_account(db_session, "New Visa", "BBBB", group_id=group.id)  # no transactions yet

    make_transaction(db_session, old_card.id, date(2026, 5, 1), balance="-500.00", account_number="AAAA")
    db_session.commit()

    result = net_worth_now(db_session)

    assert result["liabilities"] == Decimal("500.00")


# --- Group management --------------------------------------------------------

def test_delete_group_unlinks_members_instead_of_deleting_them(client, db_session):

    group = make_group(db_session, "Visa")
    account = make_account(db_session, "Old Visa", "AAAA", group_id=group.id)
    db_session.commit()

    response = client.delete(f"/api/account-groups/{group.id}")
    assert response.status_code == 204

    body = client.get(f"/api/accounts/{account.id}").json()
    assert body["group_id"] is None

    # The group itself is gone, but the account survives.
    assert client.get("/api/account-groups").json() == []


def test_create_and_list_account_groups(client):

    response = client.post("/api/account-groups", json={"name": "Visa"})
    assert response.status_code == 201
    group_id = response.json()["id"]

    groups = client.get("/api/account-groups").json()
    assert [g["name"] for g in groups] == ["Visa"]
    assert groups[0]["id"] == group_id


def test_rename_account_group(client):

    group_id = client.post("/api/account-groups", json={"name": "Visa"}).json()["id"]

    response = client.put(f"/api/account-groups/{group_id}", json={"name": "Visa (renamed)"})

    assert response.status_code == 200
    assert response.json()["name"] == "Visa (renamed)"


def test_assign_account_to_group_via_update(client):

    group_id = client.post("/api/account-groups", json={"name": "Visa"}).json()["id"]
    account = client.post("/api/accounts", json={
        "name": "Old Visa", "account_number": "AAAA", "account_type": "credit_card",
    }).json()

    response = client.put(f"/api/accounts/{account['id']}", json={
        "name": "Old Visa", "account_number": "AAAA", "account_type": "credit_card",
        "balance_sign": "natural", "group_id": group_id,
    })

    assert response.status_code == 200
    assert response.json()["group_id"] == group_id
    assert response.json()["group_name"] == "Visa"


def test_create_account_with_nonexistent_group_id_is_rejected(client):

    response = client.post("/api/accounts", json={
        "name": "Old Visa", "account_number": "AAAA", "group_id": 999,
    })

    assert response.status_code == 404


# --- Ledger filtering --------------------------------------------------------

def test_account_group_id_filters_to_every_member(client, db_session):

    group = make_group(db_session)
    old_card = make_account(db_session, "Old Visa", "AAAA", group_id=group.id)
    new_card = make_account(db_session, "New Visa", "BBBB", group_id=group.id)
    other = make_account(db_session, "Other Card", "CCCC")

    make_transaction(db_session, old_card.id, date(2026, 5, 1), balance="-500.00", account_number="AAAA")
    make_transaction(db_session, new_card.id, date(2026, 7, 1), balance="-500.00", account_number="BBBB")
    make_transaction(db_session, other.id, date(2026, 7, 1), balance="-100.00", account_number="CCCC")
    db_session.commit()

    response = client.get("/api/transactions", params={"account_group_id": group.id, "page_size": 200})

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert {t["account_number"] for t in body["items"]} == {"AAAA", "BBBB"}


def test_account_id_and_account_group_id_are_contradictory(client, db_session):

    group = make_group(db_session)
    db_session.commit()

    response = client.get("/api/transactions", params={"account_id": 1, "account_group_id": group.id})

    assert response.status_code == 422


# --- Stitched balance history -------------------------------------------------

def test_account_detail_shows_the_groups_stitched_balance_history(client, db_session):

    group = make_group(db_session)
    old_card = make_account(db_session, "Old Visa", "AAAA", group_id=group.id)
    new_card = make_account(db_session, "New Visa", "BBBB", group_id=group.id)

    make_transaction(db_session, old_card.id, date(2026, 5, 1), balance="-500.00", account_number="AAAA")
    make_transaction(db_session, new_card.id, date(2026, 7, 1), balance="-600.00", account_number="BBBB")
    db_session.commit()

    # Both members show the SAME stitched series - they're one logical account.
    for account_id in (old_card.id, new_card.id):
        response = client.get(f"/api/accounts/{account_id}/balance-history", params={"months": 3})
        assert response.status_code == 200
        balances = response.json()["balances"]
        assert balances["2026-05"] == "-500.00"
        assert balances["2026-06"] == "-500.00"
        assert balances["2026-07"] == "-600.00"
