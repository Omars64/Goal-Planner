from __future__ import annotations

import html
import os
import smtplib
import ssl
from email.message import EmailMessage


def _required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required to send verification emails")
    return value


def send_verification_email(recipient: str, username: str, code: str, expires_minutes: int) -> None:
    if os.getenv("SMTP_SUPPRESS_SEND", "").lower() in {"1", "true", "yes"}:
        return

    host = os.getenv("SMTP_HOST", "smtp.gmail.com").strip()
    port = int(os.getenv("SMTP_PORT", "465"))
    smtp_username = _required("SMTP_USERNAME")
    smtp_password = _required("SMTP_PASSWORD").replace(" ", "")
    from_email = os.getenv("SMTP_FROM_EMAIL", smtp_username).strip()
    from_name = os.getenv("SMTP_FROM_NAME", "Goal Planner").strip()

    safe_name = html.escape(username)
    safe_code = html.escape(code)
    message = EmailMessage()
    message["Subject"] = f"{code} is your Goal Planner verification code"
    message["From"] = f"{from_name} <{from_email}>"
    message["To"] = recipient
    message.set_content(
        f"Hello {username},\n\nYour Goal Planner verification code is {code}. "
        f"It expires in {expires_minutes} minutes.\n\nIf you did not request this account, you can ignore this email."
    )
    message.add_alternative(
        f"""
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
        """,
        subtype="html",
    )

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
