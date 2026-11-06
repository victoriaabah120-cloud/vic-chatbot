"""Small auth helpers so the plugin package works without importing api.py."""

import os

from dotenv import load_dotenv
from fastapi import Header, HTTPException
from supabase import create_client

load_dotenv()


def get_supabase():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise HTTPException(
            status_code=500,
            detail="Supabase is not configured on the server.",
        )
    return create_client(url, key)


def get_current_user_and_client(authorization: str | None):
    """Validate a bearer token and return (supabase_client, user)."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="A bearer access token is required.",
        )

    access_token = authorization.removeprefix("Bearer ").strip()
    if not access_token:
        raise HTTPException(
            status_code=401,
            detail="A bearer access token is required.",
        )

    supabase = get_supabase()
    try:
        response = supabase.auth.get_user(access_token)
    except Exception as error:  # noqa: BLE001
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired access token.",
        ) from error

    if response.user is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired access token.",
        )

    return supabase, response.user


def require_user(authorization: str | None = Header(default=None)):
    return get_current_user_and_client(authorization)


def require_admin(authorization: str | None = Header(default=None)):
    supabase, user = get_current_user_and_client(authorization)
    app_metadata = getattr(user, "app_metadata", None) or {}
    if app_metadata.get("role") != "admin":
        raise HTTPException(
            status_code=403,
            detail="Admin access is required.",
        )
    return supabase, user
