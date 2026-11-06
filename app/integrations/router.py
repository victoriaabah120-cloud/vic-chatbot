"""HTTP endpoints for connecting and managing plugins."""

import hmac
import os
from typing import Any, Dict, List

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel

from . import crypto, store
from .deps import get_supabase, require_admin, require_user
from .providers import telegram as telegram_provider
from .registry import all_providers, get_provider

router = APIRouter(prefix="/integrations", tags=["integrations"])


def _frontend_url() -> str:
    return (os.getenv("FRONTEND_URL") or "").rstrip("/")


def _redirect_uri(provider_id: str, request: Request) -> str:
    base = os.getenv("INTEGRATION_REDIRECT_BASE") or str(request.base_url)
    return f"{base.rstrip('/')}/integrations/{provider_id}/callback"


class EnabledPayload(BaseModel):
    enabled: bool


@router.get("/providers")
def list_providers():
    """Everything the UI needs to render the plugin list."""
    return {
        "providers": [
            {
                "id": provider.id,
                "name": provider.name,
                "description": provider.description,
                "auth": provider.auth,
                "scopes": provider.scopes,
                "configured": provider.is_configured(),
            }
            for provider in all_providers()
        ]
    }


@router.get("")
def list_connections(authorization: str | None = Header(default=None)):
    supabase, user = require_user(authorization)
    connections = store.list_connections(supabase, user.id)
    by_provider = {item["provider"]: item for item in connections}

    merged: List[Dict[str, Any]] = []
    for provider in all_providers():
        item = by_provider.get(provider.id, {})
        merged.append(
            {
                "id": provider.id,
                "name": provider.name,
                "description": provider.description,
                "configured": provider.is_configured(),
                "connected": provider.id in by_provider,
                "enabled": bool(item.get("enabled", False)),
                "account_label": item.get("account_label"),
                "connected_at": item.get("connected_at"),
            }
        )
    return {"integrations": merged}


@router.get("/{provider_id}/start")
def start_connection(
    provider_id: str,
    request: Request,
    authorization: str | None = Header(default=None),
):
    _supabase, user = require_user(authorization)

    try:
        provider = get_provider(provider_id)
    except KeyError as error:
        raise HTTPException(
            status_code=404, detail="Unknown provider."
        ) from error

    if not provider.is_configured():
        raise HTTPException(
            status_code=400,
            detail=(
                f"{provider.name} is not configured on the server yet. "
                "Add its client ID and secret to the environment."
            ),
        )

    if provider.auth == "bot":
        try:
            code = store.create_link_code(get_supabase(), user.id, provider_id)
        except Exception as error_value:  # noqa: BLE001
            raise HTTPException(
                status_code=500,
                detail=f"Could not start the connection: {error_value}",
            ) from error_value

        return {
            "mode": "bot",
            "link_url": provider.build_authorize_url(code, ""),
            "code": code,
            "instructions": (
                f"Open {provider.name} and press Start. This link works once, "
                f"for the next {store.LINK_TTL_MINUTES} minutes."
            ),
        }

    try:
        state = crypto.create_state(user.id, provider_id)
    except crypto.ConfigError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

    redirect_uri = _redirect_uri(provider_id, request)
    return {
        "mode": "oauth",
        "authorize_url": provider.build_authorize_url(state, redirect_uri),
        "redirect_uri": redirect_uri,
    }


@router.get("/{provider_id}/callback")
def oauth_callback(
    provider_id: str,
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
):
    """Providers redirect here. The signed state proves which user it is."""

    def finish(status: str, message: str = ""):
        frontend = _frontend_url()
        if frontend:
            query = f"status={status}"
            if message:
                query += f"&message={message[:180]}"
            return RedirectResponse(
                url=f"{frontend}/integrations.html?{query}", status_code=302
            )
        return HTMLResponse(
            content=(
                "<h1>Vic Chatbot</h1>"
                f"<p>Status: {status}</p><p>{message}</p>"
                "<p>Set FRONTEND_URL to send users back to the app.</p>"
            ),
            status_code=200 if status == "connected" else 400,
        )

    if error:
        return finish("error", error_description or error)

    if not code or not state:
        return finish("error", "The provider did not return a code.")

    try:
        payload = crypto.read_state(state)
    except (ValueError, crypto.ConfigError) as error_value:
        return finish("error", str(error_value))

    if payload.get("p") != provider_id:
        return finish("error", "Provider mismatch in the connection request.")

    try:
        provider = get_provider(provider_id)
    except KeyError:
        return finish("error", "Unknown provider.")

    try:
        tokens = provider.exchange_code(code, _redirect_uri(provider_id, request))
    except Exception as error_value:  # noqa: BLE001 - shown to the user
        return finish("error", f"Token exchange failed: {error_value}")

    label = store.account_label_for(provider_id, tokens["access_token"])

    try:
        store.save_connection(
            get_supabase(),
            payload["u"],
            provider_id,
            tokens,
            account_label=label,
        )
    except Exception as error_value:  # noqa: BLE001
        return finish("error", f"Could not save the connection: {error_value}")

    return finish("connected")


@router.post("/{provider_id}/enable")
def enable_connection(
    provider_id: str,
    payload: EnabledPayload,
    authorization: str | None = Header(default=None),
):
    supabase, user = require_user(authorization)
    if store.get_connection(supabase, user.id, provider_id) is None:
        raise HTTPException(status_code=404, detail="Not connected.")
    store.set_enabled(supabase, user.id, provider_id, payload.enabled)
    return {"provider": provider_id, "enabled": payload.enabled}


@router.delete("/{provider_id}")
def disconnect(
    provider_id: str,
    authorization: str | None = Header(default=None),
):
    supabase, user = require_user(authorization)
    store.delete_connection(supabase, user.id, provider_id)
    return {"provider": provider_id, "connected": False}


# ==============================
# TELEGRAM (bot provider)
# ==============================

def _telegram_reply(chat_id: Any, text: str) -> None:
    try:
        telegram_provider.send_message(chat_id, text)
    except Exception:  # noqa: BLE001 - a failed reply must not fail the webhook
        pass


@router.post("/telegram/webhook")
async def telegram_webhook(
    request: Request,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
):
    """Receives bot updates. Telegram retries, so always answer 200."""
    secret = os.getenv("TELEGRAM_WEBHOOK_SECRET")
    if secret and not hmac.compare_digest(
        secret.encode(), (x_telegram_bot_api_secret_token or "").encode()
    ):
        raise HTTPException(status_code=403, detail="Invalid webhook secret.")

    try:
        update = await request.json()
    except Exception:  # noqa: BLE001
        return {"ok": True}

    message = update.get("message") or update.get("edited_message") or {}
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    text = (message.get("text") or "").strip()

    if not chat_id:
        return {"ok": True}

    if not text.startswith("/start"):
        _telegram_reply(
            chat_id,
            "Hi. Open Vic Chatbot, go to Plugins, and press Connect "
            "Telegram to link this chat.",
        )
        return {"ok": True}

    parts = text.split(maxsplit=1)
    code = parts[1].strip() if len(parts) > 1 else ""

    if not code:
        _telegram_reply(
            chat_id,
            "Open Vic Chatbot, go to Plugins, and press Connect Telegram "
            "to link this chat.",
        )
        return {"ok": True}

    try:
        supabase = get_supabase()
        user_id = store.consume_link_code(supabase, code, "telegram")
    except Exception:  # noqa: BLE001
        user_id = None

    if not user_id:
        _telegram_reply(
            chat_id,
            "That link has expired or was already used. Generate a new one "
            "in Vic Chatbot under Plugins.",
        )
        return {"ok": True}

    username = chat.get("username")
    label = f"@{username}" if username else (chat.get("first_name") or str(chat_id))

    try:
        store.save_connection(
            supabase,
            user_id,
            "telegram",
            {"access_token": str(chat_id), "scopes": "chat"},
            account_label=label,
        )
    except Exception:  # noqa: BLE001
        _telegram_reply(
            chat_id, "Something went wrong while linking. Please try again."
        )
        return {"ok": True}

    _telegram_reply(
        chat_id,
        "Connected. Vic Chatbot can now send messages to this chat.",
    )
    return {"ok": True}


@router.post("/telegram/register-webhook")
def register_telegram_webhook(
    request: Request,
    authorization: str | None = Header(default=None),
):
    """Admin only: point the bot at this server. Run once after deploying."""
    require_admin(authorization)

    base = os.getenv("INTEGRATION_REDIRECT_BASE") or str(request.base_url)
    url = f"{base.rstrip('/')}/integrations/telegram/webhook"
    secret = os.getenv("TELEGRAM_WEBHOOK_SECRET") or ""

    payload: Dict[str, Any] = {
        "url": url,
        "allowed_updates": ["message"],
        "drop_pending_updates": True,
    }
    if secret:
        payload["secret_token"] = secret

    try:
        result = telegram_provider.call("setWebhook", payload)
    except Exception as error_value:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail=f"Telegram refused the webhook: {error_value}",
        ) from error_value

    return {"ok": True, "webhook_url": url, "telegram_response": result}
