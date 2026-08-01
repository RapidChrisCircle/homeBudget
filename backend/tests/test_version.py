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
