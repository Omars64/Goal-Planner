from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "AdminPass123!"


@pytest.fixture()
def email_outbox(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, object]]:
    from app import auth

    outbox: list[dict[str, object]] = []

    def capture(recipient: str, username: str, code: str, expires_minutes: int) -> None:
        outbox.append(
            {
                "recipient": recipient,
                "username": username,
                "code": code,
                "expires_minutes": expires_minutes,
            }
        )

    monkeypatch.setattr(auth, "send_verification_email", capture)
    return outbox


@pytest.fixture()
def anonymous_client(tmp_path: Path, email_outbox: list[dict[str, object]]):
    del email_outbox
    os.environ.pop("DATABASE_URL", None)
    os.environ.pop("POSTGRES_URL", None)
    os.environ["VICE_PLANNER_DB_PATH"] = str(tmp_path / "test.db")
    os.environ["GOAL_PLANNER_ADMIN_EMAIL"] = ADMIN_EMAIL
    os.environ["GOAL_PLANNER_ADMIN_PASSWORD"] = ADMIN_PASSWORD
    os.environ["GOAL_PLANNER_ADMIN_USERNAME"] = "Omar"
    os.environ["SMTP_SUPPRESS_SEND"] = "1"
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def client(anonymous_client: TestClient):
    response = anonymous_client.post(
        "/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    assert response.status_code == 200
    yield anonymous_client
