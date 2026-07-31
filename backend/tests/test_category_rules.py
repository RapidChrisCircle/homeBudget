from app.models import CategoryRule, Transaction
from test_transactions import HEADER, upload


def make_category(client, name="Groceries"):

    return client.post("/api/categories", json={"name": name}).json()["id"]


def rule_payload(category_id, **overrides):

    payload = {
        "narration_pattern": "woolworths",
        "transaction_type": None,
        "min_amount": None,
        "max_amount": None,
        "category_id": category_id,
    }
    payload.update(overrides)
    return payload


def test_create_rule(client):

    category_id = make_category(client)

    response = client.post("/api/category-rules", json=rule_payload(category_id))

    assert response.status_code == 201

    body = response.json()
    assert body["narration_pattern"] == "woolworths"
    assert body["category_name"] == "Groceries"


def test_create_rule_404_when_category_missing(client):

    response = client.post("/api/category-rules", json=rule_payload(999))

    assert response.status_code == 404


def test_create_rule_rejects_blank_pattern(client):

    category_id = make_category(client)

    response = client.post("/api/category-rules", json=rule_payload(category_id, narration_pattern="   "))

    assert response.status_code == 422


def test_create_rule_rejects_min_greater_than_max(client):

    category_id = make_category(client)

    response = client.post(
        "/api/category-rules",
        json=rule_payload(category_id, min_amount="500.00", max_amount="100.00"),
    )

    assert response.status_code == 422


def test_create_rule_rejects_negative_amount(client):

    category_id = make_category(client)

    response = client.post("/api/category-rules", json=rule_payload(category_id, min_amount="-5.00"))

    assert response.status_code == 422


def test_new_rule_is_appended_at_end_of_priority_order(client):

    category_id = make_category(client)

    first = client.post("/api/category-rules", json=rule_payload(category_id, narration_pattern="a")).json()
    second = client.post("/api/category-rules", json=rule_payload(category_id, narration_pattern="b")).json()

    assert second["priority"] > first["priority"]


def test_list_rules_sorted_by_priority(client):

    category_id = make_category(client)
    client.post("/api/category-rules", json=rule_payload(category_id, narration_pattern="a"))
    client.post("/api/category-rules", json=rule_payload(category_id, narration_pattern="b"))

    patterns = [r["narration_pattern"] for r in client.get("/api/category-rules").json()]
    assert patterns == ["a", "b"]


def test_update_rule(client):

    category_id = make_category(client)
    rule_id = client.post("/api/category-rules", json=rule_payload(category_id)).json()["id"]

    response = client.put(
        f"/api/category-rules/{rule_id}",
        json=rule_payload(category_id, narration_pattern="coles"),
    )

    assert response.status_code == 200
    assert response.json()["narration_pattern"] == "coles"


def test_update_rule_404_when_missing(client):

    category_id = make_category(client)

    response = client.put("/api/category-rules/999", json=rule_payload(category_id))

    assert response.status_code == 404


def test_move_rule_up_swaps_priority_with_previous(client):

    category_id = make_category(client)
    client.post("/api/category-rules", json=rule_payload(category_id, narration_pattern="a"))
    second_id = client.post(
        "/api/category-rules", json=rule_payload(category_id, narration_pattern="b")
    ).json()["id"]

    response = client.post(f"/api/category-rules/{second_id}/move", json={"direction": "up"})

    assert response.status_code == 200
    assert [r["narration_pattern"] for r in response.json()] == ["b", "a"]


def test_move_rule_down_at_bottom_is_a_noop(client):

    category_id = make_category(client)
    client.post("/api/category-rules", json=rule_payload(category_id, narration_pattern="a"))
    last_id = client.post(
        "/api/category-rules", json=rule_payload(category_id, narration_pattern="b")
    ).json()["id"]

    response = client.post(f"/api/category-rules/{last_id}/move", json={"direction": "down"})

    assert response.status_code == 200
    assert [r["narration_pattern"] for r in response.json()] == ["a", "b"]


def test_move_rule_rejects_invalid_direction(client):

    category_id = make_category(client)
    rule_id = client.post("/api/category-rules", json=rule_payload(category_id)).json()["id"]

    response = client.post(f"/api/category-rules/{rule_id}/move", json={"direction": "sideways"})

    assert response.status_code == 422


def test_move_rule_404_when_missing(client):

    response = client.post("/api/category-rules/999/move", json={"direction": "up"})

    assert response.status_code == 404


def test_delete_rule_404_when_missing(client):

    response = client.delete("/api/category-rules/999")

    assert response.status_code == 404


def test_delete_rule_keeps_category_but_clears_marker(client, db_session):

    category_id = make_category(client)
    upload(client, HEADER + ',1111,24/07/2026,"WOOLWORTHS NEWPORT",,-98.00,,100.00,WDL\n')
    rule_id = client.post("/api/category-rules", json=rule_payload(category_id)).json()["id"]

    client.post("/api/category-rules/apply")

    transaction = db_session.query(Transaction).one()
    assert transaction.categorized_by_rule_id == rule_id

    response = client.delete(f"/api/category-rules/{rule_id}")

    assert response.status_code == 204

    db_session.expire_all()
    updated = db_session.query(Transaction).one()
    assert updated.category_id == category_id
    assert updated.categorized_by_rule_id is None


def test_preview_returns_match_count_without_saving_a_rule(client, db_session):

    category_id = make_category(client)
    upload(client, HEADER + ',1111,24/07/2026,"WOOLWORTHS NEWPORT",,-98.00,,100.00,WDL\n')

    response = client.post(
        "/api/category-rules/preview",
        json={"narration_pattern": "woolworths", "category_id": category_id},
    )

    assert response.status_code == 200
    assert response.json()["match_count"] == 1
    assert response.json()["would_categorize_count"] == 1
    assert db_session.query(CategoryRule).count() == 0


def test_preview_would_categorize_count_excludes_manual_rows(client):

    category_id = make_category(client)
    upload(client, HEADER + ',1111,24/07/2026,"WOOLWORTHS NEWPORT",,-98.00,,100.00,WDL\n')

    transaction_id = client.get("/api/transactions").json()[0]["id"]
    client.patch(f"/api/transactions/{transaction_id}/category", json={"category_id": category_id})

    response = client.post(
        "/api/category-rules/preview",
        json={"narration_pattern": "woolworths", "category_id": category_id},
    )

    body = response.json()
    assert body["match_count"] == 1
    assert body["would_categorize_count"] == 0


def test_preview_with_exclude_rule_id_skips_rows_already_tagged_by_that_rule(client):

    category_id = make_category(client)
    upload(client, HEADER + ',1111,24/07/2026,"WOOLWORTHS NEWPORT",,-98.00,,100.00,WDL\n')
    rule_id = client.post("/api/category-rules", json=rule_payload(category_id)).json()["id"]
    client.post("/api/category-rules/apply")

    response = client.post(
        "/api/category-rules/preview",
        json={
            "narration_pattern": "woolworths",
            "category_id": category_id,
            "exclude_rule_id": rule_id,
        },
    )

    body = response.json()
    assert body["match_count"] == 1
    # Already applied by this exact rule to this exact category - nothing to do.
    assert body["would_categorize_count"] == 0


def test_apply_rules_categorizes_uncategorized_transactions(client):

    category_id = make_category(client)
    upload(client, HEADER + ',1111,24/07/2026,"WOOLWORTHS NEWPORT",,-98.00,,100.00,WDL\n')
    client.post("/api/category-rules", json=rule_payload(category_id))

    response = client.post("/api/category-rules/apply")

    assert response.status_code == 200
    assert response.json()["categorized_count"] == 1
    assert client.get("/api/transactions").json()[0]["category_id"] == category_id


def test_apply_rules_returns_zero_when_no_rules_exist(client):

    upload(client, HEADER + ',1111,24/07/2026,"WOOLWORTHS NEWPORT",,-98.00,,100.00,WDL\n')

    response = client.post("/api/category-rules/apply")

    assert response.json()["categorized_count"] == 0


def test_apply_rules_respects_priority_order(client):

    groceries_id = make_category(client, "Groceries")
    dining_id = make_category(client, "Dining")

    upload(client, HEADER + ',1111,24/07/2026,"WOOLWORTHS NEWPORT",,-98.00,,100.00,WDL\n')

    client.post("/api/category-rules", json=rule_payload(dining_id, narration_pattern="woolworths"))
    second_id = client.post(
        "/api/category-rules", json=rule_payload(groceries_id, narration_pattern="newport")
    ).json()["id"]

    client.post(f"/api/category-rules/{second_id}/move", json={"direction": "up"})
    client.post("/api/category-rules/apply")

    assert client.get("/api/transactions").json()[0]["category_id"] == groceries_id


def test_apply_rules_matches_on_amount_range_using_absolute_value(client):

    category_id = make_category(client, "Large Purchases")
    upload(client, HEADER + ',1111,24/07/2026,"RED ENERGY CREMORNE",,-238.32,,100.00,WDL\n')

    client.post(
        "/api/category-rules",
        json=rule_payload(category_id, narration_pattern="red energy", min_amount="100.00", max_amount="500.00"),
    )

    response = client.post("/api/category-rules/apply")

    assert response.json()["categorized_count"] == 1
