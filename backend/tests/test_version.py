from unittest.mock import patch

from app.version import get_commit, get_version


def test_get_version_returns_env_var_when_set(monkeypatch):

    monkeypatch.setenv("APP_VERSION", "1.2.3")

    assert get_version() == "1.2.3"


def test_get_version_falls_back_to_the_repo_root_version_file_when_env_unset(monkeypatch):

    monkeypatch.delenv("APP_VERSION", raising=False)

    with patch("app.version._read_version_file", return_value="0.11.0"):
        assert get_version() == "0.11.0"


def test_get_version_falls_back_to_dev_when_nothing_is_available(monkeypatch):
    # What a misconfigured image (no APP_VERSION, no VERSION file copied
    # into the build context) actually hits - the one worth pinning.
    monkeypatch.delenv("APP_VERSION", raising=False)

    with patch("app.version._read_version_file", return_value=None):
        assert get_version() == "dev"


def test_get_commit_returns_env_var_when_set(monkeypatch):

    monkeypatch.setenv("GIT_SHA", "abc1234")

    assert get_commit() == "abc1234"


def test_get_commit_falls_back_to_unknown_when_unset(monkeypatch):

    monkeypatch.delenv("GIT_SHA", raising=False)

    assert get_commit() == "unknown"


def test_get_version_endpoint_returns_both_fields(client, monkeypatch):

    monkeypatch.setenv("APP_VERSION", "1.2.3")
    monkeypatch.setenv("GIT_SHA", "abc1234")

    response = client.get("/api/version")

    assert response.status_code == 200
    assert response.json() == {"version": "1.2.3", "commit": "abc1234"}


# --- X-App-Version / X-App-Commit response headers -------------------------
#
# See app/main.py's add_build_identity_headers docstring: these exist so a
# response can be attributed to a specific build even when more than one API
# container is answering the same hostname (README.md's troubleshooting
# note on intermittent 404s) - the frontend compares this header across
# responses to detect exactly that.

def test_every_response_carries_the_build_identity_headers(client, monkeypatch):

    monkeypatch.setenv("APP_VERSION", "1.2.3")
    monkeypatch.setenv("GIT_SHA", "abc1234")

    response = client.get("/api/version")

    assert response.headers["X-App-Version"] == "1.2.3"
    assert response.headers["X-App-Commit"] == "abc1234"


def test_an_unmatched_route_still_carries_the_headers(client, monkeypatch):
    """The whole point: a 404 with no `detail` a caller expects is exactly
    the response most likely to have come from the WRONG build, and is
    also the one case a per-route dependency would never run for.
    """

    monkeypatch.setenv("APP_VERSION", "1.2.3")
    monkeypatch.setenv("GIT_SHA", "abc1234")

    response = client.get("/api/this-route-does-not-exist")

    assert response.status_code == 404
    assert response.headers["X-App-Version"] == "1.2.3"
    assert response.headers["X-App-Commit"] == "abc1234"


def test_headers_fall_back_the_same_way_get_version_endpoint_does(client, monkeypatch):

    monkeypatch.delenv("APP_VERSION", raising=False)
    monkeypatch.delenv("GIT_SHA", raising=False)

    with patch("app.main.get_version", return_value="dev"):
        response = client.get("/api/version")

    assert response.headers["X-App-Version"] == "dev"
    assert response.headers["X-App-Commit"] == "unknown"
