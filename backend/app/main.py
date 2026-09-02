from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from datetime import date, timedelta
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .auth import require_admin, require_user
from .auth import router as auth_router
from .database import (
    DEFAULT_TASK_PHASES,
    DatabaseConnection,
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
    FeedbackCreate,
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
    TaskPhaseCreate,
    TaskPhaseUpdate,
    TaskUpdate,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="Goal Planner API",
    description="Persistent daily and weekly planner backend.",
    version="1.0.0",
    lifespan=lifespan,
)

origins = [
    item.strip()
    for item in os.getenv(
        "VICE_PLANNER_CORS_ORIGINS",
        (
            "http://localhost:3000,http://localhost:4173,http://localhost:5173,"
            "http://127.0.0.1:3000,http://127.0.0.1:4173,http://127.0.0.1:5173,"
            "http://terminal.local:4173,"
            "https://omars64-goal-planner.omarsolanki35.chatgpt.site"
        ),
    ).split(",")
    if item.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=os.getenv(
        "GOAL_PLANNER_CORS_ORIGIN_REGEX",
        r"https://goal-planner(?:-[a-z0-9-]+)*\.vercel\.app",
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)


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


def get_record(connection: DatabaseConnection, table: str, record_id: str, user_id: str) -> dict[str, Any]:
    record = row_to_dict(
        connection.execute(f"SELECT * FROM {table} WHERE id = ? AND user_id = ?", (record_id, user_id)).fetchone()
    )
    if not record:
        raise HTTPException(status_code=404, detail=f"{table.rstrip('s').replace('_', ' ')} not found")
    return record


def create_record(table: str, model: BaseModel, user_id: str) -> dict[str, Any]:
    payload = normalized_payload(model)
    payload["id"] = new_id()
    payload["user_id"] = user_id
    payload["created_at"] = now_iso()
    columns = list(payload)
    placeholders = ", ".join("?" for _ in columns)
    with transaction() as connection:
        connection.execute(
            f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({placeholders})",
            tuple(payload[column] for column in columns),
        )
        return get_record(connection, table, payload["id"], user_id)


def update_record(table: str, record_id: str, model: BaseModel, user_id: str) -> dict[str, Any]:
    payload = normalized_payload(model)
    with transaction() as connection:
        current = get_record(connection, table, record_id, user_id)
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
            f"UPDATE {table} SET {assignments} WHERE id = ? AND user_id = ?",
            (*payload.values(), record_id, user_id),
        )
        return get_record(connection, table, record_id, user_id)


def delete_record(table: str, record_id: str, user_id: str) -> Response:
    with transaction() as connection:
        get_record(connection, table, record_id, user_id)
        connection.execute(f"DELETE FROM {table} WHERE id = ? AND user_id = ?", (record_id, user_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/")
def root() -> dict[str, str]:
    return {"name": "Goal Planner API", "docs": "/docs", "health": "/api/health"}


@app.get("/api/health")
def health() -> dict[str, str]:
    with connect() as connection:
        connection.execute("SELECT 1").fetchone()
    return {"status": "healthy", "service": "goal-planner-api", "version": "1.0.0"}


@app.get("/api/settings")
def get_settings(user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    with connect() as connection:
        return settings_dict(connection, user["id"])


@app.patch("/api/settings")
def patch_settings(payload: SettingsUpdate, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    updates = payload.model_dump(exclude_unset=True)
    with transaction() as connection:
        for key, value in updates.items():
            connection.execute(
                """
                INSERT INTO user_settings(user_id, key, value) VALUES (?, ?, ?)
                ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
                """,
                (user["id"], key, json.dumps(value)),
            )
        return settings_dict(connection, user["id"])


def task_phases_for_user(connection: DatabaseConnection, user_id: str) -> list[dict[str, Any]]:
    row = connection.execute(
        "SELECT value FROM user_settings WHERE user_id = ? AND key = 'task_phases'", (user_id,)
    ).fetchone()
    try:
        stored = json.loads(row["value"]) if row else []
    except (json.JSONDecodeError, TypeError):
        stored = []

    system_ids = {phase["id"] for phase in DEFAULT_TASK_PHASES}
    custom: list[dict[str, Any]] = []
    seen = set(system_ids)
    if isinstance(stored, list):
        for index, raw in enumerate(stored):
            if not isinstance(raw, dict):
                continue
            phase_id = str(raw.get("id", ""))
            name = " ".join(str(raw.get("name", "")).strip().split())
            valid_id = phase_id.replace("_", "").replace("-", "").isalnum()
            if not phase_id or phase_id in seen or len(phase_id) > 80 or not valid_id or not name:
                continue
            raw_position = raw.get("position", index + 2)
            position = raw_position if isinstance(raw_position, int) else index + 2
            seen.add(phase_id)
            custom.append(
                {
                    "id": phase_id,
                    "name": name[:40],
                    "position": position,
                    "is_done": False,
                    "is_system": False,
                }
            )

    custom.sort(key=lambda phase: (phase["position"], phase["name"].lower()))
    phases = [dict(DEFAULT_TASK_PHASES[0]), dict(DEFAULT_TASK_PHASES[1]), *custom, dict(DEFAULT_TASK_PHASES[2])]
    for position, phase in enumerate(phases):
        phase["position"] = position
    if not row:
        save_task_phases(connection, user_id, phases)
    return phases


def save_task_phases(connection: DatabaseConnection, user_id: str, phases: list[dict[str, Any]]) -> None:
    connection.execute(
        """
        INSERT INTO user_settings(user_id, key, value) VALUES (?, 'task_phases', ?)
        ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
        """,
        (user_id, json.dumps(phases)),
    )


def require_task_phase(connection: DatabaseConnection, user_id: str, phase_id: str) -> dict[str, Any]:
    phase = next((item for item in task_phases_for_user(connection, user_id) if item["id"] == phase_id), None)
    if not phase:
        raise HTTPException(status_code=422, detail="Choose a phase that exists on your board")
    return phase


@app.get("/api/task-phases")
def list_task_phases(user: dict[str, Any] = Depends(require_user)) -> list[dict[str, Any]]:
    with transaction() as connection:
        return task_phases_for_user(connection, user["id"])


@app.post("/api/task-phases", status_code=201)
def post_task_phase(payload: TaskPhaseCreate, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    with transaction() as connection:
        phases = task_phases_for_user(connection, user["id"])
        if any(phase["name"].casefold() == payload.name.casefold() for phase in phases):
            raise HTTPException(status_code=409, detail="A phase with this name already exists")
        created = {
            "id": f"phase_{new_id()}",
            "name": payload.name,
            "position": len(phases) - 1,
            "is_done": False,
            "is_system": False,
        }
        phases.insert(-1, created)
        for position, phase in enumerate(phases):
            phase["position"] = position
        save_task_phases(connection, user["id"], phases)
        return created


@app.patch("/api/task-phases/{phase_id}")
def patch_task_phase(
    phase_id: str, payload: TaskPhaseUpdate, user: dict[str, Any] = Depends(require_user)
) -> dict[str, Any]:
    with transaction() as connection:
        phases = task_phases_for_user(connection, user["id"])
        phase = next((item for item in phases if item["id"] == phase_id), None)
        if not phase:
            raise HTTPException(status_code=404, detail="Phase not found")
        if phase["is_system"]:
            raise HTTPException(status_code=400, detail="Built-in phases cannot be renamed")
        if any(item["id"] != phase_id and item["name"].casefold() == payload.name.casefold() for item in phases):
            raise HTTPException(status_code=409, detail="A phase with this name already exists")
        phase["name"] = payload.name
        save_task_phases(connection, user["id"], phases)
        return phase


@app.delete("/api/task-phases/{phase_id}")
def delete_task_phase(phase_id: str, user: dict[str, Any] = Depends(require_user)) -> dict[str, str]:
    with transaction() as connection:
        phases = task_phases_for_user(connection, user["id"])
        phase = next((item for item in phases if item["id"] == phase_id), None)
        if not phase:
            raise HTTPException(status_code=404, detail="Phase not found")
        if phase["is_system"]:
            raise HTTPException(status_code=400, detail="Built-in phases cannot be deleted")
        connection.execute(
            "UPDATE tasks SET status = 'todo', completed_at = NULL WHERE user_id = ? AND status = ?",
            (user["id"], phase_id),
        )
        save_task_phases(connection, user["id"], [item for item in phases if item["id"] != phase_id])
        return {"message": f"{phase['name']} was removed. Its tasks were moved to To do"}


@app.get("/api/tasks")
def list_tasks(
    task_status: str | None = Query(default=None, alias="status"),
    priority: str | None = None,
    scheduled_date: str | None = None,
    search: str | None = None,
    user: dict[str, Any] = Depends(require_user),
) -> list[dict[str, Any]]:
    clauses: list[str] = ["user_id = ?"]
    parameters: list[Any] = [user["id"]]
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
def post_task(payload: TaskCreate, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    with transaction() as connection:
        require_task_phase(connection, user["id"], payload.status)
    return create_record("tasks", payload, user["id"])


@app.patch("/api/tasks/{record_id}")
def patch_task(record_id: str, payload: TaskUpdate, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    if payload.status is not None:
        with transaction() as connection:
            require_task_phase(connection, user["id"], payload.status)
    return update_record("tasks", record_id, payload, user["id"])


@app.delete("/api/tasks/{record_id}", status_code=204)
def remove_task(record_id: str, user: dict[str, Any] = Depends(require_user)) -> Response:
    return delete_record("tasks", record_id, user["id"])


@app.get("/api/routine-blocks")
def list_routine_blocks(day: str | None = None, user: dict[str, Any] = Depends(require_user)) -> list[dict[str, Any]]:
    with connect() as connection:
        rows = all_rows(
            connection,
            "SELECT * FROM routine_blocks WHERE user_id = ? ORDER BY start_time, end_time",
            (user["id"],),
        )
    return [row for row in rows if not day or day.lower() in row["days"]]


@app.post("/api/routine-blocks", status_code=201)
def post_routine_block(payload: RoutineBlockCreate, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    return create_record("routine_blocks", payload, user["id"])


@app.patch("/api/routine-blocks/{record_id}")
def patch_routine_block(
    record_id: str, payload: RoutineBlockUpdate, user: dict[str, Any] = Depends(require_user)
) -> dict[str, Any]:
    return update_record("routine_blocks", record_id, payload, user["id"])


@app.delete("/api/routine-blocks/{record_id}", status_code=204)
def remove_routine_block(record_id: str, user: dict[str, Any] = Depends(require_user)) -> Response:
    return delete_record("routine_blocks", record_id, user["id"])


@app.get("/api/events")
def list_events(
    start: str | None = None,
    end: str | None = None,
    user: dict[str, Any] = Depends(require_user),
) -> list[dict[str, Any]]:
    clauses: list[str] = ["user_id = ?"]
    parameters: list[str] = [user["id"]]
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
def post_event(payload: EventCreate, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    return create_record("events", payload, user["id"])


@app.patch("/api/events/{record_id}")
def patch_event(record_id: str, payload: EventUpdate, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    return update_record("events", record_id, payload, user["id"])


@app.delete("/api/events/{record_id}", status_code=204)
def remove_event(record_id: str, user: dict[str, Any] = Depends(require_user)) -> Response:
    return delete_record("events", record_id, user["id"])


@app.get("/api/goals")
def list_goals(
    goal_status: str | None = Query(default=None, alias="status"),
    user: dict[str, Any] = Depends(require_user),
) -> list[dict[str, Any]]:
    with connect() as connection:
        if goal_status:
            return all_rows(
                connection,
                "SELECT * FROM goals WHERE user_id = ? AND status = ? ORDER BY deadline, created_at",
                (user["id"], goal_status),
            )
        return all_rows(
            connection,
            """
            SELECT * FROM goals WHERE user_id = ?
            ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, deadline, created_at
            """,
            (user["id"],),
        )


@app.post("/api/goals", status_code=201)
def post_goal(payload: GoalCreate, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    return create_record("goals", payload, user["id"])


@app.patch("/api/goals/{record_id}")
def patch_goal(record_id: str, payload: GoalUpdate, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    updated = update_record("goals", record_id, payload, user["id"])
    if updated["current_value"] >= updated["target_value"] and updated["status"] == "active":
        updated = update_record("goals", record_id, GoalUpdate(status="completed"), user["id"])
    return updated


@app.delete("/api/goals/{record_id}", status_code=204)
def remove_goal(record_id: str, user: dict[str, Any] = Depends(require_user)) -> Response:
    return delete_record("goals", record_id, user["id"])


@app.get("/api/habits")
def list_habits(
    start: str | None = None,
    end: str | None = None,
    user: dict[str, Any] = Depends(require_user),
) -> list[dict[str, Any]]:
    end_date = date.fromisoformat(end) if end else date.today()
    start_date = date.fromisoformat(start) if start else end_date - timedelta(days=6)
    with connect() as connection:
        habits = all_rows(connection, "SELECT * FROM habits WHERE user_id = ? ORDER BY created_at", (user["id"],))
        entries = all_rows(
            connection,
            "SELECT * FROM habit_entries WHERE user_id = ? AND entry_date BETWEEN ? AND ? ORDER BY entry_date",
            (user["id"], start_date.isoformat(), end_date.isoformat()),
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
def post_habit(payload: HabitCreate, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    record = create_record("habits", payload, user["id"])
    record.update({"entries": [], "completed_count": 0, "streak": 0})
    return record


@app.patch("/api/habits/{record_id}")
def patch_habit(record_id: str, payload: HabitUpdate, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    return update_record("habits", record_id, payload, user["id"])


@app.delete("/api/habits/{record_id}", status_code=204)
def remove_habit(record_id: str, user: dict[str, Any] = Depends(require_user)) -> Response:
    return delete_record("habits", record_id, user["id"])


@app.put("/api/habits/{habit_id}/check-ins")
def put_habit_check_in(
    habit_id: str, payload: HabitCheckIn, user: dict[str, Any] = Depends(require_user)
) -> dict[str, Any]:
    with transaction() as connection:
        get_record(connection, "habits", habit_id, user["id"])
        existing = connection.execute(
            "SELECT id FROM habit_entries WHERE user_id = ? AND habit_id = ? AND entry_date = ?",
            (user["id"], habit_id, payload.entry_date),
        ).fetchone()
        entry_id = existing["id"] if existing else new_id()
        connection.execute(
            """
            INSERT INTO habit_entries(id, user_id, habit_id, entry_date, completed, value, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(habit_id, entry_date) DO UPDATE SET
                completed = excluded.completed, value = excluded.value, note = excluded.note
            """,
            (
                entry_id,
                user["id"],
                habit_id,
                payload.entry_date,
                int(payload.completed),
                payload.value,
                payload.note,
                now_iso(),
            ),
        )
        record = row_to_dict(
            connection.execute(
                "SELECT * FROM habit_entries WHERE id = ? AND user_id = ?", (entry_id, user["id"])
            ).fetchone()
        )
        return record or {}


@app.get("/api/reminders")
def list_reminders(enabled: bool | None = None, user: dict[str, Any] = Depends(require_user)) -> list[dict[str, Any]]:
    with connect() as connection:
        if enabled is None:
            return all_rows(connection, "SELECT * FROM reminders WHERE user_id = ? ORDER BY remind_at", (user["id"],))
        return all_rows(
            connection,
            "SELECT * FROM reminders WHERE user_id = ? AND enabled = ? ORDER BY remind_at",
            (user["id"], int(enabled)),
        )


@app.post("/api/reminders", status_code=201)
def post_reminder(payload: ReminderCreate, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    return create_record("reminders", payload, user["id"])


@app.patch("/api/reminders/{record_id}")
def patch_reminder(
    record_id: str, payload: ReminderUpdate, user: dict[str, Any] = Depends(require_user)
) -> dict[str, Any]:
    return update_record("reminders", record_id, payload, user["id"])


@app.delete("/api/reminders/{record_id}", status_code=204)
def remove_reminder(record_id: str, user: dict[str, Any] = Depends(require_user)) -> Response:
    return delete_record("reminders", record_id, user["id"])


def feedback_rows(connection: DatabaseConnection, user_id: str | None = None) -> list[dict[str, Any]]:
    where = "WHERE feedback.user_id = ?" if user_id else ""
    parameters = (user_id,) if user_id else ()
    return all_rows(
        connection,
        f"""
        SELECT feedback.*, users.username AS account_username, users.email AS account_email
        FROM feedback
        JOIN users ON users.id = feedback.user_id
        {where}
        ORDER BY feedback.created_at DESC
        """,
        parameters,
    )


@app.get("/api/feedback")
def list_feedback(user: dict[str, Any] = Depends(require_user)) -> list[dict[str, Any]]:
    with connect() as connection:
        return feedback_rows(connection, user["id"])


@app.post("/api/feedback", status_code=201)
def post_feedback(payload: FeedbackCreate, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    feedback_id = new_id()
    created_at = now_iso()
    with transaction() as connection:
        connection.execute(
            """
            INSERT INTO feedback(id, user_id, name, email, message, image, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (feedback_id, user["id"], payload.name, payload.email, payload.message, payload.image, created_at),
        )
        return feedback_rows(connection, user["id"])[0]


@app.get("/api/admin/feedback")
def list_admin_feedback(_: dict[str, Any] = Depends(require_admin)) -> list[dict[str, Any]]:
    with connect() as connection:
        return feedback_rows(connection)


@app.get("/api/dashboard")
def dashboard(
    selected_date: str | None = Query(default=None, alias="date"),
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    target = date.fromisoformat(selected_date) if selected_date else date.today()
    day_name = target.strftime("%A").lower()
    with connect() as connection:
        tasks = all_rows(
            connection,
            """
            SELECT * FROM tasks
            WHERE user_id = ? AND (
                scheduled_date = ? OR due_date = ? OR (due_date < ? AND status NOT IN ('done', 'archived'))
            )
            ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, due_date
            """,
            (user["id"], target.isoformat(), target.isoformat(), target.isoformat()),
        )
        events = all_rows(
            connection,
            "SELECT * FROM events WHERE user_id = ? AND event_date = ? ORDER BY start_time",
            (user["id"], target.isoformat()),
        )
        routine = [
            row
            for row in all_rows(
                connection,
                "SELECT * FROM routine_blocks WHERE user_id = ? AND is_active = 1 ORDER BY start_time",
                (user["id"],),
            )
            if day_name in row["days"]
        ]
        habits = all_rows(connection, "SELECT * FROM habits WHERE user_id = ? ORDER BY created_at", (user["id"],))
        checkins = all_rows(
            connection,
            "SELECT * FROM habit_entries WHERE user_id = ? AND entry_date = ?",
            (user["id"], target.isoformat()),
        )
        goals = all_rows(
            connection,
            "SELECT * FROM goals WHERE user_id = ? AND status = 'active' ORDER BY deadline",
            (user["id"],),
        )
        reminders = all_rows(
            connection,
            """
            SELECT * FROM reminders
            WHERE user_id = ? AND enabled = 1 AND remind_at >= ? AND remind_at < ?
            ORDER BY remind_at LIMIT 6
            """,
            (
                user["id"],
                f"{target.isoformat()}T00:00",
                f"{(target + timedelta(days=7)).isoformat()}T00:00",
            ),
        )
        settings = settings_dict(connection, user["id"])
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
def insights(
    start: str | None = None,
    end: str | None = None,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    end_date = date.fromisoformat(end) if end else date.today()
    start_date = date.fromisoformat(start) if start else end_date - timedelta(days=6)
    days = [(start_date + timedelta(days=index)) for index in range((end_date - start_date).days + 1)]
    with connect() as connection:
        tasks = all_rows(connection, "SELECT * FROM tasks WHERE user_id = ?", (user["id"],))
        entries = all_rows(
            connection,
            "SELECT * FROM habit_entries WHERE user_id = ? AND entry_date BETWEEN ? AND ?",
            (user["id"], start_date.isoformat(), end_date.isoformat()),
        )
        habits = all_rows(connection, "SELECT * FROM habits WHERE user_id = ?", (user["id"],))
        goals = all_rows(connection, "SELECT * FROM goals WHERE user_id = ?", (user["id"],))
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
def export_data(user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    with connect() as connection:
        result = {
            table: all_rows(connection, f"SELECT * FROM {table} WHERE user_id = ?", (user["id"],))
            for table in EXPORT_TABLES
        }
        for rows in result.values():
            for row in rows:
                row.pop("user_id", None)
        result["settings"] = settings_dict(connection, user["id"])
    return {"version": 2, "exported_at": now_iso(), "data": result}


@app.post("/api/import")
def import_data(payload: ImportRequest, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
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
            ]:
                connection.execute(f"DELETE FROM {table} WHERE user_id = ?", (user["id"],))
            connection.execute("DELETE FROM user_settings WHERE user_id = ?", (user["id"],))
        settings = data.get("settings", {})
        if isinstance(settings, dict):
            for key, value in settings.items():
                connection.execute(
                    """
                    INSERT INTO user_settings(user_id, key, value) VALUES (?, ?, ?)
                    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
                    """,
                    (user["id"], str(key), json.dumps(value)),
                )
        imported = 0
        id_maps: dict[str, dict[str, str]] = {}
        for table in EXPORT_TABLES:
            id_maps[table] = {}
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
                original_id = str(row["id"])
                existing = connection.execute(f"SELECT user_id FROM {table} WHERE id = ?", (original_id,)).fetchone()
                if existing and existing["user_id"] != user["id"]:
                    row["id"] = new_id()
                id_maps[table][original_id] = str(row["id"])
                if table == "habit_entries" and str(row.get("habit_id", "")) in id_maps.get("habits", {}):
                    row["habit_id"] = id_maps["habits"][str(row["habit_id"])]
                row.setdefault("created_at", now_iso())
                row["user_id"] = user["id"]
                for key in JSON_FIELDS:
                    if key in row and not isinstance(row[key], str):
                        row[key] = json.dumps(row[key])
                for key in BOOLEAN_FIELDS:
                    if key in row:
                        row[key] = int(bool(row[key]))
                if not row:
                    continue
                columns = list(row)
                updates = ", ".join(f"{column} = excluded.{column}" for column in columns if column != "id")
                conflict_action = f"DO UPDATE SET {updates}" if updates else "DO NOTHING"
                connection.execute(
                    f"INSERT INTO {table} ({', '.join(columns)}) VALUES "
                    f"({', '.join('?' for _ in columns)}) ON CONFLICT(id) {conflict_action}",
                    tuple(row[column] for column in columns),
                )
                imported += 1
    return {"status": "ok", "mode": payload.mode, "records_imported": imported}


@app.post("/api/system/reset")
def reset_system(user: dict[str, Any] = Depends(require_user)) -> dict[str, str]:
    with transaction() as connection:
        for table in ["habit_entries", "reminders", "tasks", "events", "goals", "habits", "routine_blocks"]:
            connection.execute(f"DELETE FROM {table} WHERE user_id = ?", (user["id"],))
        connection.execute("DELETE FROM user_settings WHERE user_id = ?", (user["id"],))
        seed_database(connection, user["id"], user["username"])
    return {"status": "ok", "message": "Sample planner data restored"}
