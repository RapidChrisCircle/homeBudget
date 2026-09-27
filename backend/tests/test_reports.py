from test_transactions import HEADER, list_transactions, upload


def make_category(client, name="Groceries", kind="expense", budget_amount=None):

    return client.post(
        "/api/categories",
        json={"name": name, "kind": kind, "budget_amount": budget_amount},
    ).json()["id"]


def test_monthly_report_without_params_uses_most_recent_month(client):

    upload(client, HEADER + ',1111,24/07/2026,"Coffee",,-5.00,,100.00,WDL\n')

    response = client.get("/api/reports/monthly")

    assert response.status_code == 200
    assert response.json()["year"] == 2026
    assert response.json()["month"] == 7


def test_monthly_report_returns_all_four_sections(client):

    category_id = make_category(client, budget_amount="100.00")
    upload(client, HEADER + ',1111,24/07/2026,"Coffee",,-5.00,,100.00,WDL\n')
    transaction_id = list_transactions(client)[0]["id"]
    client.patch(f"/api/transactions/{transaction_id}/category", json={"category_id": category_id})

    response = client.get("/api/reports/monthly?year=2026&month=7")

    assert response.status_code == 200
    body = response.json()
    assert "summary" in body
    assert "budgets" in body
    assert "grid" in body
    assert "uncategorized" in body
    assert body["budgets"][0]["category_id"] == category_id


def test_monthly_report_includes_top_movers_between_the_last_two_periods(client):

    groceries_id = make_category(client, name="Groceries")

    upload(client, HEADER + ',1111,05/06/2026,"Coles",,-100.00,,100.00,WDL\n')
    upload(client, HEADER + ',1111,05/07/2026,"Coles",,-500.00,,100.00,WDL\n', filename="july.csv")

    for transaction in list_transactions(client):
        client.patch(f"/api/transactions/{transaction['id']}/category", json={"category_id": groceries_id})

    response = client.get("/api/reports/monthly?year=2026&month=7&months=2")

    assert response.status_code == 200
    movers = response.json()["top_movers"]
    assert len(movers) == 1
    assert movers[0]["category_id"] == groceries_id
    assert movers[0]["current"] == "500.00"
    assert movers[0]["prior"] == "100.00"
    assert movers[0]["delta"] == "400.00"


def test_monthly_report_has_prior_period_data_false_on_the_earliest_month(client):

    # Only July has ever had a transaction - June is not a real, zero-
    # activity month, it's before the ledger existed at all.
    upload(client, HEADER + ',1111,05/07/2026,"Coffee",,-5.00,,100.00,WDL\n')

    response = client.get("/api/reports/monthly?year=2026&month=7&months=2")

    assert response.status_code == 200
    assert response.json()["has_prior_period_data"] is False


def test_monthly_report_has_prior_period_data_true_when_the_prior_month_has_real_activity(client):

    upload(client, HEADER + ',1111,05/06/2026,"Coffee",,-5.00,,100.00,WDL\n')
    upload(client, HEADER + ',1111,05/07/2026,"Coffee",,-5.00,,100.00,WDL\n', filename="july.csv")

    response = client.get("/api/reports/monthly?year=2026&month=7&months=2")

    assert response.status_code == 200
    assert response.json()["has_prior_period_data"] is True


def test_monthly_report_prior_summary_is_none_without_prior_period_data(client):

    upload(client, HEADER + ',1111,05/07/2026,"Coffee",,-5.00,,100.00,WDL\n')

    response = client.get("/api/reports/monthly?year=2026&month=7&months=2")

    assert response.status_code == 200
    assert response.json()["prior_summary"] is None


def test_monthly_report_prior_summary_matches_the_prior_months_own_totals(client):

    groceries_id = make_category(client, name="Groceries")
    upload(client, HEADER + ',1111,05/06/2026,"Coffee",,-40.00,,100.00,WDL\n')
    upload(client, HEADER + ',1111,05/07/2026,"Coffee",,-70.00,,100.00,WDL\n', filename="july.csv")
    for transaction in list_transactions(client):
        client.patch(f"/api/transactions/{transaction['id']}/category", json={"category_id": groceries_id})

    response = client.get("/api/reports/monthly?year=2026&month=7&months=2")
    prior_summary = response.json()["prior_summary"]

    assert prior_summary is not None
    assert prior_summary["total_spending"] == "40.00"

    june_response = client.get("/api/reports/monthly?year=2026&month=6")
    assert june_response.json()["summary"]["total_spending"] == prior_summary["total_spending"]


def test_monthly_report_rejects_invalid_month(client):

    assert client.get("/api/reports/monthly?year=2026&month=0").status_code == 422
    assert client.get("/api/reports/monthly?year=2026&month=13").status_code == 422


def test_monthly_report_rejects_year_without_month(client):

    response = client.get("/api/reports/monthly?year=2026")

    assert response.status_code == 422


def test_monthly_report_rejects_invalid_months_window(client):

    assert client.get("/api/reports/monthly?months=0").status_code == 422
    assert client.get("/api/reports/monthly?months=25").status_code == 422


def test_periods_endpoint_lists_months_newest_first(client):

    upload(client, HEADER + ',1111,24/07/2026,"Coffee",,-5.00,,100.00,WDL\n', filename="a.csv")
    upload(client, HEADER + ',1111,24/03/2026,"Coffee",,-5.00,,100.00,WDL\n', filename="b.csv")

    response = client.get("/api/reports/periods")

    assert response.status_code == 200
    labels = [p["label"] for p in response.json()]
    assert labels == ["2026-07", "2026-03"]


def test_transfer_category_excluded_end_to_end(client):

    transfers_id = make_category(client, name="Transfers", kind="transfer")
    client.post(
        "/api/category-rules",
        json={"narration_pattern": "CCTrueUp", "category_id": transfers_id},
    )

    upload(client, HEADER + (
        ',5229 8024 5118 3514,24/07/2026,"CCTrueUp",,,3365.49,-1576.67,DEP\n'
        '304-559,0128778,24/07/2026,"CCTrueUp",,-3365.49,,3000.00,TFD\n'
    ))

    response = client.get("/api/reports/monthly?year=2026&month=7")

    body = response.json()
    assert float(body["summary"]["total_income"]) == 0
    assert float(body["summary"]["total_spending"]) == 0


def test_uncategorized_review_counts_and_totals(client):

    upload(client, HEADER + ',1111,24/07/2026,"Coffee",,-5.00,,100.00,WDL\n')

    response = client.get("/api/reports/monthly?year=2026&month=7")

    body = response.json()["uncategorized"]
    assert body["transaction_count"] == 1
    assert body["uncategorized_count"] == 1
    assert body["total_out"] == "-5.00"
