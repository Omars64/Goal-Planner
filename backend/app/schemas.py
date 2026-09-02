from __future__ import annotations

import base64
import binascii
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Priority = Literal["low", "medium", "high", "urgent"]
TaskStatus = str
GoalStatus = Literal["active", "completed", "paused", "archived"]
Recurrence = Literal["none", "daily", "weekdays", "weekly", "monthly"]
UserRole = Literal["admin", "user"]
ALLOWED_IMAGE_PREFIXES = ("data:image/jpeg;base64,", "data:image/png;base64,", "data:image/webp;base64,")


def normalized_email(value: str) -> str:
    normalized = value.strip().lower()
    if len(normalized) > 254 or "@" not in normalized:
        raise ValueError("Enter a valid email address")
    local, domain = normalized.rsplit("@", 1)
    if not local or "." not in domain or domain.startswith(".") or domain.endswith("."):
        raise ValueError("Enter a valid email address")
    return normalized


def normalized_username(value: str) -> str:
    normalized = " ".join(value.strip().split())
    if len(normalized) < 2:
        raise ValueError("Username must be at least 2 characters")
    return normalized


def validated_image_data_url(value: str | None, maximum_bytes: int) -> str | None:
    if value is None:
        return None
    prefix = next((item for item in ALLOWED_IMAGE_PREFIXES if value.startswith(item)), None)
    if not prefix:
        raise ValueError("Upload a JPEG, PNG, or WebP image")
    try:
        decoded = base64.b64decode(value[len(prefix) :], validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("The image data is invalid") from exc
    if len(decoded) > maximum_bytes:
        raise ValueError("The processed image is too large")
    return value


class PatchModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SignupRequest(PatchModel):
    username: str = Field(min_length=2, max_length=80)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=128)

    _username = field_validator("username")(normalized_username)
    _email = field_validator("email")(normalized_email)


class LoginRequest(PatchModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)

    _email = field_validator("email")(normalized_email)


class VerifyEmailRequest(PatchModel):
    email: str = Field(min_length=3, max_length=254)
    code: str = Field(pattern=r"^\d{6}$")

    _email = field_validator("email")(normalized_email)


class ResendVerificationRequest(PatchModel):
    email: str = Field(min_length=3, max_length=254)

    _email = field_validator("email")(normalized_email)


class ChangePasswordRequest(PatchModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class AdminUserCreate(PatchModel):
    username: str = Field(min_length=2, max_length=80)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=128)
    role: UserRole = "user"

    _username = field_validator("username")(normalized_username)
    _email = field_validator("email")(normalized_email)


class AdminUserUpdate(PatchModel):
    username: str | None = Field(default=None, min_length=2, max_length=80)
    email: str | None = Field(default=None, min_length=3, max_length=254)
    role: UserRole | None = None
    is_active: bool | None = None

    _username = field_validator("username")(lambda value: normalized_username(value) if value is not None else value)
    _email = field_validator("email")(lambda value: normalized_email(value) if value is not None else value)


class AdminPasswordReset(PatchModel):
    new_password: str = Field(min_length=8, max_length=128)


class TaskCreate(PatchModel):
    title: str = Field(min_length=1, max_length=180)
    notes: str = Field(default="", max_length=4000)
    status: TaskStatus = Field(default="todo", min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    priority: Priority = "medium"
    category: str = Field(default="personal", max_length=60)
    due_date: str | None = None
    scheduled_date: str | None = None
    estimate_minutes: int = Field(default=30, ge=0, le=1440)
    tags: list[str] = Field(default_factory=list, max_length=20)
    recurring_rule: Recurrence = "none"


class TaskUpdate(PatchModel):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    notes: str | None = Field(default=None, max_length=4000)
    status: TaskStatus | None = Field(default=None, min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    priority: Priority | None = None
    category: str | None = Field(default=None, max_length=60)
    due_date: str | None = None
    scheduled_date: str | None = None
    estimate_minutes: int | None = Field(default=None, ge=0, le=1440)
    tags: list[str] | None = Field(default=None, max_length=20)
    recurring_rule: Recurrence | None = None


class TaskPhaseCreate(PatchModel):
    name: str = Field(min_length=1, max_length=40)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = " ".join(value.strip().split())
        if not normalized:
            raise ValueError("Phase name is required")
        return normalized


class TaskPhaseUpdate(TaskPhaseCreate):
    pass


class RoutineBlockCreate(PatchModel):
    title: str = Field(min_length=1, max_length=180)
    days: list[str] = Field(min_length=1)
    start_time: str
    end_time: str
    category: str = Field(default="work", max_length=60)
    color: str = "#8b5cf6"
    notes: str = Field(default="", max_length=2000)
    is_movement: bool = False
    is_active: bool = True

    @model_validator(mode="after")
    def validate_time_order(self) -> RoutineBlockCreate:
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be later than start_time")
        return self


class RoutineBlockUpdate(PatchModel):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    days: list[str] | None = None
    start_time: str | None = None
    end_time: str | None = None
    category: str | None = Field(default=None, max_length=60)
    color: str | None = None
    notes: str | None = Field(default=None, max_length=2000)
    is_movement: bool | None = None
    is_active: bool | None = None


class EventCreate(PatchModel):
    title: str = Field(min_length=1, max_length=180)
    description: str = Field(default="", max_length=4000)
    event_date: str
    start_time: str
    end_time: str
    category: str = Field(default="personal", max_length=60)
    color: str = "#ec4899"
    location: str = Field(default="", max_length=180)
    recurring_rule: Recurrence = "none"
    completed: bool = False

    @model_validator(mode="after")
    def validate_time_order(self) -> EventCreate:
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be later than start_time")
        return self


class EventUpdate(PatchModel):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=4000)
    event_date: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    category: str | None = Field(default=None, max_length=60)
    color: str | None = None
    location: str | None = Field(default=None, max_length=180)
    recurring_rule: Recurrence | None = None
    completed: bool | None = None


class GoalCreate(PatchModel):
    title: str = Field(min_length=1, max_length=180)
    description: str = Field(default="", max_length=4000)
    target_value: float = Field(default=1, gt=0)
    current_value: float = Field(default=0, ge=0)
    unit: str = Field(default="times", max_length=60)
    deadline: str | None = None
    status: GoalStatus = "active"
    color: str = "#06b6d4"


class GoalUpdate(PatchModel):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=4000)
    target_value: float | None = Field(default=None, gt=0)
    current_value: float | None = Field(default=None, ge=0)
    unit: str | None = Field(default=None, max_length=60)
    deadline: str | None = None
    status: GoalStatus | None = None
    color: str | None = None


class HabitCreate(PatchModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)
    icon: str = Field(default="sparkles", max_length=60)
    color: str = "#f97316"
    target_days: list[str] = Field(default_factory=list)


class HabitUpdate(PatchModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    icon: str | None = Field(default=None, max_length=60)
    color: str | None = None
    target_days: list[str] | None = None


class HabitCheckIn(PatchModel):
    entry_date: str
    completed: bool = True
    value: float = Field(default=1, ge=0)
    note: str = Field(default="", max_length=500)


class ReminderCreate(PatchModel):
    title: str = Field(min_length=1, max_length=180)
    body: str = Field(default="", max_length=1000)
    remind_at: str
    recurrence: Recurrence = "none"
    enabled: bool = True
    channel: Literal["browser", "in_app"] = "browser"
    related_type: str | None = None
    related_id: str | None = None


class ReminderUpdate(PatchModel):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    body: str | None = Field(default=None, max_length=1000)
    remind_at: str | None = None
    recurrence: Recurrence | None = None
    enabled: bool | None = None
    channel: Literal["browser", "in_app"] | None = None
    related_type: str | None = None
    related_id: str | None = None


class SettingsUpdate(PatchModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    timezone: str | None = None
    week_start: Literal["sunday", "monday"] | None = None
    daily_step_goal: int | None = Field(default=None, ge=1000, le=100000)
    work_start: str | None = None
    work_end: str | None = None
    work_days: list[str] | None = None
    compact_mode: bool | None = None
    notifications_enabled: bool | None = None
    profile_image: str | None = Field(default=None, max_length=700_000)
    background_image: str | None = Field(default=None, max_length=2_400_000)

    @field_validator("profile_image")
    @classmethod
    def validate_profile_image(cls, value: str | None) -> str | None:
        return validated_image_data_url(value, 500_000)

    @field_validator("background_image")
    @classmethod
    def validate_background_image(cls, value: str | None) -> str | None:
        return validated_image_data_url(value, 1_750_000)


class FeedbackCreate(PatchModel):
    name: str = Field(min_length=2, max_length=80)
    email: str = Field(min_length=3, max_length=254)
    message: str = Field(min_length=3, max_length=5000)
    image: str | None = Field(default=None, max_length=1_400_000)

    _name = field_validator("name")(normalized_username)
    _email = field_validator("email")(normalized_email)

    @field_validator("image")
    @classmethod
    def validate_image(cls, value: str | None) -> str | None:
        return validated_image_data_url(value, 1_000_000)


class ImportRequest(PatchModel):
    mode: Literal["merge", "replace"] = "merge"
    data: dict[str, Any]
