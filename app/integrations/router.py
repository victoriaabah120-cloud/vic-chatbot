"""HTTP endpoints for connecting and managing plugins."""

import os
from typing import Any, Dict, List

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel

from . import crypto, store
from .deps import get_supabase, require_user
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

    try:
        state = crypto.create_state(user.id, provider_id)
    except crypto.ConfigError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

    redirect_uri = _redirect_uri(provider_id, request)
    return {
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
