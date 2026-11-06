"""Telegram provider: bot-token connection, linked per user via deep link."""

import os
from typing import Any, Dict, List

import httpx

from .base import Provider, Tool

API_ROOT = "https://api.telegram.org"
MAX_MESSAGE_CHARS = 4000


def bot_token() -> str:
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is not set on the server.")
    return token


def call(method: str, payload: Dict[str, Any]) -> Any:
    """Call a Telegram Bot API method and return its result."""
    response = httpx.post(
        f"{API_ROOT}/bot{bot_token()}/{method}",
        json=payload,
        timeout=20,
    )

    try:
        data = response.json()
    except ValueError:
        data = {}

    if not data.get("ok"):
        description = data.get("description") or f"HTTP {response.status_code}"
        raise RuntimeError(f"Telegram error: {description}")

    return data.get("result")


def send_message(chat_id: str | int, text: str) -> Dict[str, Any]:
    if not str(text).strip():
        raise RuntimeError("Refusing to send an empty Telegram message.")

    call(
        "sendMessage",
        {
            "chat_id": chat_id,
            "text": str(text)[:MAX_MESSAGE_CHARS],
            "disable_web_page_preview": True,
        },
    )
    return {"sent": True, "chat_id": str(chat_id)}


class TelegramProvider(Provider):
    """Telegram has no per-user OAuth: one bot, linked chats."""

    def __init__(self) -> None:
        super().__init__(
            id="telegram",
            name="Telegram",
            auth="bot",
            description=(
                "Send messages to your Telegram chat straight from the "
                "conversation."
            ),
            scopes=["chat"],
        )

    def is_configured(self) -> bool:
        return bool(
            os.getenv("TELEGRAM_BOT_TOKEN")
            and os.getenv("TELEGRAM_BOT_USERNAME")
        )

    def build_authorize_url(self, state: str, redirect_uri: str) -> str:
        username = (os.getenv("TELEGRAM_BOT_USERNAME") or "").lstrip("@")
        return f"https://t.me/{username}?start={state}"

    def exchange_code(self, code: str, redirect_uri: str) -> Dict[str, Any]:
        raise NotImplementedError(
            "Telegram links through the bot webhook, not an OAuth callback."
        )

    def tools(self, access_token: str) -> List[Tool]:
        chat_id = access_token

        def telegram_send_message(text: str) -> Dict[str, Any]:
            return send_message(chat_id, text)

        return [
            Tool(
                name="telegram_send_message",
                description=(
                    "Send a Telegram message to the connected chat. Use this "
                    "only when the user clearly asks you to message them or "
                    "send something to their Telegram."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "text": {
                            "type": "string",
                            "description": "Message body, plain text.",
                        }
                    },
                    "required": ["text"],
                },
                handler=telegram_send_message,
                write=True,
            )
        ]
