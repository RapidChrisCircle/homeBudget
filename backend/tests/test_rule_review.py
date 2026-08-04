import io

from test_category_rules import make_category, rule_payload


def create_rule(client, category_id, **overrides):

    response = client.post("/api/category-rules", json=rule_payload(category_id, **overrides))
    assert response.status_code == 201
    return response.json()


def review(client):

    return client.get("/api/category-rules/review").json()["findings"]


def test_exact_duplicate_is_reported(client):

    category_id = make_category(client)
    create_rule(client, category_id, narration_pattern="woolworths")
    second = create_rule(client, category_id, narration_pattern="Woolworths")

    findings = review(client)

    assert len(findings) == 1
    assert findings[0]["rule_id"] == second["id"]
    assert findings[0]["kind"] == "duplicate"


def test_narrower_pattern_same_category_is_subsumed(client):

    category_id = make_category(client)
    create_rule(client, category_id, narration_pattern="woolworths")
    second = create_rule(client, category_id, narration_pattern="woolworths metro")

    findings = review(client)

    assert len(findings) == 1
    assert findings[0]["rule_id"] == second["id"]
    assert findings[0]["kind"] == "subsumed"


def test_same_shape_different_category_is_shadowed(client):

    groceries_id = make_category(client, "Groceries")
    dining_id = make_category(client, "Dining")
    create_rule(client, groceries_id, narration_pattern="woolworths")
    second = create_rule(client, dining_id, narration_pattern="woolworths metro")

    findings = review(client)

    assert len(findings) == 1
    assert findings[0]["rule_id"] == second["id"]
    assert findings[0]["kind"] == "shadowed"
    assert findings[0]["blocking_rule_id"] is not None


def test_remove_redundant_leaves_shadowed_rule_untouched(client):

    groceries_id = make_category(client, "Groceries")
    dining_id = make_category(client, "Dining")
    create_rule(client, groceries_id, narration_pattern="woolworths")
    shadowed = create_rule(client, dining_id, narration_pattern="woolworths metro")

    response = client.post("/api/category-rules/review/remove-redundant")

    assert response.status_code == 200
    assert response.json()["removed_count"] == 0

    remaining_ids = [rule["id"] for rule in client.get("/api/category-rules").json()]
    assert shadowed["id"] in remaining_ids


def test_remove_redundant_deletes_duplicate_and_subsumed_only(client):

    category_id = make_category(client)
    other_category_id = make_category(client, "Dining")

    original = create_rule(client, category_id, narration_pattern="woolworths")
    duplicate = create_rule(client, category_id, narration_pattern="Woolworths")
    subsumed = create_rule(client, category_id, narration_pattern="woolworths metro")
    shadowed = create_rule(client, other_category_id, narration_pattern="woolworths metro central")

    response = client.post("/api/category-rules/review/remove-redundant")

    assert response.status_code == 200
    assert response.json()["removed_count"] == 2

    remaining_ids = {rule["id"] for rule in client.get("/api/category-rules").json()}
    assert remaining_ids == {original["id"], shadowed["id"]}
    assert duplicate["id"] not in remaining_ids
    assert subsumed["id"] not in remaining_ids


def test_narrower_amount_band_is_not_subsumed(client):
    """A generic-pattern rule above a rule with a narrower amount band must
    NOT be reported - the earlier rule isn't broader just because its
    pattern is shorter; a false positive here would delete a rule that
    genuinely fires.
    """

    category_id = make_category(client)
    create_rule(client, category_id, narration_pattern="woolworths", min_amount="50.00")
    create_rule(client, category_id, narration_pattern="woolworths metro")

    assert review(client) == []


def test_unrelated_patterns_are_never_reported(client):

    category_id = make_category(client)
    create_rule(client, category_id, narration_pattern="woolworths")
    create_rule(client, category_id, narration_pattern="coles")

    assert review(client) == []


def test_apply_rules_after_removing_redundant_categorizes_the_same_count(client):
    """Removing duplicate/subsumed rules must change no outcome - re-running
    Apply after the cleanup categorizes exactly what it would have before.
    """

    category_id = make_category(client)
    create_rule(client, category_id, narration_pattern="woolworths")
    create_rule(client, category_id, narration_pattern="Woolworths")

    csv_content = (
        "BSB Number,Account Number,Transaction Date,Narration,Cheque Number,Debit,Credit,Balance,Transaction Type\n"
        ',1111,24/07/2026,"Woolworths Newport",,-45.00,,100.00,WDL\n'
    )
    client.post(
        "/api/transactions/import",
        files={"file": ("transactions.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")},
    )

    before = client.post("/api/category-rules/apply").json()["categorized_count"]

    client.post("/api/category-rules/review/remove-redundant")

    after = client.post("/api/category-rules/apply").json()["categorized_count"]

    assert before == 0  # already categorized on import
    assert after == 0
