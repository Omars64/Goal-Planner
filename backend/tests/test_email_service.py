from __future__ import annotations

import json
from typing import Any

import pytest

from app import email_service


class FakeResponse:
    status = 201

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *_args: object) -> None:
        return None


def test_brevo_provider_sends_transactional_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SMTP_SUPPRESS_SEND", raising=False)
    monkeypatch.setenv("EMAIL_PROVIDER", "brevo")
    monkeypatch.setenv("BREVO_API_KEY", "test-api-key")
    monkeypatch.setenv("BREVO_FROM_EMAIL", "verify@example.com")
    monkeypatch.setenv("BREVO_FROM_NAME", "Goal Planner")
    captured: dict[str, Any] = {}

    def capture(request: Any, timeout: int) -> FakeResponse:
        captured["url"] = request.full_url
        captured["headers"] = dict(request.header_items())
        captured["payload"] = json.loads(request.data)
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr(email_service, "urlopen", capture)

    email_service.send_verification_email("person@outlook.com", "Taylor", "123456", 10)

    assert captured["url"] == email_service.BREVO_EMAIL_ENDPOINT
    assert captured["timeout"] == 20
    assert captured["headers"]["Api-key"] == "test-api-key"
    assert captured["payload"]["sender"] == {"name": "Goal Planner", "email": "verify@example.com"}
    assert captured["payload"]["to"] == [{"email": "person@outlook.com", "name": "Taylor"}]
    assert "123456" in captured["payload"]["textContent"]
    assert "123456" in captured["payload"]["htmlContent"]
    assert captured["payload"]["tags"] == ["signup-verification"]


def test_auto_provider_prefers_brevo_when_key_exists(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EMAIL_PROVIDER", "auto")
    monkeypatch.setenv("BREVO_API_KEY", "configured")
    assert email_service._email_provider() == "brevo"


def test_auto_provider_retains_smtp_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EMAIL_PROVIDER", "auto")
    monkeypatch.delenv("BREVO_API_KEY", raising=False)
    assert email_service._email_provider() == "smtp"


def test_unknown_provider_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EMAIL_PROVIDER", "unknown")
    with pytest.raises(RuntimeError, match="EMAIL_PROVIDER"):
        email_service._email_provider()
