"""Token encryption and signed OAuth state.

Tokens are stored encrypted with Fernet so a database dump alone does not
expose anyone's GitHub or Google credentials.
"""

import base64
import hashlib
import hmac
import json
import os
import time

from cryptography.fernet import Fernet, InvalidToken

STATE_TTL_SECONDS = 900  # 15 minutes


class ConfigError(RuntimeError):
    """Raised when a required integration secret is missing."""


def _encryption_key() -> bytes:
    key = os.getenv("PLUGIN_ENCRYPTION_KEY")
    if not key:
        raise ConfigError(
            "PLUGIN_ENCRYPTION_KEY is not set. Generate one with: "
            "python -c \"from cryptography.fernet import Fernet; "
            "print(Fernet.generate_key().decode())\""
        )
    raw = key.encode()
    try:
        Fernet(raw)
    except (ValueError, TypeError) as error:
        raise ConfigError(
            "PLUGIN_ENCRYPTION_KEY must be a valid Fernet key "
            "(44 character urlsafe base64)."
        ) from error
    return raw


def encrypt(value: str) -> str:
    if value is None:
        return None
    return _fernet().encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    if not value:
        return value
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken as error:
        raise ConfigError(
            "Stored integration token could not be decrypted. The "
            "PLUGIN_ENCRYPTION_KEY may have changed."
        ) from error


def _fernet() -> Fernet:
    return Fernet(_encryption_key())


def _state_secret() -> bytes:
    secret = os.getenv("PLUGIN_STATE_SECRET") or os.getenv("PLUGIN_ENCRYPTION_KEY")
    if not secret:
        raise ConfigError(
            "PLUGIN_STATE_SECRET or PLUGIN_ENCRYPTION_KEY must be set "
            "before OAuth connections can start."
        )
    return secret.encode()


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def create_state(user_id: str, provider: str) -> str:
    """Return a tamper-proof state string carrying the user and provider."""
    payload = {
        "u": user_id,
        "p": provider,
        "t": int(time.time()),
    }
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    signature = hmac.new(
        _state_secret(), body.encode(), hashlib.sha256
    ).digest()
    return f"{body}.{_b64(signature)}"


def read_state(state: str) -> dict:
    """Verify a state string and return its payload. Raises ValueError."""
    if not state or "." not in state:
        raise ValueError("Malformed state parameter.")

    body, signature = state.rsplit(".", 1)

    expected = hmac.new(
        _state_secret(), body.encode(), hashlib.sha256
    ).digest()
    try:
        given = _unb64(signature)
    except Exception as error:  # noqa: BLE001 - any decode failure is invalid
        raise ValueError("Malformed state signature.") from error

    if not hmac.compare_digest(expected, given):
        raise ValueError("State signature does not match.")

    try:
        payload = json.loads(_unb64(body))
    except Exception as error:  # noqa: BLE001
        raise ValueError("Malformed state payload.") from error

    if int(time.time()) - int(payload.get("t", 0)) > STATE_TTL_SECONDS:
        raise ValueError("This connection link has expired. Please try again.")

    if not payload.get("u") or not payload.get("p"):
        raise ValueError("State is missing the user or provider.")

    return payload
