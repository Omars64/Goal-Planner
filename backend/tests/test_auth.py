from __future__ import annotations

from datetime import UTC, datetime, timedelta

from conftest import ADMIN_EMAIL, ADMIN_PASSWORD
from fastapi.testclient import TestClient

from app.database import (
    EMPTY_USER_WORKSPACES_MIGRATION,
    OWNED_TABLES,
    cleanup_non_admin_starter_data,
    new_id,
    seed_database,
    transaction,
)
from app.main import app


def signup_and_verify(client: TestClient, outbox: list[dict[str, object]], email: str = "user@example.com") -> dict:
    signup = client.post(
        "/api/auth/signup",
        json={"username": "Planner User", "email": email, "password": "UserPass123!"},
    )
    assert signup.status_code == 201
    code = str(outbox[-1]["code"])
    verified = client.post("/api/auth/verify", json={"email": email, "code": code})
    assert verified.status_code == 200
    return verified.json()["user"]


def test_planner_requires_authentication(anonymous_client: TestClient) -> None:
    assert anonymous_client.get("/api/health").status_code == 200
    response = anonymous_client.get("/api/dashboard")
    assert response.status_code == 401
    assert response.json()["detail"] == "Sign in to continue"


def test_signup_verification_login_and_password_change(
    anonymous_client: TestClient, email_outbox: list[dict[str, object]]
) -> None:
    signup = anonymous_client.post(
        "/api/auth/signup",
        json={"username": "New User", "email": "new@example.com", "password": "Password123!"},
    )
    assert signup.status_code == 201
    assert signup.json()["status"] == "verification_required"
    assert email_outbox[-1]["recipient"] == "new@example.com"
    assert len(str(email_outbox[-1]["code"])) == 6
    assert (
        anonymous_client.post(
            "/api/auth/login", json={"email": "new@example.com", "password": "Password123!"}
        ).status_code
        == 403
    )

    issued_code = str(email_outbox[-1]["code"])
    wrong_code = "000000" if issued_code != "000000" else "999999"
    wrong = anonymous_client.post("/api/auth/verify", json={"email": "new@example.com", "code": wrong_code})
    assert wrong.status_code == 400
    verified = anonymous_client.post(
        "/api/auth/verify", json={"email": "new@example.com", "code": email_outbox[-1]["code"]}
    )
    assert verified.status_code == 200
    assert verified.json()["user"]["role"] == "user"
    assert anonymous_client.get("/api/auth/me").json()["email"] == "new@example.com"
    dashboard = anonymous_client.get("/api/dashboard")
    assert dashboard.status_code == 200
    for collection in ("tasks", "events", "routine", "habits", "goals", "reminders"):
        assert dashboard.json()[collection] == []
    assert dashboard.json()["settings"]["display_name"] == "New User"

    assert (
        anonymous_client.post(
            "/api/auth/change-password",
            json={"current_password": "wrong", "new_password": "NewPassword123!"},
        ).status_code
        == 400
    )
    changed = anonymous_client.post(
        "/api/auth/change-password",
        json={"current_password": "Password123!", "new_password": "NewPassword123!"},
    )
    assert changed.status_code == 200
    assert anonymous_client.post("/api/auth/logout").status_code == 200
    assert anonymous_client.get("/api/auth/me").status_code == 401
    assert (
        anonymous_client.post(
            "/api/auth/login", json={"email": "new@example.com", "password": "Password123!"}
        ).status_code
        == 401
    )
    assert (
        anonymous_client.post(
            "/api/auth/login", json={"email": "new@example.com", "password": "NewPassword123!"}
        ).status_code
        == 200
    )


def test_resend_invalidates_old_code_and_is_rate_limited(
    anonymous_client: TestClient, email_outbox: list[dict[str, object]]
) -> None:
    anonymous_client.post(
        "/api/auth/signup",
        json={"username": "Resend User", "email": "resend@example.com", "password": "Password123!"},
    )
    old_code = str(email_outbox[-1]["code"])
    limited = anonymous_client.post("/api/auth/resend-code", json={"email": "resend@example.com"})
    assert limited.status_code == 429

    old_timestamp = (datetime.now(UTC) - timedelta(minutes=2)).replace(microsecond=0).isoformat()
    with transaction() as connection:
        connection.execute(
            "UPDATE email_verification_codes SET created_at = ? WHERE consumed_at IS NULL", (old_timestamp,)
        )
    resent = anonymous_client.post("/api/auth/resend-code", json={"email": "resend@example.com"})
    assert resent.status_code == 200
    new_code = str(email_outbox[-1]["code"])
    assert new_code != old_code
    assert (
        anonymous_client.post("/api/auth/verify", json={"email": "resend@example.com", "code": old_code}).status_code
        == 400
    )
    assert (
        anonymous_client.post("/api/auth/verify", json={"email": "resend@example.com", "code": new_code}).status_code
        == 200
    )


def test_repeated_signup_resumes_pending_verification(
    anonymous_client: TestClient, email_outbox: list[dict[str, object]]
) -> None:
    first = anonymous_client.post(
        "/api/auth/signup",
        json={"username": "Pending User", "email": "pending@example.com", "password": "OriginalPass123!"},
    )
    assert first.status_code == 201
    original_code = str(email_outbox[-1]["code"])
    assert len(email_outbox) == 1

    resumed = anonymous_client.post(
        "/api/auth/signup",
        json={"username": "Updated Pending", "email": "pending@example.com", "password": "UpdatedPass123!"},
    )
    assert resumed.status_code == 201
    assert resumed.json()["status"] == "verification_required"
    assert "code already sent" in resumed.json()["message"]
    assert len(email_outbox) == 1

    verified = anonymous_client.post("/api/auth/verify", json={"email": "pending@example.com", "code": original_code})
    assert verified.status_code == 200
    assert verified.json()["user"]["username"] == "Updated Pending"
    assert anonymous_client.post("/api/auth/logout").status_code == 200
    assert (
        anonymous_client.post(
            "/api/auth/login", json={"email": "pending@example.com", "password": "OriginalPass123!"}
        ).status_code
        == 401
    )
    assert (
        anonymous_client.post(
            "/api/auth/login", json={"email": "pending@example.com", "password": "UpdatedPass123!"}
        ).status_code
        == 200
    )


def test_admin_user_management_and_role_protection(client: TestClient) -> None:
    created = client.post(
        "/api/admin/users",
        json={
            "username": "Managed User",
            "email": "managed@example.com",
            "password": "ManagedPass123!",
            "role": "user",
        },
    )
    assert created.status_code == 201
    managed = created.json()["user"]
    assert "password_hash" not in managed

    with TestClient(app) as managed_client:
        assert (
            managed_client.post(
                "/api/auth/login", json={"email": "managed@example.com", "password": "ManagedPass123!"}
            ).status_code
            == 200
        )
        for endpoint in ("tasks", "routine-blocks", "events", "goals", "habits", "reminders"):
            assert managed_client.get(f"/api/{endpoint}").json() == []

    listing = client.get("/api/admin/users")
    assert listing.status_code == 200
    assert listing.json()["total"] == 2
    assert listing.json()["admins"] == 1
    assert listing.json()["active_users"] == 2
    assert listing.json()["inactive_users"] == 0

    deactivated = client.patch(f"/api/admin/users/{managed['id']}", json={"is_active": False})
    assert deactivated.status_code == 200
    assert deactivated.json()["user"]["is_active"] is False
    inactive_listing = client.get("/api/admin/users").json()
    assert inactive_listing["total"] == 2
    assert inactive_listing["inactive_users"] == 1
    assert any(user["id"] == managed["id"] for user in inactive_listing["users"])

    with TestClient(app) as inactive_client:
        inactive_login = inactive_client.post(
            "/api/auth/login", json={"email": "managed@example.com", "password": "ManagedPass123!"}
        )
        assert inactive_login.status_code == 403
        assert "Contact an administrator" in inactive_login.json()["detail"]
        inactive_signup = inactive_client.post(
            "/api/auth/signup",
            json={"username": "Managed User", "email": "managed@example.com", "password": "ManagedPass123!"},
        )
        assert inactive_signup.status_code == 409
        assert "different email address" in inactive_signup.json()["detail"]

    reactivated = client.patch(f"/api/admin/users/{managed['id']}", json={"is_active": True})
    assert reactivated.status_code == 200
    assert reactivated.json()["user"]["is_active"] is True

    edited = client.patch(
        f"/api/admin/users/{managed['id']}",
        json={"username": "Updated User", "email": "updated@example.com"},
    )
    assert edited.status_code == 200
    assert edited.json()["user"]["username"] == "Updated User"
    reset = client.put(f"/api/admin/users/{managed['id']}/password", json={"new_password": "ResetPass123!"})
    assert reset.status_code == 200

    admin = client.get("/api/auth/me").json()
    assert client.patch(f"/api/admin/users/{admin['id']}", json={"role": "user"}).status_code == 400
    assert client.patch(f"/api/admin/users/{admin['id']}", json={"is_active": False}).status_code == 400

    with TestClient(app) as user_client:
        assert (
            user_client.post(
                "/api/auth/login", json={"email": "updated@example.com", "password": "ResetPass123!"}
            ).status_code
            == 200
        )
        assert user_client.get("/api/admin/users").status_code == 403
        assert user_client.delete(f"/api/admin/users/{managed['id']}").status_code == 403


def test_admin_can_delete_user_and_owned_planner_data(client: TestClient) -> None:
    created = client.post(
        "/api/admin/users",
        json={
            "username": "Delete Me",
            "email": "delete-me@example.com",
            "password": "DeletePass123!",
            "role": "user",
        },
    )
    assert created.status_code == 201
    user_id = created.json()["user"]["id"]

    with transaction() as connection:
        seed_database(connection, user_id, "Delete Me")
        assert connection.execute("SELECT COUNT(*) AS count FROM tasks WHERE user_id = ?", (user_id,)).fetchone()[
            "count"
        ]

    with TestClient(app) as deleted_user_client:
        assert (
            deleted_user_client.post(
                "/api/auth/login", json={"email": "delete-me@example.com", "password": "DeletePass123!"}
            ).status_code
            == 200
        )
        assert (
            deleted_user_client.post(
                "/api/feedback",
                json={"name": "Delete Me", "email": "delete-me@example.com", "message": "Remove this too"},
            ).status_code
            == 201
        )

    admin = client.get("/api/auth/me").json()
    assert client.delete(f"/api/admin/users/{admin['id']}").status_code == 400
    assert client.delete("/api/admin/users/missing-user").status_code == 404

    deleted = client.delete(f"/api/admin/users/{user_id}")
    assert deleted.status_code == 200
    assert deleted.json()["deleted_user_id"] == user_id
    assert "all associated planner data" in deleted.json()["message"]

    with transaction() as connection:
        assert (
            connection.execute("SELECT COUNT(*) AS count FROM users WHERE id = ?", (user_id,)).fetchone()["count"] == 0
        )
        assert (
            connection.execute("SELECT COUNT(*) AS count FROM user_settings WHERE user_id = ?", (user_id,)).fetchone()[
                "count"
            ]
            == 0
        )
        assert (
            connection.execute("SELECT COUNT(*) AS count FROM user_sessions WHERE user_id = ?", (user_id,)).fetchone()[
                "count"
            ]
            == 0
        )
        for table in OWNED_TABLES:
            assert (
                connection.execute(f"SELECT COUNT(*) AS count FROM {table} WHERE user_id = ?", (user_id,)).fetchone()[
                    "count"
                ]
                == 0
            )
        assert (
            connection.execute("SELECT COUNT(*) AS count FROM feedback WHERE user_id = ?", (user_id,)).fetchone()[
                "count"
            ]
            == 0
        )

    assert (
        client.post(
            "/api/auth/login", json={"email": "delete-me@example.com", "password": "DeletePass123!"}
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/auth/signup",
            json={"username": "Reused Email", "email": "delete-me@example.com", "password": "ReusedPass123!"},
        ).status_code
        == 201
    )


def test_user_data_isolation(client: TestClient) -> None:
    admin_task = client.post("/api/tasks", json={"title": "Admin-only task"}).json()
    created = client.post(
        "/api/admin/users",
        json={
            "username": "Isolated User",
            "email": "isolated@example.com",
            "password": "IsolatedPass123!",
        },
    )
    assert created.status_code == 201

    with TestClient(app) as user_client:
        user_client.post("/api/auth/login", json={"email": "isolated@example.com", "password": "IsolatedPass123!"})
        titles = {task["title"] for task in user_client.get("/api/tasks").json()}
        assert "Admin-only task" not in titles
        assert user_client.patch(f"/api/tasks/{admin_task['id']}", json={"title": "stolen"}).status_code == 404
        user_task = user_client.post("/api/tasks", json={"title": "User-only task"})
        assert user_task.status_code == 201

    admin_titles = {task["title"] for task in client.get("/api/tasks").json()}
    assert "Admin-only task" in admin_titles
    assert "User-only task" not in admin_titles


def test_feedback_is_private_for_users_and_visible_to_admin(client: TestClient) -> None:
    admin_feedback = client.post(
        "/api/feedback",
        json={"name": "Administrator", "email": "admin-contact@example.com", "message": "Admin note"},
    )
    assert admin_feedback.status_code == 201

    created = client.post(
        "/api/admin/users",
        json={
            "username": "Feedback User",
            "email": "feedback-user@example.com",
            "password": "FeedbackPass123!",
        },
    )
    user_id = created.json()["user"]["id"]
    image = "data:image/png;base64,aGVsbG8="

    with TestClient(app) as user_client:
        login = user_client.post(
            "/api/auth/login", json={"email": "feedback-user@example.com", "password": "FeedbackPass123!"}
        )
        assert login.status_code == 200
        submitted = user_client.post(
            "/api/feedback",
            json={
                "name": "Feedback User",
                "email": "reply@example.com",
                "message": "Please add this feature",
                "image": image,
            },
        )
        assert submitted.status_code == 201
        assert submitted.json()["user_id"] == user_id
        assert submitted.json()["account_email"] == "feedback-user@example.com"
        own_feedback = user_client.get("/api/feedback")
        assert own_feedback.status_code == 200
        assert [item["message"] for item in own_feedback.json()] == ["Please add this feature"]
        assert user_client.get("/api/admin/feedback").status_code == 403

    inbox = client.get("/api/admin/feedback")
    assert inbox.status_code == 200
    assert {item["message"] for item in inbox.json()} == {"Admin note", "Please add this feature"}
    assert (
        client.post(
            "/api/feedback",
            json={"name": "Admin", "email": "admin@example.com", "message": "Bad image", "image": "not-an-image"},
        ).status_code
        == 422
    )


def test_cleanup_removes_only_legacy_starter_batches(client: TestClient) -> None:
    created = client.post(
        "/api/admin/users",
        json={
            "username": "Legacy User",
            "email": "legacy@example.com",
            "password": "LegacyPass123!",
            "role": "user",
        },
    )
    assert created.status_code == 201
    user_id = created.json()["user"]["id"]

    with transaction() as connection:
        seed_database(connection, user_id, "Legacy User")
        connection.execute(
            """
            INSERT INTO tasks(
                id, user_id, title, status, priority, category, estimate_minutes,
                tags, recurring_rule, created_at
            ) VALUES (?, ?, ?, 'todo', 'medium', 'personal', 30, '[]', 'none', ?)
            """,
            (new_id(), user_id, "Keep this user task", "2099-01-01T00:00:00+00:00"),
        )
        connection.execute("DELETE FROM app_migrations WHERE name = ?", (EMPTY_USER_WORKSPACES_MIGRATION,))
        admin_id = connection.execute("SELECT id FROM users WHERE role = 'admin'").fetchone()["id"]
        cleanup_non_admin_starter_data(connection, admin_id)

        tasks = connection.execute("SELECT title FROM tasks WHERE user_id = ? ORDER BY title", (user_id,)).fetchall()
        assert [row["title"] for row in tasks] == ["Keep this user task"]
        for table in ("routine_blocks", "goals", "habits", "reminders"):
            count = connection.execute(
                f"SELECT COUNT(*) AS count FROM {table} WHERE user_id = ?", (user_id,)
            ).fetchone()
            assert count["count"] == 0
        admin_routine_count = connection.execute(
            "SELECT COUNT(*) AS count FROM routine_blocks WHERE user_id = ?", (admin_id,)
        ).fetchone()
        assert admin_routine_count["count"] > 0


def test_bootstrap_admin_credentials(client: TestClient) -> None:
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == ADMIN_EMAIL
    assert me.json()["role"] == "admin"
    assert client.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}).status_code == 200
