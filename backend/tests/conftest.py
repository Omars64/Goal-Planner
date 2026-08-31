from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path: Path):
    os.environ.pop("DATABASE_URL", None)
    os.environ.pop("POSTGRES_URL", None)
    os.environ["VICE_PLANNER_DB_PATH"] = str(tmp_path / "test.db")
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client
