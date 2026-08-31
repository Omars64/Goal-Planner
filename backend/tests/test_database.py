from __future__ import annotations

from typing import Any

from app.database import DatabaseConnection, database_path, database_url


class FakeCursor:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    def __enter__(self) -> FakeCursor:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def executemany(self, query: str, parameters: list[tuple[Any, ...]]) -> str:
        self.calls.append((query, parameters))
        return "many"


class FakeConnection:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.cursor_instance = FakeCursor()
        self.committed = False
        self.rolled_back = False
        self.closed = False

    def execute(self, query: str, parameters: tuple[Any, ...] = ()) -> str:
        self.calls.append((query, parameters))
        return "one"

    def cursor(self) -> FakeCursor:
        return self.cursor_instance

    def commit(self) -> None:
        self.committed = True

    def rollback(self) -> None:
        self.rolled_back = True

    def close(self) -> None:
        self.closed = True


def test_database_url_prefers_standard_variable(monkeypatch) -> None:
    monkeypatch.setenv("POSTGRES_URL", "postgresql://fallback")
    monkeypatch.setenv("DATABASE_URL", "postgresql://primary")
    assert database_url() == "postgresql://primary"


def test_database_path_uses_writable_serverless_storage(monkeypatch) -> None:
    monkeypatch.delenv("VICE_PLANNER_DB_PATH", raising=False)
    monkeypatch.setenv("VERCEL", "1")
    assert database_path().as_posix() == "/tmp/goal_planner.db"


def test_postgres_connection_adapts_queries_and_scripts() -> None:
    raw = FakeConnection()
    connection = DatabaseConnection(raw, "postgres")

    assert connection.execute("SELECT * FROM tasks WHERE id = ?", ("task-1",)) == "one"
    assert raw.calls[0] == ("SELECT * FROM tasks WHERE id = %s", ("task-1",))
    assert connection.executemany("INSERT INTO settings VALUES (?, ?)", [("theme", "dark")]) == "many"
    assert raw.cursor_instance.calls[0] == (
        "INSERT INTO settings VALUES (%s, %s)",
        [("theme", "dark")],
    )

    connection.executescript("CREATE TABLE one (id TEXT); CREATE TABLE two (id TEXT);")
    assert [call[0].strip() for call in raw.calls[1:]] == [
        "CREATE TABLE one (id TEXT)",
        "CREATE TABLE two (id TEXT)",
    ]

    connection.commit()
    connection.rollback()
    connection.close()
    assert raw.committed and raw.rolled_back and raw.closed
