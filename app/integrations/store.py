"""Storage for connected integration tokens.

Table: integrations (see app/integrations/schema.sql)
Tokens are encrypted at rest; nothing here ever returns a raw token to the
browser.
"""

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from . import crypto
from .registry import get_provider

TABLE = "integrations"
LINK_CODES = "integration_link_codes"
LINK_TTL_MINUTES = 15


def _row_to_dict(row: Dict[str, Any]) -> Dict[str, Any]:
    """Shape a database row for API responses (never includes tokens)."""
    return {
        "provider": row.get("provider"),
        "account_label": row.get("account_label"),
        "scopes": row.get("scopes"),
        "enabled": bool(row.get("enabled", True)),
        "connected_at": row.get("created_at"),
        "expires_at": row.get("token_expires_at"),
    }


def list_connections(supabase, user_id: str) -> List[Dict[str, Any]]:
    response = (
        supabase.table(TABLE)
        .select(
            "provider,account_label,scopes,enabled,created_at,token_expires_at"
        )
        .eq("user_id", user_id)
        .execute()
    )
    return [_row_to_dict(row) for row in response.data or []]


def get_connection(
    supabase, user_id: str, provider_id: str
) -> Optional[Dict[str, Any]]:
    response = (
        supabase.table(TABLE)
        .select("*")
        .eq("user_id", user_id)
        .eq("provider", provider_id)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    return rows[0] if rows else None


def save_connection(
    supabase,
    user_id: str,
    provider_id: str,
    tokens: Dict[str, Any],
    account_label: str = "",
) -> None:
    expires_at = None
    expires_in = tokens.get("expires_in")
    if expires_in:
        expires_at = (
            datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
        ).isoformat()

    payload = {
        "user_id": user_id,
        "provider": provider_id,
        "access_token": crypto.encrypt(tokens["access_token"]),
        "refresh_token": crypto.encrypt(tokens.get("refresh_token")),
        "token_expires_at": expires_at,
        "scopes": tokens.get("scopes", ""),
        "account_label": account_label or "",
        "enabled": True,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    supabase.table(TABLE).upsert(
        payload, on_conflict="user_id,provider"
    ).execute()


def delete_connection(supabase, user_id: str, provider_id: str) -> None:
    (
        supabase.table(TABLE)
        .delete()
        .eq("user_id", user_id)
        .eq("provider", provider_id)
        .execute()
    )


def set_enabled(
    supabase, user_id: str, provider_id: str, enabled: bool
) -> None:
    (
        supabase.table(TABLE)
        .update({"enabled": bool(enabled)})
        .eq("user_id", user_id)
        .eq("provider", provider_id)
        .execute()
    )


def account_label_for(provider_id: str, access_token: str) -> str:
    try:
        return get_provider(provider_id).fetch_account_label(access_token)
    except Exception:  # noqa: BLE001 - label is cosmetic
        return ""


def active_tools(supabase, user_id: str) -> List[Any]:
    """Return every tool from every enabled, connected provider."""
    response = (
        supabase.table(TABLE)
        .select("provider,access_token,enabled")
        .eq("user_id", user_id)
        .eq("enabled", True)
        .execute()
    )

    tools = []
    for row in response.data or []:
        try:
            provider = get_provider(row["provider"])
        except KeyError:
            continue
        try:
            token = crypto.decrypt(row.get("access_token") or "")
        except Exception:  # noqa: BLE001 - skip an unreadable connection
            continue
        if not token:
            continue
        tools.extend(provider.tools(token))
    return tools


def tool_name_map(supabase, user_id: str) -> Dict[str, Any]:
    return {tool.name: tool for tool in active_tools(supabase, user_id)}


def create_link_code(
    supabase, user_id: str, provider_id: str
) -> str:
    """One-time code a bot deep link carries (Telegram /start payload)."""
    code = secrets.token_urlsafe(9)
    expires_at = (
        datetime.now(timezone.utc) + timedelta(minutes=LINK_TTL_MINUTES)
    ).isoformat()

    supabase.table(LINK_CODES).insert(
        {
            "code": code,
            "user_id": user_id,
            "provider": provider_id,
            "expires_at": expires_at,
        }
    ).execute()
    return code


def consume_link_code(
    supabase, code: str, provider_id: str
) -> Optional[str]:
    """Return the user id for a valid unused code, and burn the code."""
    if not code:
        return None

    response = (
        supabase.table(LINK_CODES)
        .select("code,user_id,expires_at,used")
        .eq("code", code)
        .eq("provider", provider_id)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    if not rows:
        return None

    row = rows[0]
    if row.get("used"):
        return None

    expires_at = row.get("expires_at")
    if expires_at:
        try:
            expiry = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
        except ValueError:
            return None
        if expiry < datetime.now(timezone.utc):
            return None

    supabase.table(LINK_CODES).update({"used": True}).eq(
        "code", code
    ).execute()

    return row.get("user_id")
