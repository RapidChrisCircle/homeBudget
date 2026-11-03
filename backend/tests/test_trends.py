import io
from datetime import date
from decimal import Decimal

from app.models import Category, CategoryBudget, ImportBatch, Transaction, TransactionSplit
from app.services.reporting import (
    category_grid,
    category_totals_for_period,
    month_bounds,
    monthly_summary,
)
from app.services.trends import budget_totals, monthly_summaries, top_movers


def make_category(db_session, name="Groceries", kind="expense", budget_amount=None):

    category = Category(name=name, kind=kind, budget_amount=budget_amount)
    db_session.add(category)
    db_session.flush()
    return category


def make_transaction(db_session, transaction_date=date(2026, 7, 24), narration="Coffee",
                     debit=None, credit=None, transaction_type="WDL", category_id=None,
                     account_number="1111"):

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
        transaction_type=transaction_type,
    )
    db_session.add(transaction)
    db_session.flush()
    return transaction


def test_monthly_summaries_agrees_with_reportings_own_single_month_summary(db_session):
    # The invariant this whole module exists to guarantee: /trends and
    # /reports must never be able to disagree about the same month, because
    # both are derived from category_grid()'s rows, not independent queries.
    groceries = make_category(db_session, name="Groceries", kind="expense")
    salary = make_category(db_session, name="Salary", kind="income")

    make_transaction(db_session, transaction_date=date(2026, 7, 10), debit="-60.00", category_id=groceries.id)
    make_transaction(db_session, transaction_date=date(2026, 7, 15), credit="5000.00", category_id=salary.id)
    # Activity in an earlier month too, so the grid spans more than one period.
    make_transaction(db_session, transaction_date=date(2026, 6, 5), debit="-40.00", category_id=groceries.id)
    db_session.commit()

    periods, grid_rows = category_grid(db_session, 2026, 7, months=3)
    summaries = monthly_summaries(periods, grid_rows)
    july_summary = next(s for s in summaries if s["period"] == (2026, 7))

    start, end = month_bounds(2026, 7)
    totals = category_totals_for_period(db_session, start, end)
    expected_income, expected_spending, expected_net = monthly_summary(totals)

    assert july_summary["total_income"] == expected_income
    assert july_summary["total_spending"] == expected_spending
    assert july_summary["net_saved"] == expected_net


def test_monthly_summaries_agrees_even_for_a_month_with_zero_activity(db_session):
    # A budgeted-but-idle category (kept alive in the grid by the outer-join
    # fix) must contribute zero to both, not throw off the comparison.
    make_category(db_session, name="Idle budget", kind="expense", budget_amount="200.00")
    make_transaction(db_session, transaction_date=date(2026, 7, 10), debit="-10.00")
    db_session.commit()

    periods, grid_rows = category_grid(db_session, 2026, 7, months=1)
    summaries = monthly_summaries(periods, grid_rows)

    start, end = month_bounds(2026, 7)
    totals = category_totals_for_period(db_session, start, end)
    expected_income, expected_spending, expected_net = monthly_summary(totals)

    assert summaries[0]["total_income"] == expected_income
    assert summaries[0]["total_spending"] == expected_spending
    assert summaries[0]["net_saved"] == expected_net


def test_budget_totals_counts_only_budgeted_expense_categories(db_session):

    budgeted = make_category(db_session, name="Groceries", kind="expense", budget_amount="500.00")
    unbudgeted = make_category(db_session, name="Entertainment", kind="expense", budget_amount=None)
    income = make_category(db_session, name="Salary", kind="income", budget_amount=None)

    make_transaction(db_session, transaction_date=date(2026, 7, 10), debit="-300.00", category_id=budgeted.id)
    make_transaction(db_session, transaction_date=date(2026, 7, 12), debit="-999.00", category_id=unbudgeted.id)
    make_transaction(db_session, transaction_date=date(2026, 7, 15), credit="5000.00", category_id=income.id)
    db_session.commit()

    periods, grid_rows = category_grid(db_session, 2026, 7, months=1)
    totals = budget_totals(periods, grid_rows)

    assert totals[0]["budgeted"] == Decimal("500.00")
    # Only the budgeted category's spending counts - the unbudgeted $999 and
    # the income are both excluded from "actual" too.
    assert totals[0]["actual"] == Decimal("300.00")


def test_budget_totals_repeats_the_standing_figure_when_no_override_exists(db_session):
    # No override anywhere in the window - every period resolves to the same
    # standing amount, so the line is flat (not because it can't step, but
    # because nothing told it to).
    make_category(db_session, name="Groceries", kind="expense", budget_amount="500.00")
    make_transaction(db_session, transaction_date=date(2026, 5, 1), debit="-10.00")
    db_session.commit()

    periods, grid_rows = category_grid(db_session, 2026, 7, months=3)
    totals = budget_totals(periods, grid_rows)

    assert [t["budgeted"] for t in totals] == [Decimal("500.00")] * 3


def test_budget_totals_steps_when_an_override_changes_mid_window(db_session):
    # This is the test that would fail against the old flat implementation:
    # an override on one month must change ONLY that month's budgeted figure
    # and actual-scope, not the whole window.
    category = make_category(db_session, name="Groceries", kind="expense", budget_amount="500.00")
    db_session.add(CategoryBudget(category_id=category.id, year=2026, month=6, amount=Decimal("800.00")))
    make_transaction(db_session, transaction_date=date(2026, 6, 5), debit="-600.00", category_id=category.id)
    make_transaction(db_session, transaction_date=date(2026, 7, 5), debit="-450.00", category_id=category.id)
    db_session.commit()

    periods, grid_rows = category_grid(db_session, 2026, 7, months=3)  # May, June, July
    totals = budget_totals(periods, grid_rows)

    assert [t["budgeted"] for t in totals] == [Decimal("500.00"), Decimal("800.00"), Decimal("500.00")]
    assert [t["actual"] for t in totals] == [Decimal("0"), Decimal("600.00"), Decimal("450.00")]


def test_budget_totals_actual_only_counts_categories_budgeted_in_that_specific_period(db_session):
    # A category with a budget in only SOME periods of the window must
    # contribute to "actual" only in those periods, not the whole window -
    # this is what makes budget_totals genuinely per-period rather than
    # "budgeted anywhere in the window, applied everywhere".
    category = make_category(db_session, name="Once-off", kind="expense", budget_amount=None)
    db_session.add(CategoryBudget(category_id=category.id, year=2026, month=6, amount=Decimal("200.00")))
    make_transaction(db_session, transaction_date=date(2026, 5, 5), debit="-50.00", category_id=category.id)
    make_transaction(db_session, transaction_date=date(2026, 6, 5), debit="-150.00", category_id=category.id)
    db_session.commit()

    periods, grid_rows = category_grid(db_session, 2026, 7, months=3)  # May, June, July
    totals = budget_totals(periods, grid_rows)

    may, june, july = totals
    assert may["budgeted"] == Decimal("0") and may["actual"] == Decimal("0")
    assert june["budgeted"] == Decimal("200.00") and june["actual"] == Decimal("150.00")
    assert july["budgeted"] == Decimal("0") and july["actual"] == Decimal("0")


def test_top_movers_ranks_by_absolute_delta_between_the_last_two_periods(db_session):

    groceries = make_category(db_session, name="Groceries", kind="expense")
    fuel = make_category(db_session, name="Fuel", kind="expense")
    dining = make_category(db_session, name="Dining", kind="expense")

    # Groceries: 100 -> 500, delta +400 (the biggest swing)
    make_transaction(db_session, transaction_date=date(2026, 6, 5), debit="-100.00", category_id=groceries.id)
    make_transaction(db_session, transaction_date=date(2026, 7, 5), debit="-500.00", category_id=groceries.id)
    # Fuel: 200 -> 150, delta -50
    make_transaction(db_session, transaction_date=date(2026, 6, 5), debit="-200.00", category_id=fuel.id)
    make_transaction(db_session, transaction_date=date(2026, 7, 5), debit="-150.00", category_id=fuel.id)
    # Dining: 80 -> 80, delta 0 - not a mover at all, must be excluded
    make_transaction(db_session, transaction_date=date(2026, 6, 5), debit="-80.00", category_id=dining.id)
    make_transaction(db_session, transaction_date=date(2026, 7, 5), debit="-80.00", category_id=dining.id)
    db_session.commit()

    periods, grid_rows = category_grid(db_session, 2026, 7, months=2)
    movers = top_movers(periods, grid_rows)

    assert [m["category_name"] for m in movers] == ["Groceries", "Fuel"]
    assert movers[0]["delta"] == Decimal("400.00")
    assert movers[0]["current"] == Decimal("500.00")
    assert movers[0]["prior"] == Decimal("100.00")
    assert movers[1]["delta"] == Decimal("-50.00")


def test_top_movers_respects_the_limit(db_session):

    for i in range(5):
        category = make_category(db_session, name=f"Category {i}", kind="expense")
        make_transaction(db_session, transaction_date=date(2026, 6, 5), debit="-10.00", category_id=category.id)
        make_transaction(db_session, transaction_date=date(2026, 7, 5), debit=f"-{20 + i}.00", category_id=category.id)
    db_session.commit()

    periods, grid_rows = category_grid(db_session, 2026, 7, months=2)
    movers = top_movers(periods, grid_rows, limit=3)

    assert len(movers) == 3


def test_top_movers_includes_income_categories_alongside_expense(db_session):

    salary = make_category(db_session, name="Salary", kind="income")
    make_transaction(db_session, transaction_date=date(2026, 6, 5), credit="4000.00", category_id=salary.id)
    make_transaction(db_session, transaction_date=date(2026, 7, 5), credit="5000.00", category_id=salary.id)
    db_session.commit()

    periods, grid_rows = category_grid(db_session, 2026, 7, months=2)
    movers = top_movers(periods, grid_rows)

    assert movers[0]["category_name"] == "Salary"
    assert movers[0]["kind"] == "income"
    assert movers[0]["delta"] == Decimal("1000.00")


def test_top_movers_returns_empty_with_fewer_than_two_periods(db_session):

    category = make_category(db_session, name="Groceries", kind="expense")
    make_transaction(db_session, transaction_date=date(2026, 7, 5), debit="-50.00", category_id=category.id)
    db_session.commit()

    periods, grid_rows = category_grid(db_session, 2026, 7, months=1)

    assert top_movers(periods, grid_rows) == []


def test_periods_stay_contiguous_when_a_middle_month_has_no_transactions_at_all(db_session):

    category = make_category(db_session)
    make_transaction(db_session, transaction_date=date(2026, 5, 1), debit="-10.00", category_id=category.id)
    # June deliberately has no transactions anywhere.
    make_transaction(db_session, transaction_date=date(2026, 7, 1), debit="-20.00", category_id=category.id)
    db_session.commit()

    periods, grid_rows = category_grid(db_session, 2026, 7, months=3)
    summaries = monthly_summaries(periods, grid_rows)
    totals = budget_totals(periods, grid_rows)

    assert periods == [(2026, 5), (2026, 6), (2026, 7)]
    assert [s["period"] for s in summaries] == periods
    assert [t["period"] for t in totals] == periods

    june = next(s for s in summaries if s["period"] == (2026, 6))
    assert june["total_spending"] == Decimal("0")


def test_get_trends_endpoint_returns_periods_categories_monthly_and_budget(client):

    category_id = client.post(
        "/api/categories", json={"name": "Groceries", "kind": "expense", "budget_amount": "500.00"}
    ).json()["id"]

    header = "BSB Number,Account Number,Transaction Date,Narration,Cheque Number,Debit,Credit,Balance,Transaction Type\n"
    row = ',1111,24/07/2026,"Coffee",,-5.00,,100.00,WDL\n'
    client.post(
        "/api/transactions/import",
        files={"file": ("t.csv", io.BytesIO((header + row).encode("utf-8")), "text/csv")},
    )
    transaction = client.get("/api/transactions?page_size=1").json()["items"][0]
    client.patch(f"/api/transactions/{transaction['id']}/category", json={"category_id": category_id})

    # An imported account starts UNCLASSIFIED (account_type NULL) and is
    # excluded from net worth until classified - see services/net_worth.py.
    # Classify it here so `balances` (now net-worth-aware, not a straight
    # sum) has something real to report for this test's own assertion.
    account = client.get(f"/api/accounts/{transaction['account_id']}").json()
    client.put(f"/api/accounts/{transaction['account_id']}", json={**account, "account_type": "everyday"})

    response = client.get("/api/trends?months=2")

    assert response.status_code == 200
    body = response.json()
    assert len(body["periods"]) == 2
    assert len(body["monthly"]) == 2
    assert len(body["budget"]) == 2
    assert len(body["balances"]) == 2
    assert any(c["category_id"] == category_id for c in body["categories"])
    assert body["balances"][-1] == {"label": "2026-07", "balance": "100.00"}


def test_get_trends_rejects_year_without_month(client):

    response = client.get("/api/trends?year=2026")

    assert response.status_code == 422


def test_trends_categories_carry_their_parent(client, db_session):
    """/trends' own chart rolls leaves up into their group and drills back
    down into it, so each row has to name the group it belongs to.
    """

    parent = make_category(db_session, name="Food")
    child = make_category(db_session, name="Groceries")
    child.parent_id = parent.id
    make_transaction(db_session, date(2026, 7, 10), debit=Decimal("-50.00"), category_id=child.id)
    db_session.commit()

    body = client.get("/api/trends?year=2026&month=7&months=1").json()
    row = next(c for c in body["categories"] if c["category_id"] == child.id)

    assert row["parent_id"] == parent.id
    assert row["parent_name"] == "Food"
    assert row["transaction_count"] == 1
    assert row["first_date"] == "2026-07-10"
    assert row["last_date"] == "2026-07-10"
    assert row["average_spend"] == "50.00"


def test_top_movers_carries_parent_name_for_subcategories(db_session):

    parent = make_category(db_session, name="Food")
    child = make_category(db_session, name="Groceries")
    child.parent_id = parent.id

    make_transaction(db_session, transaction_date=date(2026, 6, 5), debit="-100.00", category_id=child.id)
    make_transaction(db_session, transaction_date=date(2026, 7, 5), debit="-350.00", category_id=child.id)
    db_session.commit()

    periods, grid_rows = category_grid(db_session, 2026, 7, months=2)
    movers = top_movers(periods, grid_rows)

    assert len(movers) == 1
    assert movers[0]["category_name"] == "Groceries"
    assert movers[0]["parent_name"] == "Food"


def test_get_trends_merchants_returns_sorted_merchants_including_singletons_and_splits(client, db_session):
    parent = make_category(db_session, name="Lifestyle", kind="expense")
    dining = make_category(db_session, name="Dining Out & Takeaway", kind="expense")
    dining.parent_id = parent.id
    groceries = make_category(db_session, name="Groceries", kind="expense")

    # Repeated merchant: two visits totaling 85.00
    t1 = make_transaction(
        db_session,
        transaction_date=date(2026, 6, 10),
        narration="UBER *EATS  123456",
        debit=Decimal("-35.00"),
        category_id=dining.id,
    )
    t2 = make_transaction(
        db_session,
        transaction_date=date(2026, 7, 12),
        narration="UBER *EATS  789012",
        debit=Decimal("-50.00"),
        category_id=dining.id,
    )
    # Single-visit merchant: 120.00 (must NOT be filtered out by MIN_GROUP_SIZE)
    t3 = make_transaction(
        db_session,
        transaction_date=date(2026, 7, 20),
        narration="BISTRO LA VUE",
        debit=Decimal("-120.00"),
        category_id=dining.id,
    )
    # Split transaction: 40.00 allocated to Dining Out & Takeaway, 60.00 to Groceries
    t4 = make_transaction(
        db_session,
        transaction_date=date(2026, 7, 22),
        narration="COSTCO WHOLESALE",
        debit=Decimal("-100.00"),
        category_id=None,
    )
    db_session.add_all([
        TransactionSplit(transaction_id=t4.id, category_id=dining.id, amount=Decimal("-40.00")),
        TransactionSplit(transaction_id=t4.id, category_id=groceries.id, amount=Decimal("-60.00")),
    ])
    db_session.commit()

    response = client.get(f"/api/trends/merchants?category_id={dining.id}&year=2026&month=7&months=2")
    assert response.status_code == 200
    body = response.json()

    assert body["category_id"] == dining.id
    assert body["category_name"] == "Dining Out & Takeaway"
    assert body["parent_id"] == parent.id
    assert body["parent_name"] == "Lifestyle"
    assert body["total_spent"] == "245.00"

    merchants = body["merchants"]
    assert [m["merchant"] for m in merchants] == ["BISTRO LA VUE", "UBER *EATS", "COSTCO WHOLESALE"]
    assert [m["total_spent"] for m in merchants] == ["120.00", "85.00", "40.00"]
    assert [m["average_spend"] for m in merchants] == ["120.00", "42.50", "40.00"]
    assert [m["transaction_count"] for m in merchants] == [1, 2, 1]
    assert [m["nickname"] for m in merchants] == [None, None, None]
    assert merchants[0]["transaction_ids"] == [t3.id]
    assert set(merchants[1]["transaction_ids"]) == {t1.id, t2.id}
    assert merchants[2]["transaction_ids"] == [t4.id]


def test_put_merchant_nickname_sets_updates_and_clears_nickname(client, db_session):
    dining = make_category(db_session, name="Dining Out & Takeaway", kind="expense")
    make_transaction(
        db_session,
        transaction_date=date(2026, 7, 12),
        narration="UBER *EATS  789012",
        debit=Decimal("-50.00"),
        category_id=dining.id,
    )
    db_session.commit()

    # Set nickname
    put_res = client.put(
        "/api/trends/merchants/nickname",
        json={"narration_key": "UBER *EATS", "nickname": "Uber Eats"},
    )
    assert put_res.status_code == 200
    assert put_res.json() == {"narration_key": "UBER *EATS", "nickname": "Uber Eats"}

    merchants = client.get(f"/api/trends/merchants?category_id={dining.id}&year=2026&month=7&months=1").json()["merchants"]
    assert merchants[0]["nickname"] == "Uber Eats"

    # Clear nickname with empty string
    clear_res = client.put(
        "/api/trends/merchants/nickname",
        json={"narration_key": "UBER *EATS", "nickname": "   "},
    )
    assert clear_res.status_code == 200
    assert clear_res.json() == {"narration_key": "UBER *EATS", "nickname": None}

    merchants_after = client.get(f"/api/trends/merchants?category_id={dining.id}&year=2026&month=7&months=1").json()["merchants"]
    assert merchants_after[0]["nickname"] is None


def test_get_trends_merchants_validates_category_and_period_params(client):
    assert client.get("/api/trends/merchants?category_id=9999").status_code == 404
    assert client.get("/api/trends/merchants?category_id=1&year=2026").status_code == 422
    assert client.put("/api/trends/merchants/nickname", json={"narration_key": "  ", "nickname": "X"}).status_code == 422


def test_merchant_nicknames_across_rules_ledger_and_management_endpoints(client, db_session):
    dining = make_category(db_session, name="Dining Out", kind="expense")
    t1 = make_transaction(
        db_session,
        transaction_date=date(2026, 7, 12),
        narration="UBER *EATS 1111",
        debit=Decimal("-25.00"),
        category_id=dining.id,
    )
    t2 = make_transaction(
        db_session,
        transaction_date=date(2026, 7, 15),
        narration="UBER *EATS 2222",
        debit=Decimal("-35.00"),
        category_id=dining.id,
    )
    t3 = make_transaction(
        db_session,
        transaction_date=date(2026, 7, 18),
        narration="LS TAQUIZA NEWPORT",
        debit=Decimal("-45.00"),
        category_id=dining.id,
    )
    db_session.commit()

    # 1. Create a category rule with merchant_nickname
    rule_res = client.post(
        "/api/category-rules",
        json={
            "narration_pattern": "UBER *EATS",
            "category_id": dining.id,
            "merchant_nickname": "Uber Eats",
        },
    )
    assert rule_res.status_code == 201
    assert rule_res.json()["merchant_nickname"] == "Uber Eats"

    # 2. Patch a transaction's merchant nickname directly from the ledger
    patch_res = client.patch(
        f"/api/transactions/{t3.id}/nickname",
        json={"nickname": "Taquiza"},
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["merchant_nickname"] == "Taquiza"

    # 3. Verify GET /api/transactions includes merchant_nickname on matching rows
    tx_items = client.get("/api/transactions").json()["items"]
    by_id = {row["id"]: row for row in tx_items}
    assert by_id[t1.id]["merchant_nickname"] == "Uber Eats"
    assert by_id[t2.id]["merchant_nickname"] == "Uber Eats"
    assert by_id[t3.id]["merchant_nickname"] == "Taquiza"

    # 4. Verify GET /api/transactions/groups includes nickname on merchant groups
    groups = client.get("/api/transactions/groups?include_categorized=true").json()["groups"]
    uber_group = next(g for g in groups if g["narration_key"] == "UBER *EATS")
    assert uber_group["nickname"] == "Uber Eats"

    # 5. Verify dedicated management endpoints: GET /api/merchants/nicknames and DELETE
    nicknames = client.get("/api/merchants/nicknames").json()
    assert len(nicknames) == 2
    by_key = {n["narration_key"]: n for n in nicknames}
    assert by_key["UBER *EATS"]["nickname"] == "Uber Eats"
    assert by_key["UBER *EATS"]["transaction_count"] == 2
    assert by_key["LS TAQUIZA NEWPORT"]["nickname"] == "Taquiza"
    assert by_key["LS TAQUIZA NEWPORT"]["transaction_count"] == 1

    del_res = client.delete(f"/api/merchants/nicknames/{by_key['LS TAQUIZA NEWPORT']['id']}")
    assert del_res.status_code == 204
    remaining = client.get("/api/merchants/nicknames").json()
    assert [n["narration_key"] for n in remaining] == ["UBER *EATS"]

