from __future__ import annotations

import html
import json
import os
import smtplib
import ssl
from email.message import EmailMessage
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BREVO_EMAIL_ENDPOINT = "https://api.brevo.com/v3/smtp/email"


def _required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required to send verification emails")
    return value


def _email_provider() -> str:
    configured = os.getenv("EMAIL_PROVIDER", "auto").strip().lower()
    if configured == "auto":
        return "brevo" if os.getenv("BREVO_API_KEY", "").strip() else "smtp"
    if configured not in {"brevo", "smtp"}:
        raise RuntimeError("EMAIL_PROVIDER must be 'brevo', 'smtp', or 'auto'")
    return configured


def _send_with_brevo(
    recipient: str,
    username: str,
    subject: str,
    plain_content: str,
    html_content: str,
) -> None:
    api_key = _required("BREVO_API_KEY")
    from_email = os.getenv("BREVO_FROM_EMAIL", os.getenv("SMTP_FROM_EMAIL", "")).strip()
    if not from_email:
        raise RuntimeError("BREVO_FROM_EMAIL is required to send verification emails")
    from_name = os.getenv("BREVO_FROM_NAME", os.getenv("SMTP_FROM_NAME", "Goal Planner")).strip()
    payload = json.dumps(
        {
            "sender": {"name": from_name, "email": from_email},
            "to": [{"email": recipient, "name": username}],
            "subject": subject,
            "textContent": plain_content,
            "htmlContent": html_content,
            "tags": ["signup-verification"],
        }
    ).encode("utf-8")
    request = Request(
        BREVO_EMAIL_ENDPOINT,
        data=payload,
        headers={"Accept": "application/json", "Content-Type": "application/json", "api-key": api_key},
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            if response.status != 201:
                raise RuntimeError(f"Brevo returned unexpected status {response.status}")
    except HTTPError as exc:
        raise RuntimeError(f"Brevo rejected the verification email with status {exc.code}") from exc
    except URLError as exc:
        raise RuntimeError("Brevo could not be reached") from exc


def send_verification_email(recipient: str, username: str, code: str, expires_minutes: int) -> None:
    if os.getenv("SMTP_SUPPRESS_SEND", "").lower() in {"1", "true", "yes"}:
        return

    safe_name = html.escape(username)
    safe_code = html.escape(code)
    subject = f"{code} is your Goal Planner verification code"
    plain_content = (
        f"Hello {username},\n\nYour Goal Planner verification code is {code}. "
        f"It expires in {expires_minutes} minutes.\n\nIf you did not request this account, you can ignore this email."
    )
    html_content = f"""
        <!doctype html>
        <html lang="en">
          <body style="margin:0;background:#080713;color:#f8f7ff;font-family:Arial,Helvetica,sans-serif;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#080713;padding:32px 12px;">
              <tr><td align="center">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;border:1px solid #302c49;background:#121121;">
                  <tr><td style="height:5px;background:#f254a8;"></td></tr>
                  <tr><td style="padding:34px 34px 14px;">
                    <div style="font-size:13px;font-weight:800;letter-spacing:2px;color:#f254a8;text-transform:uppercase;">Goal Planner</div>
                    <h1 style="margin:14px 0 8px;font-size:30px;line-height:1.15;color:#ffffff;">Confirm your email</h1>
                    <p style="margin:0;color:#aaa6c2;font-size:16px;line-height:1.6;">Hello {safe_name}, use this one-time code to finish creating your account.</p>
                  </td></tr>
                  <tr><td style="padding:14px 34px;">
                    <div style="padding:22px;text-align:center;border:1px solid #5a3158;background:#1b1425;color:#ffffff;font-size:38px;font-weight:800;letter-spacing:12px;">{safe_code}</div>
                  </td></tr>
                  <tr><td style="padding:12px 34px 34px;">
                    <p style="margin:0 0 8px;color:#d2cde0;font-size:14px;line-height:1.55;">This code expires in {expires_minutes} minutes and can only be used once.</p>
                    <p style="margin:0;color:#777188;font-size:13px;line-height:1.55;">If you did not request a Goal Planner account, no action is needed.</p>
                  </td></tr>
                </table>
              </td></tr>
            </table>
          </body>
        </html>
        """

    if _email_provider() == "brevo":
        _send_with_brevo(recipient, username, subject, plain_content, html_content)
        return

    host = os.getenv("SMTP_HOST", "smtp.gmail.com").strip()
    port = int(os.getenv("SMTP_PORT", "465"))
    smtp_username = _required("SMTP_USERNAME")
    smtp_password = _required("SMTP_PASSWORD").replace(" ", "")
    from_email = os.getenv("SMTP_FROM_EMAIL", smtp_username).strip()
    from_name = os.getenv("SMTP_FROM_NAME", "Goal Planner").strip()
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = f"{from_name} <{from_email}>"
    message["To"] = recipient
    message.set_content(plain_content)
    message.add_alternative(html_content, subtype="html")

    context = ssl.create_default_context()
    if port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=20, context=context) as server:
            server.login(smtp_username, smtp_password)
            server.send_message(message)
        return

    with smtplib.SMTP(host, port, timeout=20) as server:
        server.ehlo()
        server.starttls(context=context)
        server.ehlo()
        server.login(smtp_username, smtp_password)
        server.send_message(message)
