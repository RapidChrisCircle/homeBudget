def create_widget(client, widget_type="accounts", width="half", config=None):

    return client.post("/api/dashboard/widgets", json={
        "widget_type": widget_type, "width": width, "config": config,
    })


def test_create_widget(client):

    response = create_widget(client, "stat_tile", "quarter", {"metric": "total_income"})

    assert response.status_code == 201
    body = response.json()
    assert body["widget_type"] == "stat_tile"
    assert body["width"] == "quarter"
    assert body["config"] == {"metric": "total_income"}
    assert body["position"] == 1


def test_create_widget_rejects_unknown_widget_type(client):

    response = create_widget(client, widget_type="not_a_real_widget")

    assert response.status_code == 422
    assert "widget_type" in response.json()["detail"]


def test_create_widget_rejects_unknown_width(client):

    response = create_widget(client, width="huge")

    assert response.status_code == 422
    assert "width" in response.json()["detail"]


def test_create_widget_defaults_to_quarter_width(client):

    response = client.post("/api/dashboard/widgets", json={"widget_type": "accounts"})

    assert response.status_code == 201
    assert response.json()["width"] == "quarter"


def test_new_widgets_go_to_the_bottom(client):

    first_id = create_widget(client, "accounts").json()["id"]
    second_id = create_widget(client, "goals").json()["id"]

    widgets = client.get("/api/dashboard/widgets").json()

    assert [w["id"] for w in widgets] == [first_id, second_id]


def test_list_widgets_orders_by_position(client):

    first_id = create_widget(client, "accounts").json()["id"]
    second_id = create_widget(client, "goals").json()["id"]

    client.post(f"/api/dashboard/widgets/{second_id}/move", json={"direction": "up"})

    widgets = client.get("/api/dashboard/widgets").json()
    assert [w["id"] for w in widgets] == [second_id, first_id]


def test_update_widget_changes_width_and_config(client):

    widget_id = create_widget(client, "stat_tile", "quarter", {"metric": "total_income"}).json()["id"]

    response = client.put(f"/api/dashboard/widgets/{widget_id}", json={
        "width": "half", "config": {"metric": "total_expenses"},
    })

    assert response.status_code == 200
    body = response.json()
    assert body["width"] == "half"
    assert body["config"] == {"metric": "total_expenses"}


def test_update_widget_404_when_missing(client):

    response = client.put("/api/dashboard/widgets/999", json={"width": "half"})

    assert response.status_code == 404


def test_update_widget_rejects_unknown_width(client):

    widget_id = create_widget(client).json()["id"]

    response = client.put(f"/api/dashboard/widgets/{widget_id}", json={"width": "huge"})

    assert response.status_code == 422


def test_update_widget_cannot_change_widget_type(client):
    """widget_type is not in DashboardWidgetUpdate at all - a widget that
    should show something else is a different widget, not an edit.
    """

    widget_id = create_widget(client, "accounts").json()["id"]

    response = client.put(f"/api/dashboard/widgets/{widget_id}", json={"width": "half", "widget_type": "goals"})

    assert response.status_code == 200
    assert response.json()["widget_type"] == "accounts"


def test_delete_widget(client):

    widget_id = create_widget(client).json()["id"]

    response = client.delete(f"/api/dashboard/widgets/{widget_id}")

    assert response.status_code == 204
    assert client.get("/api/dashboard/widgets").json() == []


def test_delete_widget_404_when_missing(client):

    response = client.delete("/api/dashboard/widgets/999")

    assert response.status_code == 404


def test_move_widget_up_swaps_position_with_previous(client):

    create_widget(client, "accounts")
    second_id = create_widget(client, "goals").json()["id"]

    response = client.post(f"/api/dashboard/widgets/{second_id}/move", json={"direction": "up"})

    assert response.status_code == 200
    assert [w["widget_type"] for w in response.json()] == ["goals", "accounts"]


def test_move_widget_down_at_bottom_is_a_noop(client):

    create_widget(client, "accounts")
    last_id = create_widget(client, "goals").json()["id"]

    response = client.post(f"/api/dashboard/widgets/{last_id}/move", json={"direction": "down"})

    assert response.status_code == 200
    assert [w["widget_type"] for w in response.json()] == ["accounts", "goals"]


def test_move_widget_up_at_top_is_a_noop(client):

    first_id = create_widget(client, "accounts").json()["id"]
    create_widget(client, "goals")

    response = client.post(f"/api/dashboard/widgets/{first_id}/move", json={"direction": "up"})

    assert response.status_code == 200
    assert [w["widget_type"] for w in response.json()] == ["accounts", "goals"]


def test_move_widget_rejects_invalid_direction(client):

    widget_id = create_widget(client).json()["id"]

    response = client.post(f"/api/dashboard/widgets/{widget_id}/move", json={"direction": "sideways"})

    assert response.status_code == 422


def test_move_widget_404_when_missing(client):

    response = client.post("/api/dashboard/widgets/999/move", json={"direction": "up"})

    assert response.status_code == 404


def test_config_survives_a_round_trip_with_nested_values(client):
    """config is a free-form JSON blob - a nested structure (not just flat
    strings/numbers) must come back exactly as it went in.
    """

    response = create_widget(client, "comparison_sparkline", "half", {
        "comparisonBasis": "three_month_average", "months": 3, "flags": ["a", "b"],
    })

    widget_id = response.json()["id"]
    fetched = next(w for w in client.get("/api/dashboard/widgets").json() if w["id"] == widget_id)

    assert fetched["config"] == {"comparisonBasis": "three_month_average", "months": 3, "flags": ["a", "b"]}


def test_config_can_be_absent(client):

    response = client.post("/api/dashboard/widgets", json={"widget_type": "accounts", "width": "half"})

    assert response.status_code == 201
    assert response.json()["config"] is None
