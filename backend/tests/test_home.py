from app.models import HomeStatus


def test_get_status_returns_404_when_table_empty(client):

    response = client.get("/api/status")

    assert response.status_code == 404


def test_get_status_returns_row_when_present(client, db_session):

    db_session.add(HomeStatus(message="Home system online"))
    db_session.commit()

    response = client.get("/api/status")

    assert response.status_code == 200

    body = response.json()
    assert body["message"] == "Home system online"
    assert "id" in body
