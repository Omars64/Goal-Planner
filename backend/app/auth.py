from __future__ import annotations

import hmac
import json
import os
import smtplib
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from .database import OWNED_TABLES, connect, new_id, now_iso, seed_user_settings, transaction
from .email_service import send_verification_email
from .schemas import (
    AdminPasswordReset,
    AdminUserCreate,
    AdminUserUpdate,
    ChangePasswordRequest,
    LoginRequest,
    ResendVerificationRequest,
    SignupRequest,
    VerifyEmailRequest,
)
from .security import (
    generate_code_salt,
    generate_session_token,
    generate_verification_code,
    hash_password,
    hash_session_token,
    hash_verification_code,
    verify_password,
)

router = APIRouter(prefix="/api")

SESSION_COOKIE = "goal_planner_session"
SESSION_DAYS = 7
VERIFICATION_MINUTES = 10
VERIFICATION_MAX_ATTEMPTS = 5
VERIFICATION_RESEND_SECONDS = 60


def utc_after(**kwargs: int) -> str:
    return (datetime.now(UTC) + timedelta(**kwargs)).replace(microsecond=0).isoformat()


def user_public(row: dict[str, Any]) -> dict[str, Any]:
    profile_image = None
    if row.get("profile_image_value"):
        try:
            profile_image = json.loads(row["profile_image_value"])
        except (json.JSONDecodeError, TypeError):
            profile_image = None
    return {
        "id": row["id"],
        "username": row["username"],
        "email": row["email"],
        "role": row["role"],
        "is_active": bool(row["is_active"]),
        "email_verified": bool(row.get("email_verified_at")),
        "created_at": row["created_at"],
        "last_login_at": row.get("last_login_at"),
        "profile_image": profile_image,
    }


def create_session(connection: Any, user_id: str) -> tuple[str, str]:
    token = generate_session_token()
    token_hash = hash_session_token(token)
    created = now_iso()
    session_id = new_id()
    connection.execute(
        """
        INSERT INTO user_sessions(id, user_id, token_hash, expires_at, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (session_id, user_id, token_hash, utc_after(days=SESSION_DAYS), created, created),
    )
    return session_id, token


def set_session_cookie(response: Response, token: str) -> None:
    secure = bool(os.getenv("VERCEL")) or os.getenv("GOAL_PLANNER_SECURE_COOKIES", "").lower() in {
        "1",
        "true",
        "yes",
    }
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )


def require_user(request: Request) -> dict[str, Any]:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in to continue")
    with connect() as connection:
        row = connection.execute(
            """
            SELECT users.*, user_sessions.id AS session_id
            FROM user_sessions
            JOIN users ON users.id = user_sessions.user_id
            WHERE user_sessions.token_hash = ? AND user_sessions.expires_at > ? AND users.is_active = 1
            """,
            (hash_session_token(token), now_iso()),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Your session has expired. Sign in again")
    return dict(row)


def require_admin(user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    if user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access is required")
    return user


def issue_verification_code(connection: Any, user_id: str) -> str:
    code = generate_verification_code()
    salt = generate_code_salt()
    created = now_iso()
    connection.execute(
        "UPDATE email_verification_codes SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL",
        (created, user_id),
    )
    connection.execute(
        """
        INSERT INTO email_verification_codes(
            id, user_id, code_hash, code_salt, expires_at, attempts, created_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?)
        """,
        (
            new_id(),
            user_id,
            hash_verification_code(code, salt),
            salt,
            utc_after(minutes=VERIFICATION_MINUTES),
            created,
        ),
    )
    return code


def deliver_verification_code(email: str, username: str, code: str) -> None:
    try:
        send_verification_email(email, username, code, VERIFICATION_MINUTES)
    except (OSError, RuntimeError, smtplib.SMTPException) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The verification email could not be sent. Please try again shortly",
        ) from exc


@router.post("/auth/signup", status_code=201)
def signup(payload: SignupRequest) -> dict[str, Any]:
    code: str | None = None
    message = "Check your email for the six-digit verification code"
    with transaction() as connection:
        existing = connection.execute("SELECT * FROM users WHERE email = ?", (payload.email,)).fetchone()
        if existing:
            if existing["email_verified_at"] and not existing["is_active"]:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "This account was deactivated. Contact an administrator to reactivate it, "
                        "or sign up with a different email address"
                    ),
                )
            if existing["email_verified_at"]:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="An account with this email already exists. Sign in to continue",
                )

            updated = now_iso()
            connection.execute(
                "UPDATE users SET username = ?, password_hash = ?, updated_at = ? WHERE id = ?",
                (payload.username, hash_password(payload.password), updated, existing["id"]),
            )
            threshold = (
                (datetime.now(UTC) - timedelta(seconds=VERIFICATION_RESEND_SECONDS)).replace(microsecond=0).isoformat()
            )
            recent = connection.execute(
                """
                SELECT id FROM email_verification_codes
                WHERE user_id = ? AND consumed_at IS NULL AND created_at > ? AND expires_at > ?
                ORDER BY created_at DESC LIMIT 1
                """,
                (existing["id"], threshold, now_iso()),
            ).fetchone()
            if recent:
                message = "Enter the code already sent to your email, or resend it after one minute"
            else:
                code = issue_verification_code(connection, existing["id"])
        else:
            created = now_iso()
            user_id = new_id()
            connection.execute(
                """
                INSERT INTO users(
                    id, username, email, password_hash, role, is_active, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'user', 0, ?, ?)
                """,
                (user_id, payload.username, payload.email, hash_password(payload.password), created, created),
            )
            code = issue_verification_code(connection, user_id)
    if code:
        deliver_verification_code(payload.email, payload.username, code)
    return {
        "status": "verification_required",
        "email": payload.email,
        "expires_in": VERIFICATION_MINUTES * 60,
        "message": message,
    }


@router.post("/auth/verify")
def verify_email(payload: VerifyEmailRequest, response: Response) -> dict[str, Any]:
    with transaction() as connection:
        user_row = connection.execute("SELECT * FROM users WHERE email = ?", (payload.email,)).fetchone()
        if not user_row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No pending account was found")
        user = dict(user_row)
        if user.get("email_verified_at"):
            detail = (
                "This email is already verified. Sign in"
                if user["is_active"]
                else "This account was deactivated. Contact an administrator to reactivate it"
            )
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)
        code_row = connection.execute(
            """
            SELECT * FROM email_verification_codes
            WHERE user_id = ? AND consumed_at IS NULL
            ORDER BY created_at DESC LIMIT 1
            """,
            (user["id"],),
        ).fetchone()
        if not code_row or code_row["expires_at"] <= now_iso():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The code expired. Request a new one")
        if code_row["attempts"] >= VERIFICATION_MAX_ATTEMPTS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many attempts. Request a new code"
            )
        expected = hash_verification_code(payload.code, code_row["code_salt"])
        if not hmac.compare_digest(expected, code_row["code_hash"]):
            connection.execute(
                "UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = ?", (code_row["id"],)
            )
            remaining = max(0, VERIFICATION_MAX_ATTEMPTS - code_row["attempts"] - 1)
            connection.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"That code is not correct. {remaining} attempts remaining",
            )

        verified = now_iso()
        connection.execute(
            "UPDATE users SET is_active = 1, email_verified_at = ?, updated_at = ? WHERE id = ?",
            (verified, verified, user["id"]),
        )
        connection.execute(
            "UPDATE email_verification_codes SET consumed_at = ? WHERE id = ?", (verified, code_row["id"])
        )
        seed_user_settings(connection, user["id"], user["username"])
        _, token = create_session(connection, user["id"])
        updated = dict(connection.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone())
    set_session_cookie(response, token)
    return {
        "status": "verified",
        "message": "Email verified. Your empty planner is ready; start by adding your first priority",
        "user": user_public(updated),
    }


@router.post("/auth/resend-code")
def resend_code(payload: ResendVerificationRequest) -> dict[str, Any]:
    with transaction() as connection:
        row = connection.execute("SELECT * FROM users WHERE email = ?", (payload.email,)).fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No pending account was found")
        user = dict(row)
        if user.get("email_verified_at"):
            detail = (
                "This email is already verified. Sign in"
                if user["is_active"]
                else "This account was deactivated. Contact an administrator to reactivate it"
            )
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)
        threshold = (
            (datetime.now(UTC) - timedelta(seconds=VERIFICATION_RESEND_SECONDS)).replace(microsecond=0).isoformat()
        )
        recent = connection.execute(
            "SELECT id FROM email_verification_codes WHERE user_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1",
            (user["id"], threshold),
        ).fetchone()
        if recent:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Wait one minute before requesting another code",
            )
        code = issue_verification_code(connection, user["id"])
    deliver_verification_code(user["email"], user["username"], code)
    return {"status": "sent", "message": "A new verification code was sent"}


@router.post("/auth/login")
def login(payload: LoginRequest, response: Response) -> dict[str, Any]:
    with transaction() as connection:
        row = connection.execute("SELECT * FROM users WHERE email = ?", (payload.email,)).fetchone()
        if not row or not verify_password(payload.password, row["password_hash"]):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email or password is incorrect")
        user = dict(row)
        if not user.get("email_verified_at"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Verify your email before signing in")
        if not user["is_active"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This account was deactivated. Contact an administrator to restore access",
            )
        logged_in = now_iso()
        connection.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (logged_in, user["id"]))
        _, token = create_session(connection, user["id"])
        user["last_login_at"] = logged_in
    set_session_cookie(response, token)
    return {"status": "authenticated", "message": f"Welcome back, {user['username']}", "user": user_public(user)}


@router.post("/auth/logout")
def logout(response: Response, request: Request) -> dict[str, str]:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        with transaction() as connection:
            connection.execute("DELETE FROM user_sessions WHERE token_hash = ?", (hash_session_token(token),))
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"status": "ok", "message": "Signed out"}


@router.get("/auth/me")
def me(user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    return user_public(user)


@router.post("/auth/change-password")
def change_password(
    payload: ChangePasswordRequest,
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, str]:
    if not verify_password(payload.current_password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    if verify_password(payload.new_password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New password must be different")
    with transaction() as connection:
        connection.execute(
            "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
            (hash_password(payload.new_password), now_iso(), user["id"]),
        )
        connection.execute("DELETE FROM user_sessions WHERE user_id = ? AND id <> ?", (user["id"], user["session_id"]))
    return {"status": "ok", "message": "Password changed. Other sessions were signed out"}


@router.get("/admin/users")
def list_approved_users(_: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT users.*,
                   (SELECT value FROM user_settings
                    WHERE user_settings.user_id = users.id AND user_settings.key = 'profile_image')
                   AS profile_image_value
            FROM users
            WHERE email_verified_at IS NOT NULL
            ORDER BY CASE is_active WHEN 1 THEN 0 ELSE 1 END,
                     CASE role WHEN 'admin' THEN 0 ELSE 1 END,
                     created_at
            """
        ).fetchall()
    users = [user_public(dict(row)) for row in rows]
    return {
        "users": users,
        "total": len(users),
        "admins": sum(1 for item in users if item["role"] == "admin"),
        "regular_users": sum(1 for item in users if item["role"] == "user"),
        "active_users": sum(1 for item in users if item["is_active"]),
        "inactive_users": sum(1 for item in users if not item["is_active"]),
    }


@router.post("/admin/users", status_code=201)
def create_user(payload: AdminUserCreate, _: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    with transaction() as connection:
        if connection.execute("SELECT id FROM users WHERE email = ?", (payload.email,)).fetchone():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="An account with this email already exists"
            )
        created = now_iso()
        user_id = new_id()
        connection.execute(
            """
            INSERT INTO users(
                id, username, email, password_hash, role, is_active, email_verified_at,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
            """,
            (
                user_id,
                payload.username,
                payload.email,
                hash_password(payload.password),
                payload.role,
                created,
                created,
                created,
            ),
        )
        seed_user_settings(connection, user_id, payload.username)
        user = dict(connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())
    return {"message": "User created and approved", "user": user_public(user)}


@router.patch("/admin/users/{user_id}")
def update_user(
    user_id: str,
    payload: AdminUserUpdate,
    admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    updates = payload.model_dump(exclude_unset=True)
    with transaction() as connection:
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        current = dict(row)
        if user_id == admin["id"] and updates.get("is_active") is False:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot deactivate your own account"
            )
        if user_id == admin["id"] and updates.get("role") == "user":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot remove your own admin role")
        if updates.get("email") and updates["email"] != current["email"]:
            duplicate = connection.execute("SELECT id FROM users WHERE email = ?", (updates["email"],)).fetchone()
            if duplicate:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That email is already in use")
            updates["email_verified_at"] = now_iso()
        if "is_active" in updates:
            updates["is_active"] = int(updates["is_active"])
        if not updates:
            return {"message": "No changes were needed", "user": user_public(current)}
        updates["updated_at"] = now_iso()
        assignments = ", ".join(f"{key} = ?" for key in updates)
        connection.execute(f"UPDATE users SET {assignments} WHERE id = ?", (*updates.values(), user_id))
        if "role" in updates or "is_active" in updates or "email" in updates:
            connection.execute(
                "DELETE FROM user_sessions WHERE user_id = ? AND id <> ?", (user_id, admin["session_id"])
            )
        updated = dict(connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())
    return {"message": "User details updated", "user": user_public(updated)}


@router.put("/admin/users/{user_id}/password")
def reset_user_password(
    user_id: str,
    payload: AdminPasswordReset,
    admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    with transaction() as connection:
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        connection.execute(
            "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
            (hash_password(payload.new_password), now_iso(), user_id),
        )
        connection.execute("DELETE FROM user_sessions WHERE user_id = ? AND id <> ?", (user_id, admin["session_id"]))
        updated = dict(connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())
    return {"message": "Password reset. The user's other sessions were signed out", "user": user_public(updated)}


@router.delete("/admin/users/{user_id}")
def delete_user(
    user_id: str,
    admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, str]:
    if user_id == admin["id"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot delete your own account")
    with transaction() as connection:
        row = connection.execute("SELECT username FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        for table in reversed(OWNED_TABLES):
            connection.execute(f"DELETE FROM {table} WHERE user_id = ?", (user_id,))
        connection.execute("DELETE FROM user_settings WHERE user_id = ?", (user_id,))
        connection.execute("DELETE FROM users WHERE id = ?", (user_id,))
    return {"message": f"{row['username']} and all associated planner data were deleted", "deleted_user_id": user_id}
