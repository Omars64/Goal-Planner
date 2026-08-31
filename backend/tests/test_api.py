from __future__ import annotations

from datetime import date, datetime, timedelta


def test_health_and_seeded_dashboard(client):
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["status"] == "healthy"

    dashboard = client.get("/api/dashboard", params={"date": date.today().isoformat()})
    assert dashboard.status_code == 200
    body = dashboard.json()
    assert body["settings"]["display_name"] == "Omar"
    assert body["settings"]["daily_step_goal"] == 10000
    assert "metrics" in body


def test_hosted_frontend_origin_is_allowed(client):
    origin = "https://omars64-goal-planner.omarsolanki35.chatgpt.site"
    response = client.options(
        "/api/health",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


def test_task_crud_and_completion(client):
    created = client.post(
        "/api/tasks",
        json={
            "title": "Regression test the planner",
            "priority": "urgent",
            "scheduled_date": date.today().isoformat(),
            "estimate_minutes": 45,
            "tags": ["engineering", "qa"],
        },
    )
    assert created.status_code == 201
    task = created.json()
    assert task["tags"] == ["engineering", "qa"]

    updated = client.patch(f"/api/tasks/{task['id']}", json={"status": "done"})
    assert updated.status_code == 200
    assert updated.json()["status"] == "done"
    assert updated.json()["completed_at"] is not None

    search = client.get("/api/tasks", params={"search": "Regression"})
    assert search.status_code == 200
    assert any(item["id"] == task["id"] for item in search.json())

    deleted = client.delete(f"/api/tasks/{task['id']}")
    assert deleted.status_code == 204
    assert client.patch(f"/api/tasks/{task['id']}", json={"priority": "low"}).status_code == 404


def test_event_validation_and_week_range(client):
    invalid = client.post(
        "/api/events",
        json={
            "title": "Invalid event",
            "event_date": date.today().isoformat(),
            "start_time": "15:00",
            "end_time": "14:00",
        },
    )
    assert invalid.status_code == 422

    valid = client.post(
        "/api/events",
        json={
            "title": "Architecture review",
            "event_date": date.today().isoformat(),
            "start_time": "10:00",
            "end_time": "10:30",
            "category": "work",
        },
    )
    assert valid.status_code == 201
    events = client.get(
        "/api/events",
        params={"start": date.today().isoformat(), "end": (date.today() + timedelta(days=6)).isoformat()},
    )
    assert any(item["title"] == "Architecture review" for item in events.json())


def test_habit_checkin_is_idempotent(client):
    habits = client.get("/api/habits").json()
    habit_id = habits[0]["id"]
    payload = {"entry_date": date.today().isoformat(), "completed": True, "value": 1}
    first = client.put(f"/api/habits/{habit_id}/check-ins", json=payload)
    second = client.put(f"/api/habits/{habit_id}/check-ins", json={**payload, "note": "done"})
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert second.json()["note"] == "done"


def test_goal_progress_auto_completes(client):
    goal = client.post(
        "/api/goals",
        json={"title": "Five walks", "target_value": 5, "unit": "walks"},
    ).json()
    updated = client.patch(f"/api/goals/{goal['id']}", json={"current_value": 5})
    assert updated.status_code == 200
    assert updated.json()["status"] == "completed"


def test_reminder_and_settings(client):
    reminder = client.post(
        "/api/reminders",
        json={
            "title": "Stand up",
            "remind_at": (datetime.now() + timedelta(hours=1)).isoformat(timespec="minutes"),
            "recurrence": "weekdays",
        },
    )
    assert reminder.status_code == 201
    toggled = client.patch(f"/api/reminders/{reminder.json()['id']}", json={"enabled": False})
    assert toggled.json()["enabled"] is False

    settings = client.patch("/api/settings", json={"daily_step_goal": 8500, "compact_mode": True})
    assert settings.status_code == 200
    assert settings.json()["daily_step_goal"] == 8500
    assert settings.json()["compact_mode"] is True


def test_export_import_round_trip(client):
    exported = client.get("/api/export")
    assert exported.status_code == 200
    snapshot = exported.json()
    assert snapshot["version"] == 1
    assert snapshot["data"]["routine_blocks"]

    imported = client.post("/api/import", json={"mode": "replace", "data": snapshot})
    assert imported.status_code == 200
    assert imported.json()["records_imported"] > 0
    assert client.get("/api/routine-blocks", params={"day": "sunday"}).json()


def test_insights_contract(client):
    response = client.get("/api/insights")
    assert response.status_code == 200
    body = response.json()
    assert len(body["daily"]) == 7
    assert 0 <= body["habit_completion_rate"] <= 100
    assert "task_completion_rate" in body
