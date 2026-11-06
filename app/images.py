"""Persistent storage for generated images.

A generated image is written to a private Supabase Storage bucket, and a normal
row in the existing ``messages`` table records where it lives. That keeps the
current database schema intact (no migration) while making images survive
logout, reloads, new devices and older conversations.

The message content is a marker followed by a small JSON payload, for example::

    [[vic-image]]{"path":"<user>/<conversation>/<file>.png","prompt":"a cat"}

Rows written this way are filtered out of the history that is sent to the
language model, and turned back into image URLs when a conversation is loaded.
"""

import json
import logging
import uuid

IMAGE_BUCKET = "chat-images"
IMAGE_MARKER = "[[vic-image]]"

# Signed URLs are re-minted every time a conversation is loaded, so this only
# needs to outlive a single page view.
SIGNED_URL_TTL_SECONDS = 60 * 60 * 24

_bucket_ready = False

log = logging.getLogger(__name__)


def ensure_bucket(supabase) -> bool:
    """Create the private image bucket once per process.

    Returns True when the bucket is usable. A failure (missing storage
    permission, for example) is logged and reported so image generation can
    still succeed for the current session with a warning.
    """

    global _bucket_ready

    if _bucket_ready:
        return True

    try:
        supabase.storage.create_bucket(
            IMAGE_BUCKET,
            options={"public": False},
        )
    except Exception as error:  # noqa: BLE001 - any failure means "check below"
        message = str(error).lower()
        already_there = (
            "already exists" in message
            or "duplicate" in message
            or "resource already" in message
            or "409" in message
        )
        if not already_there:
            log.warning("Could not prepare the image bucket: %s", error)
            return False

    _bucket_ready = True
    return True


def save_image(supabase, user_id: str, conversation_id: str, png_bytes: bytes):
    """Upload one PNG and return its storage path, or None if it failed."""

    if not ensure_bucket(supabase):
        return None

    path = f"{user_id}/{conversation_id}/{uuid.uuid4().hex}.png"

    try:
        supabase.storage.from_(IMAGE_BUCKET).upload(
            path,
            png_bytes,
            {"content-type": "image/png", "upsert": "true"},
        )
    except Exception as error:  # noqa: BLE001 - caller reports the warning
        log.warning("Could not upload a generated image: %s", error)
        return None

    return path


def signed_url(supabase, path: str):
    """Return a fresh signed URL for a stored image, or None if unavailable."""

    if not path:
        return None

    try:
        result = supabase.storage.from_(IMAGE_BUCKET).create_signed_url(
            path,
            SIGNED_URL_TTL_SECONDS,
        )
    except Exception as error:  # noqa: BLE001 - a missing file is not fatal
        log.warning("Could not sign image %s: %s", path, error)
        return None

    if isinstance(result, dict):
        return (
            result.get("signedURL")
            or result.get("signedUrl")
            or result.get("signed_url")
        )

    return getattr(result, "signed_url", None)


def build_message_content(path: str, prompt: str) -> str:
    """Build the marker text that is stored in ``messages.content``."""

    payload = {"path": path, "prompt": prompt}
    return IMAGE_MARKER + json.dumps(payload, separators=(",", ":"))


def is_image_message(content) -> bool:
    return isinstance(content, str) and content.startswith(IMAGE_MARKER)


def parse_image_message(content):
    """Return the stored payload for an image message, or None."""

    if not is_image_message(content):
        return None

    try:
        data = json.loads(content[len(IMAGE_MARKER):])
    except (TypeError, ValueError):
        return None

    if not isinstance(data, dict) or not data.get("path"):
        return None

    return data
