from __future__ import annotations

import json
import os
import sqlite3
from contextlib import asynccontextmanager
from datetime import date, timedelta
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .database import (
    all_rows,
    connect,
    init_db,
    new_id,
    now_iso,
    row_to_dict,
    seed_database,
    settings_dict,
    transaction,
)
from .schemas import (
    EventCreate,
    EventUpdate,
    GoalCreate,
    GoalUpdate,
    HabitCheckIn,
    HabitCreate,
    HabitUpdate,
    ImportRequest,
    ReminderCreate,
    ReminderUpdate,
    RoutineBlockCreate,
    RoutineBlockUpdate,
    SettingsUpdate,
    TaskCreate,
    TaskUpdate,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="Vice Planner API",
    description="Persistent daily and weekly planner backend.",
    version="1.0.0",
    lifespan=lifespan,
)

origins = [
    item.strip()
    for item in os.getenv(
        "VICE_PLANNER_CORS_ORIGINS",
        "http://localhost:3000,http://localhost:4173,http://localhost:5173,http://terminal.local:4173",
    ).split(",")
    if item.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


TABLE_FIELDS: dict[str, list[str]] = {
    "tasks": [
        "title",
        "notes",
        "status",
        "priority",
        "category",
        "due_date",
        "scheduled_date",
        "estimate_minutes",
        "tags",
        "recurring_rule",
    ],
    "routine_blocks": [
        "title",
        "days",
        "start_time",
        "end_time",
        "category",
        "color",
        "notes",
        "is_movement",
        "is_active",
    ],
    "events": [
        "title",
        "description",
        "event_date",
        "start_time",
        "end_time",
        "category",
        "color",
        "location",
        "recurring_rule",
        "completed",
    ],
    "goals": ["title", "description", "target_value", "current_value", "unit", "deadline", "status", "color"],
    "habits": ["name", "description", "icon", "color", "target_days"],
    "reminders": ["title", "body", "remind_at", "recurrence", "enabled", "channel", "related_type", "related_id"],
}

JSON_FIELDS = {"tags", "days", "target_days"}
BOOLEAN_FIELDS = {"is_movement", "is_active", "completed", "enabled"}


def normalized_payload(model: BaseModel) -> dict[str, Any]:
    payload = model.model_dump(exclude_unset=True)
    for key, value in list(payload.items()):
        if key in JSON_FIELDS:
            payload[key] = json.dumps(value)
        elif key in BOOLEAN_FIELDS:
            payload[key] = int(bool(value))
    return payload


def get_record(connection: sqlite3.Connection, table: str, record_id: str) -> dict[str, Any]:
    record = row_to_dict(connection.execute(f"SELECT * FROM {table} WHERE id = ?", (record_id,)).fetchone())
    if not record:
        raise HTTPException(status_code=404, detail=f"{table.rstrip('s').replace('_', ' ')} not found")
    return record


def create_record(table: str, model: BaseModel) -> dict[str, Any]:
    payload = normalized_payload(model)
    payload["id"] = new_id()
    payload["created_at"] = now_iso()
    columns = list(payload)
    placeholders = ", ".join("?" for _ in columns)
    with transaction() as connection:
        connection.execute(
            f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({placeholders})",
            tuple(payload[column] for column in columns),
        )
        return get_record(connection, table, payload["id"])


def update_record(table: str, record_id: str, model: BaseModel) -> dict[str, Any]:
    payload = normalized_payload(model)
    with transaction() as connection:
        current = get_record(connection, table, record_id)
        if table in {"events", "routine_blocks"}:
            start_time = payload.get("start_time", current["start_time"])
            end_time = payload.get("end_time", current["end_time"])
            if end_time <= start_time:
                raise HTTPException(status_code=422, detail="end_time must be later than start_time")
        if table == "tasks" and payload.get("status") == "done" and current["status"] != "done":
            payload["completed_at"] = now_iso()
        elif table == "tasks" and payload.get("status") and payload["status"] != "done":
            payload["completed_at"] = None
        if not payload:
            return current
        assignments = ", ".join(f"{key} = ?" for key in payload)
        connection.execute(
            f"UPDATE {table} SET {assignments} WHERE id = ?",
            (*payload.values(), record_id),
        )
        return get_record(connection, table, record_id)


def delete_record(table: str, record_id: str) -> Response:
    with transaction() as connection:
        get_record(connection, table, record_id)
        connection.execute(f"DELETE FROM {table} WHERE id = ?", (record_id,))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/")
def root() -> dict[str, str]:
    return {"name": "Vice Planner API", "docs": "/docs", "health": "/api/health"}


@app.get("/api/health")
def health() -> dict[str, str]:
    with connect() as connection:
        connection.execute("SELECT 1").fetchone()
    return {"status": "healthy", "service": "vice-planner-api", "version": "1.0.0"}


@app.get("/api/settings")
def get_settings() -> dict[str, Any]:
    with connect() as connection:
        return settings_dict(connection)


@app.patch("/api/settings")
def patch_settings(payload: SettingsUpdate) -> dict[str, Any]:
    updates = payload.model_dump(exclude_unset=True)
    with transaction() as connection:
        for key, value in updates.items():
            connection.execute(
                "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, json.dumps(value)),
            )
        return settings_dict(connection)


@app.get("/api/tasks")
def list_tasks(
    task_status: str | None = Query(default=None, alias="status"),
    priority: str | None = None,
    scheduled_date: str | None = None,
    search: str | None = None,
) -> list[dict[str, Any]]:
    clauses: list[str] = []
    parameters: list[Any] = []
    if task_status:
        clauses.append("status = ?")
        parameters.append(task_status)
    if priority:
        clauses.append("priority = ?")
        parameters.append(priority)
    if scheduled_date:
        clauses.append("scheduled_date = ?")
        parameters.append(scheduled_date)
    if search:
        clauses.append("(LOWER(title) LIKE ? OR LOWER(notes) LIKE ? OR LOWER(tags) LIKE ?)")
        needle = f"%{search.lower()}%"
        parameters.extend([needle, needle, needle])
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with connect() as connection:
        return all_rows(
            connection,
            f"SELECT * FROM tasks {where} ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, COALESCE(due_date, '9999-12-31'), created_at DESC",
            tuple(parameters),
        )


@app.post("/api/tasks", status_code=201)
def post_task(payload: TaskCreate) -> dict[str, Any]:
    return create_record("tasks", payload)


@app.patch("/api/tasks/{record_id}")
def patch_task(record_id: str, payload: TaskUpdate) -> dict[str, Any]:
    return update_record("tasks", record_id, payload)


@app.delete("/api/tasks/{record_id}", status_code=204)
def remove_task(record_id: str) -> Response:
    return delete_record("tasks", record_id)


@app.get("/api/routine-blocks")
def list_routine_blocks(day: str | None = None) -> list[dict[str, Any]]:
    with connect() as connection:
        rows = all_rows(connection, "SELECT * FROM routine_blocks ORDER BY start_time, end_time")
    return [row for row in rows if not day or day.lower() in row["days"]]


@app.post("/api/routine-blocks", status_code=201)
def post_routine_block(payload: RoutineBlockCreate) -> dict[str, Any]:
    return create_record("routine_blocks", payload)


@app.patch("/api/routine-blocks/{record_id}")
def patch_routine_block(record_id: str, payload: RoutineBlockUpdate) -> dict[str, Any]:
    return update_record("routine_blocks", record_id, payload)


@app.delete("/api/routine-blocks/{record_id}", status_code=204)
def remove_routine_block(record_id: str) -> Response:
    return delete_record("routine_blocks", record_id)


@app.get("/api/events")
def list_events(start: str | None = None, end: str | None = None) -> list[dict[str, Any]]:
    clauses: list[str] = []
    parameters: list[str] = []
    if start:
        clauses.append("event_date >= ?")
        parameters.append(start)
    if end:
        clauses.append("event_date <= ?")
        parameters.append(end)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with connect() as connection:
        return all_rows(connection, f"SELECT * FROM events {where} ORDER BY event_date, start_time", tuple(parameters))


@app.post("/api/events", status_code=201)
def post_event(payload: EventCreate) -> dict[str, Any]:
    return create_record("events", payload)


@app.patch("/api/events/{record_id}")
def patch_event(record_id: str, payload: EventUpdate) -> dict[str, Any]:
    return update_record("events", record_id, payload)


@app.delete("/api/events/{record_id}", status_code=204)
def remove_event(record_id: str) -> Response:
    return delete_record("events", record_id)


@app.get("/api/goals")
def list_goals(goal_status: str | None = Query(default=None, alias="status")) -> list[dict[str, Any]]:
    with connect() as connection:
        if goal_status:
            return all_rows(
                connection, "SELECT * FROM goals WHERE status = ? ORDER BY deadline, created_at", (goal_status,)
            )
        return all_rows(
            connection,
            "SELECT * FROM goals ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, deadline, created_at",
        )


@app.post("/api/goals", status_code=201)
def post_goal(payload: GoalCreate) -> dict[str, Any]:
    return create_record("goals", payload)


@app.patch("/api/goals/{record_id}")
def patch_goal(record_id: str, payload: GoalUpdate) -> dict[str, Any]:
    updated = update_record("goals", record_id, payload)
    if updated["current_value"] >= updated["target_value"] and updated["status"] == "active":
        updated = update_record("goals", record_id, GoalUpdate(status="completed"))
    return updated


@app.delete("/api/goals/{record_id}", status_code=204)
def remove_goal(record_id: str) -> Response:
    return delete_record("goals", record_id)


@app.get("/api/habits")
def list_habits(start: str | None = None, end: str | None = None) -> list[dict[str, Any]]:
    end_date = date.fromisoformat(end) if end else date.today()
    start_date = date.fromisoformat(start) if start else end_date - timedelta(days=6)
    with connect() as connection:
        habits = all_rows(connection, "SELECT * FROM habits ORDER BY created_at")
        entries = all_rows(
            connection,
            "SELECT * FROM habit_entries WHERE entry_date BETWEEN ? AND ? ORDER BY entry_date",
            (start_date.isoformat(), end_date.isoformat()),
        )
    for habit in habits:
        habit_entries = [entry for entry in entries if entry["habit_id"] == habit["id"]]
        habit["entries"] = habit_entries
        habit["completed_count"] = sum(1 for entry in habit_entries if entry["completed"])
        habit["streak"] = calculate_streak(habit_entries, end_date)
    return habits


def calculate_streak(entries: list[dict[str, Any]], end_date: date) -> int:
    completed = {entry["entry_date"] for entry in entries if entry["completed"]}
    cursor = end_date
    if cursor.isoformat() not in completed:
        cursor -= timedelta(days=1)
    streak = 0
    while cursor.isoformat() in completed:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


@app.post("/api/habits", status_code=201)
def post_habit(payload: HabitCreate) -> dict[str, Any]:
    record = create_record("habits", payload)
    record.update({"entries": [], "completed_count": 0, "streak": 0})
    return record


@app.patch("/api/habits/{record_id}")
def patch_habit(record_id: str, payload: HabitUpdate) -> dict[str, Any]:
    return update_record("habits", record_id, payload)


@app.delete("/api/habits/{record_id}", status_code=204)
def remove_habit(record_id: str) -> Response:
    return delete_record("habits", record_id)


@app.put("/api/habits/{habit_id}/check-ins")
def put_habit_check_in(habit_id: str, payload: HabitCheckIn) -> dict[str, Any]:
    with transaction() as connection:
        get_record(connection, "habits", habit_id)
        existing = connection.execute(
            "SELECT id FROM habit_entries WHERE habit_id = ? AND entry_date = ?",
            (habit_id, payload.entry_date),
        ).fetchone()
        entry_id = existing["id"] if existing else new_id()
        connection.execute(
            """
            INSERT INTO habit_entries(id, habit_id, entry_date, completed, value, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(habit_id, entry_date) DO UPDATE SET
                completed = excluded.completed, value = excluded.value, note = excluded.note
            """,
            (entry_id, habit_id, payload.entry_date, int(payload.completed), payload.value, payload.note, now_iso()),
        )
        record = row_to_dict(connection.execute("SELECT * FROM habit_entries WHERE id = ?", (entry_id,)).fetchone())
        return record or {}


@app.get("/api/reminders")
def list_reminders(enabled: bool | None = None) -> list[dict[str, Any]]:
    with connect() as connection:
        if enabled is None:
            return all_rows(connection, "SELECT * FROM reminders ORDER BY remind_at")
        return all_rows(connection, "SELECT * FROM reminders WHERE enabled = ? ORDER BY remind_at", (int(enabled),))


@app.post("/api/reminders", status_code=201)
def post_reminder(payload: ReminderCreate) -> dict[str, Any]:
    return create_record("reminders", payload)


@app.patch("/api/reminders/{record_id}")
def patch_reminder(record_id: str, payload: ReminderUpdate) -> dict[str, Any]:
    return update_record("reminders", record_id, payload)


@app.delete("/api/reminders/{record_id}", status_code=204)
def remove_reminder(record_id: str) -> Response:
    return delete_record("reminders", record_id)


@app.get("/api/dashboard")
def dashboard(selected_date: str | None = Query(default=None, alias="date")) -> dict[str, Any]:
    target = date.fromisoformat(selected_date) if selected_date else date.today()
    day_name = target.strftime("%A").lower()
    with connect() as connection:
        tasks = all_rows(
            connection,
            """
            SELECT * FROM tasks
            WHERE scheduled_date = ? OR due_date = ? OR (due_date < ? AND status NOT IN ('done', 'archived'))
            ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, due_date
            """,
            (target.isoformat(), target.isoformat(), target.isoformat()),
        )
        events = all_rows(
            connection, "SELECT * FROM events WHERE event_date = ? ORDER BY start_time", (target.isoformat(),)
        )
        routine = [
            row
            for row in all_rows(connection, "SELECT * FROM routine_blocks WHERE is_active = 1 ORDER BY start_time")
            if day_name in row["days"]
        ]
        habits = all_rows(connection, "SELECT * FROM habits ORDER BY created_at")
        checkins = all_rows(connection, "SELECT * FROM habit_entries WHERE entry_date = ?", (target.isoformat(),))
        goals = all_rows(connection, "SELECT * FROM goals WHERE status = 'active' ORDER BY deadline")
        reminders = all_rows(
            connection,
            "SELECT * FROM reminders WHERE enabled = 1 AND remind_at >= ? AND remind_at < ? ORDER BY remind_at LIMIT 6",
            (f"{target.isoformat()}T00:00", f"{(target + timedelta(days=7)).isoformat()}T00:00"),
        )
        settings = settings_dict(connection)
    completed_task_count = sum(1 for task in tasks if task["status"] == "done")
    completed_habits = sum(1 for item in checkins if item["completed"])
    movement_minutes = sum(
        max(0, minutes_between(block["start_time"], block["end_time"])) for block in routine if block["is_movement"]
    )
    return {
        "date": target.isoformat(),
        "day_name": day_name,
        "settings": settings,
        "tasks": tasks,
        "events": events,
        "routine": routine,
        "habits": habits,
        "habit_entries": checkins,
        "goals": goals,
        "reminders": reminders,
        "metrics": {
            "tasks_total": len(tasks),
            "tasks_completed": completed_task_count,
            "habits_total": len(habits),
            "habits_completed": completed_habits,
            "movement_minutes": movement_minutes,
            "scheduled_blocks": len(routine) + len(events),
        },
    }


def minutes_between(start_time: str, end_time: str) -> int:
    start_hour, start_minute = (int(part) for part in start_time.split(":"))
    end_hour, end_minute = (int(part) for part in end_time.split(":"))
    return (end_hour * 60 + end_minute) - (start_hour * 60 + start_minute)


@app.get("/api/insights")
def insights(start: str | None = None, end: str | None = None) -> dict[str, Any]:
    end_date = date.fromisoformat(end) if end else date.today()
    start_date = date.fromisoformat(start) if start else end_date - timedelta(days=6)
    days = [(start_date + timedelta(days=index)) for index in range((end_date - start_date).days + 1)]
    with connect() as connection:
        tasks = all_rows(connection, "SELECT * FROM tasks")
        entries = all_rows(
            connection,
            "SELECT * FROM habit_entries WHERE entry_date BETWEEN ? AND ?",
            (start_date.isoformat(), end_date.isoformat()),
        )
        habits = all_rows(connection, "SELECT * FROM habits")
        goals = all_rows(connection, "SELECT * FROM goals")
    daily = []
    for current in days:
        day_key = current.isoformat()
        daily.append(
            {
                "date": day_key,
                "label": current.strftime("%a"),
                "tasks_completed": sum(1 for task in tasks if (task.get("completed_at") or "").startswith(day_key)),
                "habits_completed": sum(
                    1 for entry in entries if entry["entry_date"] == day_key and entry["completed"]
                ),
            }
        )
    task_total = sum(
        1
        for task in tasks
        if task.get("scheduled_date") and start_date.isoformat() <= task["scheduled_date"] <= end_date.isoformat()
    )
    task_done = sum(
        1
        for task in tasks
        if task.get("completed_at") and start_date.isoformat() <= task["completed_at"][:10] <= end_date.isoformat()
    )
    possible_habits = max(1, len(habits) * len(days))
    return {
        "start": start_date.isoformat(),
        "end": end_date.isoformat(),
        "daily": daily,
        "task_completion_rate": round((task_done / task_total * 100) if task_total else 0, 1),
        "habit_completion_rate": round(sum(1 for entry in entries if entry["completed"]) / possible_habits * 100, 1),
        "active_goals": sum(1 for goal in goals if goal["status"] == "active"),
        "completed_goals": sum(1 for goal in goals if goal["status"] == "completed"),
    }


EXPORT_TABLES = ["routine_blocks", "tasks", "events", "goals", "habits", "habit_entries", "reminders"]


@app.get("/api/export")
def export_data() -> dict[str, Any]:
    with connect() as connection:
        result = {table: all_rows(connection, f"SELECT * FROM {table}") for table in EXPORT_TABLES}
        result["settings"] = settings_dict(connection)
    return {"version": 1, "exported_at": now_iso(), "data": result}


@app.post("/api/import")
def import_data(payload: ImportRequest) -> dict[str, Any]:
    data = payload.data.get("data", payload.data)
    with transaction() as connection:
        if payload.mode == "replace":
            for table in [
                "habit_entries",
                "reminders",
                "tasks",
                "events",
                "goals",
                "habits",
                "routine_blocks",
                "settings",
            ]:
                connection.execute(f"DELETE FROM {table}")
        settings = data.get("settings", {})
        if isinstance(settings, dict):
            for key, value in settings.items():
                connection.execute(
                    "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (str(key), json.dumps(value)),
                )
        imported = 0
        for table in EXPORT_TABLES:
            rows = data.get(table, [])
            if not isinstance(rows, list):
                continue
            allowed = {"id", "created_at", *TABLE_FIELDS.get(table, [])}
            if table == "habit_entries":
                allowed = {"id", "habit_id", "entry_date", "completed", "value", "note", "created_at"}
            for raw in rows:
                if not isinstance(raw, dict):
                    continue
                row = {key: value for key, value in raw.items() if key in allowed}
                row.setdefault("id", new_id())
                row.setdefault("created_at", now_iso())
                for key in JSON_FIELDS:
                    if key in row and not isinstance(row[key], str):
                        row[key] = json.dumps(row[key])
                for key in BOOLEAN_FIELDS:
                    if key in row:
                        row[key] = int(bool(row[key]))
                if not row:
                    continue
                columns = list(row)
                connection.execute(
                    f"INSERT OR REPLACE INTO {table} ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",
                    tuple(row[column] for column in columns),
                )
                imported += 1
    return {"status": "ok", "mode": payload.mode, "records_imported": imported}


@app.post("/api/system/reset")
def reset_system() -> dict[str, str]:
    with transaction() as connection:
        for table in ["habit_entries", "reminders", "tasks", "events", "goals", "habits", "routine_blocks", "settings"]:
            connection.execute(f"DELETE FROM {table}")
        seed_database(connection)
    return {"status": "ok", "message": "Sample planner data restored"}
