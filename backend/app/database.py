from __future__ import annotations

import json
import os
import sqlite3
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from .security import hash_password

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # Local SQLite development does not require the Postgres driver.
    psycopg = None
    dict_row = None

DEFAULT_DB_PATH = Path(__file__).resolve().parents[1] / "data" / "vice_planner.db"
SERVERLESS_DB_PATH = Path("/tmp/goal_planner.db")


def database_path() -> Path:
    configured = os.getenv("VICE_PLANNER_DB_PATH")
    if configured:
        return Path(configured).expanduser().resolve()
    return SERVERLESS_DB_PATH if os.getenv("VERCEL") else DEFAULT_DB_PATH


def database_url() -> str | None:
    return os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL")


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


class DatabaseConnection:
    def __init__(self, raw_connection: Any, dialect: str) -> None:
        self.raw_connection = raw_connection
        self.dialect = dialect

    @property
    def is_postgres(self) -> bool:
        return self.dialect == "postgres"

    def _adapt_query(self, query: str) -> str:
        return query.replace("?", "%s") if self.is_postgres else query

    def execute(self, query: str, parameters: tuple[Any, ...] = ()) -> Any:
        return self.raw_connection.execute(self._adapt_query(query), parameters)

    def executemany(self, query: str, parameters: list[tuple[Any, ...]]) -> Any:
        if not self.is_postgres:
            return self.raw_connection.executemany(query, parameters)
        with self.raw_connection.cursor() as cursor:
            return cursor.executemany(self._adapt_query(query), parameters)

    def executescript(self, script: str) -> None:
        if not self.is_postgres:
            self.raw_connection.executescript(script)
            return
        for statement in script.split(";"):
            if statement.strip():
                self.raw_connection.execute(statement)

    def commit(self) -> None:
        self.raw_connection.commit()

    def rollback(self) -> None:
        self.raw_connection.rollback()

    def close(self) -> None:
        self.raw_connection.close()

    def __enter__(self) -> DatabaseConnection:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


def connect() -> DatabaseConnection:
    url = database_url()
    if url:
        if psycopg is None or dict_row is None:
            raise RuntimeError("DATABASE_URL is set, but psycopg is not installed")
        connection = psycopg.connect(url, row_factory=dict_row, connect_timeout=10)
        return DatabaseConnection(connection, "postgres")

    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=30, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    return DatabaseConnection(connection, "sqlite")


@contextmanager
def transaction() -> Iterator[DatabaseConnection]:
    connection = connect()
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    is_active INTEGER NOT NULL DEFAULT 0,
    email_verified_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS email_verification_codes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    code_salt TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    consumed_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY(user_id, key),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS routine_blocks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    days TEXT NOT NULL DEFAULT '[]',
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'work',
    color TEXT NOT NULL DEFAULT '#8b5cf6',
    notes TEXT NOT NULL DEFAULT '',
    is_movement INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo',
    priority TEXT NOT NULL DEFAULT 'medium',
    category TEXT NOT NULL DEFAULT 'personal',
    due_date TEXT,
    scheduled_date TEXT,
    estimate_minutes INTEGER NOT NULL DEFAULT 30,
    tags TEXT NOT NULL DEFAULT '[]',
    recurring_rule TEXT NOT NULL DEFAULT 'none',
    created_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    event_date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'personal',
    color TEXT NOT NULL DEFAULT '#ec4899',
    location TEXT NOT NULL DEFAULT '',
    recurring_rule TEXT NOT NULL DEFAULT 'none',
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    target_value REAL NOT NULL DEFAULT 1,
    current_value REAL NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'times',
    deadline TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    color TEXT NOT NULL DEFAULT '#06b6d4',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS habits (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT 'sparkles',
    color TEXT NOT NULL DEFAULT '#f97316',
    target_days TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS habit_entries (
    id TEXT PRIMARY KEY,
    habit_id TEXT NOT NULL,
    entry_date TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 1,
    value REAL NOT NULL DEFAULT 1,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE(habit_id, entry_date),
    FOREIGN KEY(habit_id) REFERENCES habits(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    remind_at TEXT NOT NULL,
    recurrence TEXT NOT NULL DEFAULT 'none',
    enabled INTEGER NOT NULL DEFAULT 1,
    channel TEXT NOT NULL DEFAULT 'browser',
    related_type TEXT,
    related_id TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_dates ON tasks(scheduled_date, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_habit_entries_date ON habit_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_reminders_time ON reminders(remind_at, enabled);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token_hash, expires_at);
CREATE INDEX IF NOT EXISTS idx_verification_codes_user ON email_verification_codes(user_id, created_at);
"""

OWNED_TABLES = ["routine_blocks", "tasks", "events", "goals", "habits", "habit_entries", "reminders"]


def column_exists(connection: DatabaseConnection, table: str, column: str) -> bool:
    if connection.is_postgres:
        row = connection.execute(
            "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ? AND column_name = ?",
            (table, column),
        ).fetchone()
        return row is not None
    return any(row["name"] == column for row in connection.execute(f"PRAGMA table_info({table})").fetchall())


def bootstrap_admin(connection: DatabaseConnection) -> dict[str, Any]:
    email = os.getenv("GOAL_PLANNER_ADMIN_EMAIL", "").strip().lower()
    password = os.getenv("GOAL_PLANNER_ADMIN_PASSWORD", "")
    username = os.getenv("GOAL_PLANNER_ADMIN_USERNAME", "Admin").strip() or "Admin"
    if not email or not password:
        raise RuntimeError("GOAL_PLANNER_ADMIN_EMAIL and GOAL_PLANNER_ADMIN_PASSWORD are required")
    if len(password) < 8:
        raise RuntimeError("GOAL_PLANNER_ADMIN_PASSWORD must be at least 8 characters")

    existing = connection.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if existing:
        return dict(existing)

    created = now_iso()
    admin_id = new_id()
    connection.execute(
        """
        INSERT INTO users(
            id, username, email, password_hash, role, is_active, email_verified_at,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'admin', 1, ?, ?, ?)
        """,
        (admin_id, username, email, hash_password(password), created, created, created),
    )
    return dict(connection.execute("SELECT * FROM users WHERE id = ?", (admin_id,)).fetchone())


def migrate_user_ownership(connection: DatabaseConnection, admin_id: str) -> None:
    for table in OWNED_TABLES:
        if not column_exists(connection, table, "user_id"):
            connection.execute(f"ALTER TABLE {table} ADD COLUMN user_id TEXT")
    connection.execute(
        """
        UPDATE habit_entries
        SET user_id = (SELECT habits.user_id FROM habits WHERE habits.id = habit_entries.habit_id)
        WHERE user_id IS NULL OR user_id = ''
        """
    )
    for table in OWNED_TABLES:
        connection.execute(f"UPDATE {table} SET user_id = ? WHERE user_id IS NULL OR user_id = ''", (admin_id,))
        connection.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_user ON {table}(user_id)")

    migrated = connection.execute(
        "SELECT COUNT(*) AS count FROM user_settings WHERE user_id = ?", (admin_id,)
    ).fetchone()
    if migrated["count"] == 0:
        legacy = connection.execute("SELECT key, value FROM settings").fetchall()
        if legacy:
            connection.executemany(
                "INSERT INTO user_settings(user_id, key, value) VALUES (?, ?, ?)",
                [(admin_id, row["key"], row["value"]) for row in legacy],
            )


def init_db() -> None:
    with transaction() as connection:
        if connection.is_postgres:
            connection.execute("SELECT pg_advisory_xact_lock(20260831)")
        connection.executescript(SCHEMA)
        admin = bootstrap_admin(connection)
        migrate_user_ownership(connection, admin["id"])
        row = connection.execute(
            "SELECT COUNT(*) AS count FROM routine_blocks WHERE user_id = ?", (admin["id"],)
        ).fetchone()
        if row["count"] == 0:
            seed_database(connection, admin["id"], admin["username"])


def seed_database(connection: DatabaseConnection, user_id: str, display_name: str = "User") -> None:
    today = date.today()
    created = now_iso()
    settings: dict[str, Any] = {
        "display_name": display_name,
        "timezone": "Asia/Kuwait",
        "week_start": "sunday",
        "daily_step_goal": 10000,
        "work_start": "08:00",
        "work_end": "17:00",
        "work_days": ["sunday", "monday", "tuesday", "wednesday", "thursday"],
        "compact_mode": False,
        "notifications_enabled": False,
    }
    connection.executemany(
        "INSERT INTO user_settings(user_id, key, value) VALUES (?, ?, ?)",
        [(user_id, key, json.dumps(value)) for key, value in settings.items()],
    )

    weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday"]
    routine = [
        (
            "Focused work",
            "08:00",
            "08:50",
            "work",
            "#8b5cf6",
            False,
            "Start with the day's most important engineering task.",
        ),
        (
            "Movement reset",
            "08:50",
            "08:53",
            "movement",
            "#22c55e",
            True,
            "Walk, shoulder-blade squeezes and gentle knee extensions.",
        ),
        ("Development block", "08:53", "09:50", "work", "#8b5cf6", False, "Coding, review or testing."),
        ("Corridor walk", "09:50", "09:54", "movement", "#22c55e", True, "Comfortable four-minute walk."),
        ("Development block", "09:54", "10:50", "work", "#8b5cf6", False, "Focused engineering work."),
        ("Desk mobility", "10:50", "10:53", "movement", "#22c55e", True, "Stand, move and reset posture."),
        ("Development block", "10:53", "11:50", "work", "#8b5cf6", False, "Finish the current work unit."),
        ("Dhuhr prayer", "11:50", "12:25", "prayer", "#06b6d4", True, "Walk to and from the prayer area."),
        ("Work block", "12:25", "13:00", "work", "#8b5cf6", False, "Light tasks before the official break."),
        ("Lunch", "13:00", "13:20", "break", "#f97316", False, "Eat without rushing."),
        (
            "After-lunch walk",
            "13:20",
            "13:35",
            "movement",
            "#22c55e",
            True,
            "Easy 10–15 minute walk; shorten if ankle or heel is sore.",
        ),
        ("Recover & hydrate", "13:35", "13:50", "break", "#f97316", False, "Sit, rest and hydrate."),
        ("Prepare to resume", "13:50", "14:00", "planning", "#ec4899", False, "Review the afternoon priorities."),
        ("Focused work", "14:00", "14:50", "work", "#8b5cf6", False, "Second deep-work window."),
        ("Movement reset", "14:50", "14:53", "movement", "#22c55e", True, "Three minutes of easy movement."),
        ("Work block", "14:53", "15:35", "work", "#8b5cf6", False, "Complete the next defined task."),
        ("Asr prayer", "15:35", "16:10", "prayer", "#06b6d4", True, "Walk to and from the prayer area."),
        ("Final work block", "16:10", "16:50", "work", "#8b5cf6", False, "Close priority work and document progress."),
        ("Final movement break", "16:50", "16:53", "movement", "#22c55e", True, "Stand and gently loosen up."),
        (
            "Daily shutdown",
            "16:53",
            "17:00",
            "planning",
            "#ec4899",
            False,
            "Record progress and choose tomorrow's first task.",
        ),
    ]
    connection.executemany(
        """
        INSERT INTO routine_blocks(
            id, user_id, title, days, start_time, end_time, category, color, notes,
            is_movement, is_active, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        """,
        [
            (
                new_id(),
                user_id,
                title,
                json.dumps(weekdays),
                start,
                end,
                category,
                color,
                notes,
                int(is_movement),
                created,
            )
            for title, start, end, category, color, is_movement, notes in routine
        ],
    )

    habits = [
        ("10,000 steps", "Build gradually rather than forcing the target immediately.", "footprints", "#22c55e"),
        ("30-minute walk", "A comfortable, flat-surface walk.", "route", "#06b6d4"),
        ("Work movement breaks", "Complete the short movement resets during the workday.", "timer-reset", "#f97316"),
        ("Plan tomorrow", "Choose tomorrow's first task before finishing the day.", "notebook-pen", "#ec4899"),
    ]
    connection.executemany(
        "INSERT INTO habits(id, user_id, name, description, icon, color, target_days, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (new_id(), user_id, name, description, icon, color, json.dumps(weekdays), created)
            for name, description, icon, color in habits
        ],
    )

    connection.execute(
        """
        INSERT INTO goals(id, user_id, title, description, target_value, current_value, unit, deadline, status, color, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
        """,
        (
            new_id(),
            user_id,
            "Consistent movement week",
            "Complete intentional movement on every workday.",
            5,
            0,
            "workdays",
            (today + timedelta(days=30)).isoformat(),
            "#22c55e",
            created,
        ),
    )
    connection.execute(
        """
        INSERT INTO tasks(id, user_id, title, notes, status, priority, category, due_date, scheduled_date,
                          estimate_minutes, tags, recurring_rule, created_at)
        VALUES (?, ?, ?, ?, 'todo', 'high', 'planning', ?, ?, 10, ?, 'weekdays', ?)
        """,
        (
            new_id(),
            user_id,
            "Choose today's top three priorities",
            "Keep the list realistic for an 8:00–5:00 engineering workday.",
            today.isoformat(),
            today.isoformat(),
            json.dumps(["daily-plan"]),
            created,
        ),
    )
    reminder_time = datetime.combine(today + timedelta(days=1), datetime.min.time()).replace(hour=8, minute=50)
    connection.execute(
        """
        INSERT INTO reminders(id, user_id, title, body, remind_at, recurrence, enabled, channel, created_at)
        VALUES (?, ?, ?, ?, ?, 'weekdays', 1, 'browser', ?)
        """,
        (
            new_id(),
            user_id,
            "Movement reset",
            "Stand up, walk briefly and reset your posture.",
            reminder_time.isoformat(timespec="minutes"),
            created,
        ),
    )


def row_to_dict(row: Any | None) -> dict[str, Any] | None:
    if row is None:
        return None
    data = dict(row)
    for key in ("days", "tags", "target_days"):
        if key in data:
            try:
                data[key] = json.loads(data[key] or "[]")
            except json.JSONDecodeError:
                data[key] = []
    for key in ("is_movement", "is_active", "completed", "enabled"):
        if key in data:
            data[key] = bool(data[key])
    return data


def all_rows(connection: DatabaseConnection, query: str, parameters: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    return [row_to_dict(row) or {} for row in connection.execute(query, parameters).fetchall()]


def settings_dict(connection: DatabaseConnection, user_id: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for row in connection.execute(
        "SELECT key, value FROM user_settings WHERE user_id = ? ORDER BY key", (user_id,)
    ).fetchall():
        try:
            result[row["key"]] = json.loads(row["value"])
        except json.JSONDecodeError:
            result[row["key"]] = row["value"]
    return result
