"""Optional, revocable read-only links to a conversation.

A share token is 32 random bytes in url-safe base64. Revoking stamps
revoked_at and the public reader stops serving it immediately. Shared pages
carry only the title, dates and messages: never an email, token or user id.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException

from app.integrations.deps import get_current_user_and_client

router = APIRouter(tags=["shares"])


def _public_base() -> str:
    import os

    return (os.getenv("PUBLIC_SITE_URL") or "https://vic-chatbot-frontend.onrender.com").rstrip("/")


def _owned_conversation(client, user_id: str, conversation_id: str) -> dict:
    rows = (
        client.table("conversations")
        .select("id,title,created_at")
        .eq("id", conversation_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    ).data
    if not rows:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return rows[0]


@router.get("/conversations/{conversation_id}/share")
def share_status(conversation_id: str, authorization: str | None = Header(default=None)):
    client, user = get_current_user_and_client(authorization)
    _owned_conversation(client, user.id, conversation_id)
    rows = (
        client.table("conversation_shares")
        .select("token,created_at,revoked_at")
        .eq("conversation_id", conversation_id)
        .eq("user_id", user.id)
        .is_("revoked_at", "null")
        .limit(1)
        .execute()
    ).data or []
    if not rows:
        return {"shared": False}
    return {
        "shared": True,
        "url": f"{_public_base()}/shared.html?t={rows[0]['token']}",
        "created_at": rows[0]["created_at"],
    }


@router.post("/conversations/{conversation_id}/share")
def create_share(conversation_id: str, authorization: str | None = Header(default=None)):
    client, user = get_current_user_and_client(authorization)
    _owned_conversation(client, user.id, conversation_id)

    existing = (
        client.table("conversation_shares")
        .select("token")
        .eq("conversation_id", conversation_id)
        .eq("user_id", user.id)
        .is_("revoked_at", "null")
        .limit(1)
        .execute()
    ).data or []
    token = existing[0]["token"] if existing else secrets.token_urlsafe(24)
    if not existing:
        client.table("conversation_shares").insert(
            {"conversation_id": conversation_id, "user_id": user.id, "token": token}
        ).execute()

    return {"shared": True, "url": f"{_public_base()}/shared.html?t={token}"}


@router.delete("/conversations/{conversation_id}/share")
def revoke_share(conversation_id: str, authorization: str | None = Header(default=None)):
    client, user = get_current_user_and_client(authorization)
    _owned_conversation(client, user.id, conversation_id)
    client.table("conversation_shares").update(
        {"revoked_at": datetime.now(timezone.utc).isoformat()}
    ).eq("conversation_id", conversation_id).eq("user_id", user.id).is_("revoked_at", "null").execute()
    return {"shared": False}


@router.get("/shared/{token}")
def read_shared(token: str):
    """Public read: only title, dates and messages, and only while unrevoked."""
    import os

    from supabase import create_client

    client = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
    try:
        share = (
            client.table("conversation_shares")
            .select("conversation_id,revoked_at")
            .eq("token", token)
            .limit(1)
            .execute()
        ).data
    except Exception as error:  # noqa: BLE001
        # Migration pending or a storage hiccup: never leak a 500 to a visitor.
        print("SHARED READ ERROR:", repr(error))
        raise HTTPException(status_code=404, detail="This link is no longer available.")
    if not share or share[0].get("revoked_at"):
        raise HTTPException(status_code=404, detail="This link is no longer available.")

    try:
        conversation = (
            client.table("conversations")
            .select("title,created_at")
            .eq("id", share[0]["conversation_id"])
            .limit(1)
            .execute()
        ).data
    except Exception as error:  # noqa: BLE001
        print("SHARED CONVERSATION ERROR:", repr(error))
        raise HTTPException(status_code=404, detail="This link is no longer available.")
    if not conversation:
        raise HTTPException(status_code=404, detail="This link is no longer available.")

    try:
        messages = (
            client.table("messages")
            .select("role,content,created_at,sources")
            .eq("conversation_id", share[0]["conversation_id"])
            .order("created_at")
            .execute()
        ).data or []
    except Exception as error:  # noqa: BLE001
        print("SHARED MESSAGES ERROR:", repr(error))
        raise HTTPException(status_code=404, detail="This link is no longer available.")

    return {
        "title": conversation[0].get("title") or "Shared conversation",
        "created_at": conversation[0].get("created_at"),
        "messages": [
            {
                "role": message.get("role"),
                "content": message.get("content"),
                "created_at": message.get("created_at"),
                "sources": message.get("sources") or [],
            }
            for message in messages
        ],
    }
