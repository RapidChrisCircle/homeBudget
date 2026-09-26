from datetime import date
from decimal import Decimal

from app.models import Account, Category, ImportBatch, RecurringDismissal, Transaction
from app.services.alerts import collect_alerts, dismiss_alert


def make_account(db_session, name="Joint Everyday", account_number="1111"):

    account = Account(name=name, account_number=account_number)
    db_session.add(account)
    db_session.flush()
    return account


def make_category(db_session, name="Groceries", kind="expense", budget_amount=None):

    category = Category(name=name, kind=kind, budget_amount=budget_amount)
    db_session.add(category)
    db_session.flush()
    return category


def make_transaction(db_session, transaction_date, narration="Coffee", debit=None, credit=None,
                      category_id=None, account_id=None, account_number="1111", balance="100.00"):

    batch = ImportBatch(filename="seed.csv", row_count=0, skipped_duplicate_count=0)
    db_session.add(batch)
    db_session.flush()

    transaction = Transaction(
        import_batch_id=batch.id,
        account_id=account_id,
        category_id=category_id,
        account_number=account_number,
        transaction_date=transaction_date,
        narration=narration,
        debit=debit,
        credit=credit,
        balance=balance,
        transaction_type="WDL" if debit is not None else "DEP",
    )
    db_session.add(transaction)
    db_session.flush()
    return transaction


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


def seed_recurring_series(db_session, dates, amounts, narration="NETFLIX.COM", account_id=None):

    if account_id is None:
        account_id = make_account(db_session).id

    for occurrence_date, amount in zip(dates, amounts):
        make_transaction(
            db_session, occurrence_date, narration=narration, debit=Decimal(str(-abs(amount))),
            account_id=account_id,
        )

    return account_id


# --- over-budget --------------------------------------------------------------

def test_over_budget_alert_appears(db_session):

    category = make_category(db_session, budget_amount=Decimal("100.00"))
    make_transaction(db_session, date(2026, 7, 10), debit=Decimal("-150.00"),
                      category_id=category.id, account_id=make_account(db_session).id)
    db_session.commit()

    alerts = collect_alerts(db_session)
    over_budget = [a for a in alerts if a.kind == "over_budget"]

    assert len(over_budget) == 1
    assert over_budget[0].key == f"over_budget:{category.id}:2026:7"
    assert over_budget[0].amount == Decimal("50.00")
    assert over_budget[0].dismiss_kind == "generic"


def test_dismissing_an_over_budget_alert_removes_it(db_session):

    category = make_category(db_session, budget_amount=Decimal("100.00"))
    make_transaction(db_session, date(2026, 7, 10), debit=Decimal("-150.00"),
                      category_id=category.id, account_id=make_account(db_session).id)
    db_session.commit()

    key = f"over_budget:{category.id}:2026:7"
    dismiss_alert(db_session, key)

    alerts = collect_alerts(db_session)

    assert all(a.key != key for a in alerts)


def test_dismissing_one_key_does_not_suppress_a_different_categorys_alert(db_session):

    category_a = make_category(db_session, "Groceries", budget_amount=Decimal("100.00"))
    category_b = make_category(db_session, "Fuel", budget_amount=Decimal("50.00"))
    account = make_account(db_session)
    make_transaction(db_session, date(2026, 7, 10), debit=Decimal("-150.00"), category_id=category_a.id, account_id=account.id)
    make_transaction(db_session, date(2026, 7, 11), debit=Decimal("-80.00"), category_id=category_b.id, account_id=account.id)
    db_session.commit()

    dismiss_alert(db_session, f"over_budget:{category_a.id}:2026:7")

    alerts = collect_alerts(db_session)
    keys = {a.key for a in alerts}

    assert f"over_budget:{category_a.id}:2026:7" not in keys
    assert f"over_budget:{category_b.id}:2026:7" in keys


def test_dismiss_alert_is_idempotent(db_session):

    first_id = dismiss_alert(db_session, "over_budget:1:2026:7")
    second_id = dismiss_alert(db_session, "over_budget:1:2026:7")

    assert first_id == second_id


# --- coverage gaps --------------------------------------------------------------

def test_coverage_gap_alert_appears_and_can_be_dismissed(db_session):

    account = make_account(db_session)
    make_transaction(db_session, date(2026, 1, 1), account_id=account.id, credit=Decimal("1000.00"), balance="1000.00")
    # A gap: balance jumps without matching activity.
    make_transaction(db_session, date(2026, 3, 1), account_id=account.id, debit=Decimal("-50.00"), balance="500.00")
    db_session.commit()

    alerts = collect_alerts(db_session)
    gap_alerts = [a for a in alerts if a.kind == "coverage_gap"]

    assert len(gap_alerts) == 1
    assert gap_alerts[0].dismiss_kind == "generic"
    key = gap_alerts[0].key

    dismiss_alert(db_session, key)

    alerts_after = collect_alerts(db_session)
    assert all(a.key != key for a in alerts_after)


# --- unmatched transfers --------------------------------------------------------

def test_unmatched_transfer_alert_appears_and_can_be_dismissed(db_session):

    account = make_account(db_session)
    transfer_category = make_category(db_session, "Card Payment", kind="transfer")
    lonely = make_transaction(
        db_session, date(2026, 1, 5), narration="Lonely Transfer", debit=Decimal("-300.00"),
        category_id=transfer_category.id, account_id=account.id,
    )
    db_session.commit()

    alerts = collect_alerts(db_session)
    transfer_alerts = [a for a in alerts if a.kind == "unmatched_transfer"]

    assert len(transfer_alerts) == 1
    assert transfer_alerts[0].key == f"unmatched_transfer:{lonely.id}"
    assert transfer_alerts[0].dismiss_kind == "generic"

    dismiss_alert(db_session, transfer_alerts[0].key)

    alerts_after = collect_alerts(db_session)
    assert all(a.kind != "unmatched_transfer" for a in alerts_after)


# --- recurring: missed/stopped and price change ---------------------------------

def test_ended_recurring_series_produces_a_missed_recurring_alert(db_session):

    account_id = make_account(db_session).id
    dates = monthly_dates(date(2026, 1, 15), 4)
    seed_recurring_series(db_session, dates, [15.99] * 4, account_id=account_id)
    # Two full intervals past the next due date.
    make_transaction(db_session, date(2026, 7, 20), narration="UNRELATED SHOP", debit=Decimal("-20.00"), account_id=account_id)
    db_session.commit()

    alerts = collect_alerts(db_session)
    missed = [a for a in alerts if a.kind == "missed_recurring"]

    assert len(missed) == 1
    assert missed[0].dismiss_kind == "recurring"
    assert missed[0].recurring_account_id == account_id
    assert missed[0].recurring_narration_key


def test_dismissing_via_the_existing_recurring_mechanism_removes_the_alert(db_session):

    account_id = make_account(db_session).id
    dates = monthly_dates(date(2026, 1, 15), 4)
    seed_recurring_series(db_session, dates, [15.99] * 4, account_id=account_id)
    make_transaction(db_session, date(2026, 7, 20), narration="UNRELATED SHOP", debit=Decimal("-20.00"), account_id=account_id)
    db_session.commit()

    missed = [a for a in collect_alerts(db_session) if a.kind == "missed_recurring"][0]

    db_session.add(RecurringDismissal(account_id=missed.recurring_account_id, narration_key=missed.recurring_narration_key))
    db_session.commit()

    alerts_after = collect_alerts(db_session)
    assert all(a.kind != "missed_recurring" for a in alerts_after)


def test_price_change_produces_a_price_change_alert(db_session):

    dates = monthly_dates(date(2026, 1, 15), 5)
    amounts = [15.99, 15.99, 15.99, 15.99, 18.99]
    seed_recurring_series(db_session, dates, amounts)
    db_session.commit()

    alerts = collect_alerts(db_session)
    changed = [a for a in alerts if a.kind == "price_change"]

    assert len(changed) == 1
    assert changed[0].amount == Decimal("18.99")
    assert changed[0].dismiss_kind == "recurring"


# --- API -------------------------------------------------------------------------

def test_get_alerts_shape_and_count(client, db_session):

    category = make_category(db_session, budget_amount=Decimal("100.00"))
    make_transaction(db_session, date(2026, 7, 10), debit=Decimal("-150.00"),
                      category_id=category.id, account_id=make_account(db_session).id)
    db_session.commit()

    body = client.get("/api/alerts").json()

    assert body["count"] == len(body["alerts"])
    assert body["count"] >= 1
    assert any(a["kind"] == "over_budget" for a in body["alerts"])


def test_post_alert_dismissal_removes_it_from_the_feed_and_updates_the_count(client, db_session):

    category = make_category(db_session, budget_amount=Decimal("100.00"))
    make_transaction(db_session, date(2026, 7, 10), debit=Decimal("-150.00"),
                      category_id=category.id, account_id=make_account(db_session).id)
    db_session.commit()

    before = client.get("/api/alerts").json()
    key = next(a["key"] for a in before["alerts"] if a["kind"] == "over_budget")

    response = client.post("/api/alerts/dismissals", json={"alert_key": key})
    assert response.status_code == 201

    after = client.get("/api/alerts").json()
    assert all(a["key"] != key for a in after["alerts"])
    assert after["count"] == before["count"] - 1


def test_delete_alert_dismissal_restores_it(client, db_session):

    category = make_category(db_session, budget_amount=Decimal("100.00"))
    make_transaction(db_session, date(2026, 7, 10), debit=Decimal("-150.00"),
                      category_id=category.id, account_id=make_account(db_session).id)
    db_session.commit()

    key = next(a["key"] for a in client.get("/api/alerts").json()["alerts"] if a["kind"] == "over_budget")
    dismissal_id = client.post("/api/alerts/dismissals", json={"alert_key": key}).json()["id"]

    assert all(a["key"] != key for a in client.get("/api/alerts").json()["alerts"])

    response = client.delete(f"/api/alerts/dismissals/{dismissal_id}")
    assert response.status_code == 204

    assert any(a["key"] == key for a in client.get("/api/alerts").json()["alerts"])


def test_delete_alert_dismissal_404s_for_unknown_id(client):

    response = client.delete("/api/alerts/dismissals/999")

    assert response.status_code == 404


def test_post_alert_dismissal_is_idempotent_via_the_api(client, db_session):

    category = make_category(db_session, budget_amount=Decimal("100.00"))
    make_transaction(db_session, date(2026, 7, 10), debit=Decimal("-150.00"),
                      category_id=category.id, account_id=make_account(db_session).id)
    db_session.commit()

    key = next(a["key"] for a in client.get("/api/alerts").json()["alerts"] if a["kind"] == "over_budget")

    first = client.post("/api/alerts/dismissals", json={"alert_key": key})
    second = client.post("/api/alerts/dismissals", json={"alert_key": key})

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
