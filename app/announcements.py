"""Announcement email delivery through Brevo.

Supabase Auth sends the authentication mail (confirm signup, reset password,
email change, magic links) through its own SMTP settings. This module is the
separate path for *application* announcements: it reads the eligible users from
Supabase with the service role, then sends one Brevo message per recipient so no
address is ever exposed to another recipient.

Everything secret stays on the server: BREVO_API_KEY is read from the
environment, never sent to the browser.
"""

from __future__ import annotations

import asyncio
import os
import secrets
from datetime import datetime, timezone
from html import escape
from typing import Iterable

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from supabase import create_client

load_dotenv()

router = APIRouter(prefix="/announcements", tags=["announcements"])

BREVO_API_URL = "https://api.brevo.com/v3/smtp/email"
PAGE_SIZE = 100
MAX_PAGES = 40


# ---------------------------------------------------------------- config


def _supabase():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise HTTPException(
            status_code=500,
            detail="Supabase is not configured on the server.",
        )
    return create_client(url, key)


def _sender() -> dict:
    email = os.getenv("BREVO_SENDER_EMAIL")
    name = os.getenv("BREVO_SENDER_NAME", "Vic Chatbot")
    if not email:
        raise HTTPException(
            status_code=500,
            detail="BREVO_SENDER_EMAIL is not configured on the server.",
        )
    return {"email": email, "name": name}


def _backend_url() -> str:
    return os.getenv("BACKEND_PUBLIC_URL", "").rstrip("/")


def _daily_limit() -> int:
    try:
        return max(1, int(os.getenv("BREVO_DAILY_LIMIT", "300")))
    except ValueError:
        return 300


# ---------------------------------------------------------------- auth


def _require_admin(authorization: str | None):
    """Return (supabase, user) for an admin bearer token, or raise."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="An access token is required.")

    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="An access token is required.")

    supabase = _supabase()
    try:
        response = supabase.auth.get_user(token)
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=401, detail="Invalid or expired token.") from error

    user = getattr(response, "user", None)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")

    role = (getattr(user, "app_metadata", None) or {}).get("role")
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin access is required.")

    return supabase, user


# ---------------------------------------------------------------- models


class Announcement(BaseModel):
    key: str = Field(min_length=3, max_length=120)
    subject: str = Field(min_length=3, max_length=200)
    html: str = Field(min_length=1)
    text: str | None = None
    dry_run: bool = False
    limit: int | None = Field(default=None, ge=1, le=1000)
    include_opted_out: bool = False


# ---------------------------------------------------------------- helpers


def _list_users(supabase) -> list:
    """Every auth user, a page at a time."""
    users: list = []
    for page in range(1, MAX_PAGES + 1):
        try:
            batch = supabase.auth.admin.list_users(page=page, per_page=PAGE_SIZE)
        except TypeError:  # older client signature
            batch = supabase.auth.admin.list_users()
        if not batch:
            break
        users.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
    return users


def _preferences(supabase) -> dict[str, dict]:
    try:
        rows = (
            supabase.table("email_preferences")
            .select("user_id,announcements,unsubscribe_token")
            .execute()
            .data
            or []
        )
    except Exception:  # noqa: BLE001 - table may not exist yet
        return {}
    return {row["user_id"]: row for row in rows}


def _already_sent(supabase, key: str) -> set[str]:
    try:
        rows = (
            supabase.table("announcement_log")
            .select("user_id,status")
            .eq("announcement_key", key)
            .eq("status", "sent")
            .execute()
            .data
            or []
        )
    except Exception:  # noqa: BLE001
        return set()
    return {row["user_id"] for row in rows if row.get("user_id")}


def _ensure_token(supabase, user_id: str, current: str | None) -> str:
    if current:
        return current
    token = secrets.token_urlsafe(32)
    try:
        supabase.table("email_preferences").upsert(
            {"user_id": user_id, "unsubscribe_token": token},
            on_conflict="user_id",
        ).execute()
    except Exception:  # noqa: BLE001 - keep sending even if the token write fails
        return ""
    return token


def _log(supabase, key: str, user_id: str | None, email: str, status: str, error: str | None = None):
    try:
        supabase.table("announcement_log").upsert(
            {
                "announcement_key": key,
                "user_id": user_id,
                "email": email,
                "status": status,
                "error": (error or "")[:500] or None,
            },
            on_conflict="announcement_key,user_id",
        ).execute()
    except Exception:  # noqa: BLE001
        pass


def _unsubscribe_url(token: str) -> str:
    base = _backend_url()
    if not token or not base:
        return ""
    return f"{base}/announcements/unsubscribe?token={token}"


def _html_with_footer(html: str, unsubscribe_url: str) -> str:
    if not unsubscribe_url:
        return html
    footer = (
        '<p style="margin:32px 0 0;font-size:12px;line-height:1.6;color:#7A7398;">'
        'You are receiving this because you have a Vic Chatbot account. '
        f'<a href="{escape(unsubscribe_url)}" style="color:#7C3AED;">'
        "Turn off announcement emails</a>."
        "</p>"
    )
    return html + footer


# ---------------------------------------------------------------- sending


async def _send_one(client: httpx.AsyncClient, api_key: str, payload: dict) -> tuple[bool, str | None]:
    try:
        response = await client.post(
            BREVO_API_URL,
            headers={
                "api-key": api_key,
                "content-type": "application/json",
                "accept": "application/json",
            },
            json=payload,
            timeout=30.0,
        )
    except httpx.HTTPError as error:
        return False, f"network error: {error}"

    if response.status_code >= 400:
        return False, f"brevo {response.status_code}: {response.text[:300]}"
    return True, None


@router.post("/send")
async def send_announcement(
    body: Announcement,
    authorization: str | None = Header(default=None),
):
    """Send one announcement to every eligible account, one email each."""
    supabase, _admin = _require_admin(authorization)

    api_key = os.getenv("BREVO_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="BREVO_API_KEY is not configured on the server.",
        )

    sender = _sender()
    preferences = _preferences(supabase)
    sent_before = _already_sent(supabase, body.key)
    daily_limit = _daily_limit()

    users = _list_users(supabase)

    recipients: list[dict] = []
    skipped = {"no_email": 0, "opted_out": 0, "already_sent": 0, "unconfirmed": 0}

    for user in users:
        user_id = str(getattr(user, "id", "") or "")
        email = (getattr(user, "email", "") or "").strip()
        if not user_id or not email:
            skipped["no_email"] += 1
            continue
        if user_id in sent_before:
            skipped["already_sent"] += 1
            continue
        if not getattr(user, "email_confirmed_at", None) and not body.dry_run:
            # Unconfirmed addresses bounce; skip them and let them confirm.
            skipped["unconfirmed"] += 1
            continue
        pref = preferences.get(user_id, {})
        if not body.include_opted_out and pref.get("announcements") is False:
            skipped["opted_out"] += 1
            continue
        recipients.append(
            {
                "user_id": user_id,
                "email": email,
                "name": (getattr(user, "user_metadata", None) or {}).get("full_name") or "",
                "token": pref.get("unsubscribe_token"),
            }
        )

    recipients = recipients[: daily_limit if body.limit is None else min(body.limit, daily_limit)]

    if body.dry_run:
        return {
            "dry_run": True,
            "key": body.key,
            "would_send": len(recipients),
            "skipped": skipped,
            "sample": [r["email"] for r in recipients[:5]],
            "daily_limit": daily_limit,
        }

    sent = 0
    failed = 0
    failures: list[dict] = []

    async with httpx.AsyncClient() as client:
        for recipient in recipients:
            token = _ensure_token(supabase, recipient["user_id"], recipient["token"])
            unsubscribe = _unsubscribe_url(token)

            payload = {
                "sender": sender,
                "to": [{"email": recipient["email"], "name": recipient["name"] or None}],
                "subject": body.subject,
                "htmlContent": _html_with_footer(body.html, unsubscribe),
            }
            if body.text:
                payload["textContent"] = body.text
            if unsubscribe:
                payload["headers"] = {
                    "List-Unsubscribe": f"<{unsubscribe}>",
                    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                }

            ok, error = await _send_one(client, api_key, payload)
            if ok:
                sent += 1
                _log(supabase, body.key, recipient["user_id"], recipient["email"], "sent")
            else:
                failed += 1
                failures.append({"email": recipient["email"], "error": error})
                _log(
                    supabase,
                    body.key,
                    recipient["user_id"],
                    recipient["email"],
                    "failed",
                    error,
                )
            await asyncio.sleep(0.2)  # stay well inside Brevo's rate limits

    return {
        "dry_run": False,
        "key": body.key,
        "sent": sent,
        "failed": failed,
        "queued": len(recipients),
        "skipped": skipped,
        "failures": failures[:20],
        "daily_limit": daily_limit,
        "finished_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/status")
def announcement_status(
    key: str,
    authorization: str | None = Header(default=None),
):
    """Delivery counts for one announcement key (admin only)."""
    supabase, _admin = _require_admin(authorization)
    try:
        rows = (
            supabase.table("announcement_log")
            .select("status")
            .eq("announcement_key", key)
            .execute()
            .data
            or []
        )
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(error)) from error

    counts: dict[str, int] = {}
    for row in rows:
        counts[row["status"]] = counts.get(row["status"], 0) + 1
    return {"key": key, "counts": counts}


# ---------------------------------------------------------------- unsubscribe

_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} | Vic Chatbot</title>
<style>
    body {{ margin:0; min-height:100vh; display:grid; place-items:center;
        background: radial-gradient(80% 60% at 50% 0%, #2A1B4D, #0A0A1F 70%);
        color:#fff; font-family: Inter, system-ui, sans-serif; padding:24px; }}
    main {{ width:min(440px,100%); padding:32px; border-radius:22px;
        border:1px solid rgba(139,92,246,.3); background:rgba(18,18,43,.92);
        box-shadow:0 28px 70px rgba(0,0,0,.45); text-align:center; }}
    h1 {{ margin:0 0 10px; font-size:1.35rem; }}
    p {{ margin:0 0 18px; color:#B9B3DA; line-height:1.6; }}
    a {{ display:inline-block; padding:12px 22px; border-radius:999px;
        text-decoration:none; color:#fff;
        background:linear-gradient(135deg,#C026D3,#7C3AED); font-weight:600; }}
</style>
</head>
<body>
<main>
    <h1>{title}</h1>
    <p>{message}</p>
    <a href="{home}">Back to Vic Chatbot</a>
</main>
</body>
</html>"""


@router.get("/unsubscribe", response_class=HTMLResponse)
def unsubscribe(token: str = ""):
    """One click, no login: turn announcement email off for this account."""
    home = _backend_url() or "https://vic-chatbot-frontend.onrender.com"
    if not token:
        return HTMLResponse(
            _PAGE.format(
                title="That link is incomplete",
                message="The unsubscribe link is missing its token.",
                home=home,
            ),
            status_code=400,
        )

    supabase = _supabase()
    try:
        rows = (
            supabase.table("email_preferences")
            .select("user_id")
            .eq("unsubscribe_token", token)
            .execute()
            .data
            or []
        )
    except Exception:  # noqa: BLE001
        rows = []

    if not rows:
        return HTMLResponse(
            _PAGE.format(
                title="That link has expired",
                message="We could not match this link to an account. You can still manage email from your profile inside Vic Chatbot.",
                home=home,
            ),
            status_code=404,
        )

    supabase.table("email_preferences").update({"announcements": False}).eq(
        "unsubscribe_token", token
    ).execute()

    return HTMLResponse(
        _PAGE.format(
            title="Announcements turned off",
            message="You will no longer receive announcement emails. Password resets and other account mail still arrive.",
            home=home,
        )
    )
